import { randomUUID, randomBytes } from "node:crypto";
import {
  openDb,
  transaction,
  json,
  type Db,
} from "../../../packages/shared/src/db.js";
import {
  distance,
  freshLocation,
  usableLocation,
  type LocationSample,
  type Preferences,
  type CompanyCandidate,
  type CompanyProfile,
  type WalkState,
  type Encounter,
} from "../../../packages/shared/src/schema.js";
import { statusError } from "../../../packages/shared/src/security.js";
export type Walk = {
  id: string;
  owner: string;
  preferences: string;
  status: WalkState["status"];
  heartbeat: number;
  created: number;
  run_count: number;
  last_run: number;
  last_lat: number | null;
  last_lng: number | null;
  thread_id: string | null;
  message: string | null;
  pending_preferences: number;
};
export type Job = {
  id: string;
  walk_id: string;
  state: string;
  location: string;
  created: number;
  started: number;
  lease: string;
  tool_count: number;
  research_count: number;
};
export class Store {
  db: Db;
  latest = new Map<string, LocationSample>();
  recent = new Map<string, LocationSample[]>();
  candidates = new Map<string, Map<string, CompanyCandidate>>();
  private configured: boolean;
  workerUntil = 0;
  get ready() {
    return (
      this.configured && (!this.requireWorker || this.workerUntil > Date.now())
    );
  }
  limits = {
    missions: Number(process.env.MAX_DAILY_MISSIONS || 30),
    walk: Number(process.env.MAX_WALK_MISSIONS || 20),
    maps: Number(process.env.MAX_DAILY_MAPS || 60),
    parallel: Number(process.env.MAX_DAILY_PARALLEL || 30),
    composio: Number(process.env.MAX_DAILY_COMPOSIO || 30),
  };
  constructor(
    path: string,
    ready: boolean,
    private requireWorker = false,
  ) {
    this.db = openDb(path);
    this.configured = ready;
    this.db
      .prepare(
        "UPDATE jobs SET state='interrupted',finished=? WHERE state='running'",
      )
      .run(Date.now());
    this.db
      .prepare(
        "UPDATE walks SET status='paused',message='Ready to resume' WHERE status IN ('active','researching')",
      )
      .run();
  }
  event(id: string, type: string, data: Record<string, unknown> = {}) {
    this.db
      .prepare("INSERT INTO events(walk_id,type,data,created) VALUES(?,?,?,?)")
      .run(id, type, JSON.stringify(data), Date.now());
  }
  walk(id: string, owner?: string) {
    const w = this.db.prepare("SELECT * FROM walks WHERE id=?").get(id) as
      Walk | undefined;
    if (!w || (owner !== undefined && w.owner !== owner))
      throw statusError("Walk not found", 404);
    return w;
  }
  create(owner: string, prefs: Preferences) {
    return transaction(this.db, () => {
      const occupied = this.db
        .prepare(
          "SELECT id,owner FROM walks WHERE status IN ('active','researching') AND heartbeat>?",
        )
        .get(Date.now() - 30000) as any;
      if (occupied) {
        if (occupied.owner === owner) return String(occupied.id);
        throw statusError("Another walk is already active", 409);
      }
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO walks(id,owner,preferences,status,heartbeat,created) VALUES(?,?,?,?,?,?)",
        )
        .run(
          id,
          owner,
          JSON.stringify(prefs),
          "active",
          Date.now(),
          Date.now(),
        );
      this.event(id, "walk.created");
      return id;
    });
  }
  reserve(
    kind: "missions" | "maps" | "parallel" | "composio",
    limit = this.limits[kind],
  ) {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    transaction(this.db, () => {
      this.db
        .prepare("INSERT OR IGNORE INTO counters(day,kind,value) VALUES(?,?,0)")
        .run(day, kind);
      const row = this.db
        .prepare("SELECT value FROM counters WHERE day=? AND kind=?")
        .get(day, kind) as any;
      if (Number(row.value) >= limit)
        throw statusError("Daily research limit reached", 429);
      this.db
        .prepare("UPDATE counters SET value=value+1 WHERE day=? AND kind=?")
        .run(day, kind);
    });
  }
  location(id: string, owner: string, p: LocationSample) {
    const w = this.walk(id, owner);
    this.db
      .prepare("UPDATE walks SET heartbeat=? WHERE id=?")
      .run(p.visible ? Date.now() : 0, id);
    if (!p.visible) {
      this.pause(id, owner);
      return;
    }
    if (!freshLocation(p)) return;
    this.latest.set(id, p);
    const points = (this.recent.get(id) || []).filter(
      (x) => Date.now() - x.timestamp < 120000,
    );
    // Desktop fixes can guide discovery, but only precise fixes prove a pass.
    if (usableLocation(p)) points.push(p);
    this.recent.set(id, points.slice(-32));
    this.detect(id);
    if (w.status === "active") this.schedule(id);
  }
  schedule(id: string) {
    const w = this.walk(id),
      p = this.latest.get(id);
    if (
      !this.ready ||
      !p ||
      !freshLocation(p) ||
      w.heartbeat < Date.now() - 30000 ||
      !["active", "researching"].includes(w.status)
    )
      return;
    if (
      this.db
        .prepare("SELECT id FROM jobs WHERE state IN ('running','queued')")
        .get()
    )
      return;
    if (Date.now() - w.last_run < 45000) return;
    if (
      !w.pending_preferences &&
      w.last_lat !== null &&
      w.last_lng !== null &&
      distance(p, { lat: w.last_lat, lng: w.last_lng }) < 200
    )
      return;
    if (w.run_count >= this.limits.walk) {
      this.limit(id);
      return;
    }
    try {
      this.reserve("missions");
    } catch {
      this.limit(id);
      return;
    }
    transaction(this.db, () => {
      this.db
        .prepare(
          "INSERT INTO jobs(id,walk_id,state,location,created) VALUES(?,?,'queued',?,?)",
        )
        .run(randomUUID(), id, JSON.stringify(p), Date.now());
      this.db
        .prepare(
          "UPDATE walks SET status='researching',run_count=run_count+1,last_run=?,last_lat=?,last_lng=?,pending_preferences=0,message=NULL WHERE id=?",
        )
        .run(Date.now(), p.lat, p.lng, id);
      this.event(id, "agent.started");
    });
  }
  tick() {
    for (const row of this.db
      .prepare(
        "SELECT id,heartbeat FROM walks WHERE status IN ('active','researching')",
      )
      .all() as any[]) {
      if (row.heartbeat < Date.now() - 30000)
        this.pause(row.id, this.walk(row.id).owner);
      else this.schedule(row.id);
    }
    this.db
      .prepare(
        "UPDATE jobs SET state='interrupted',finished=? WHERE state='running' AND started<?",
      )
      .run(Date.now(), Date.now() - 185000);
    this.db
      .prepare(
        "UPDATE walks SET status='error',message='Research interrupted. Pause and resume to retry.' WHERE status='researching' AND NOT EXISTS(SELECT 1 FROM jobs WHERE jobs.walk_id=walks.id AND jobs.state IN ('queued','running'))",
      )
      .run();
    this.db
      .prepare("DELETE FROM jobs WHERE finished<?")
      .run(Date.now() - 86400000);
    this.db
      .prepare("DELETE FROM events WHERE created<?")
      .run(Date.now() - 7 * 86400000);
  }
  claim() {
    if (!this.ready) return null;
    return transaction(this.db, () => {
      if (this.db.prepare("SELECT id FROM jobs WHERE state='running'").get())
        return null;
      const j = this.db
        .prepare(
          "SELECT jobs.* FROM jobs JOIN walks ON walks.id=jobs.walk_id WHERE jobs.state='queued' AND walks.heartbeat>? ORDER BY jobs.created LIMIT 1",
        )
        .get(Date.now() - 30000) as Job | undefined;
      if (!j) return null;
      const lease = randomBytes(32).toString("hex");
      this.db
        .prepare("UPDATE jobs SET state='running',started=?,lease=? WHERE id=?")
        .run(Date.now(), lease, j.id);
      return {
        ...j,
        lease,
        started: Date.now(),
        threadId: this.walk(j.walk_id).thread_id,
      };
    });
  }
  job(id: string, lease: string) {
    const j = this.db
      .prepare("SELECT * FROM jobs WHERE id=? AND lease=? AND state='running'")
      .get(id, lease) as Job | undefined;
    if (!j || Date.now() - j.started > 180000)
      throw statusError("Mission expired", 409);
    return j;
  }
  tool(id: string, lease: string) {
    const j = this.job(id, lease);
    if (j.tool_count >= 12)
      throw statusError("Mission tool limit reached", 429);
    this.db
      .prepare("UPDATE jobs SET tool_count=tool_count+1 WHERE id=?")
      .run(id);
    return j;
  }
  finish(
    id: string,
    lease: string,
    threadId: string | null,
    error: string | null,
  ) {
    const j = this.db
      .prepare("SELECT * FROM jobs WHERE id=? AND lease=? AND state='running'")
      .get(id, lease) as Job | undefined;
    if (!j) throw statusError("Mission expired", 409);
    transaction(this.db, () => {
      this.db
        .prepare("UPDATE jobs SET state=?,finished=? WHERE id=?")
        .run(error ? "failed" : "completed", Date.now(), id);
      const w = this.walk(j.walk_id);
      const status = error
        ? "error"
        : w.status === "paused" || w.heartbeat < Date.now() - 30000
          ? "paused"
          : "active";
      this.db
        .prepare(
          "UPDATE walks SET thread_id=COALESCE(?,thread_id),status=?,message=? WHERE id=?",
        )
        .run(threadId, status, error, j.walk_id);
      this.event(
        j.walk_id,
        error ? "agent.failed" : "agent.completed",
        error ? { message: error } : {},
      );
    });
  }
  pause(id: string, owner: string) {
    this.walk(id, owner);
    this.db
      .prepare("UPDATE walks SET status='paused',heartbeat=0 WHERE id=?")
      .run(id);
    this.db
      .prepare(
        "UPDATE jobs SET state='cancelled',finished=? WHERE walk_id=? AND state='queued'",
      )
      .run(Date.now(), id);
    this.event(id, "walk.paused");
  }
  resume(id: string, owner: string) {
    this.walk(id, owner);
    const other = this.db
      .prepare(
        "SELECT id FROM walks WHERE id<>? AND status IN ('active','researching') AND heartbeat>?",
      )
      .get(id, Date.now() - 30000);
    if (other) throw statusError("Another walk is already active", 409);
    const running = this.db
      .prepare("SELECT id FROM jobs WHERE walk_id=? AND state='running'")
      .get(id);
    this.db
      .prepare(
        "UPDATE walks SET status=?,heartbeat=?,message=NULL WHERE id=? AND status<>'limited'",
      )
      .run(running ? "researching" : "active", Date.now(), id);
    this.event(id, "walk.resumed");
  }
  preferences(id: string, owner: string, prefs: Preferences) {
    this.walk(id, owner);
    this.db
      .prepare(
        "UPDATE walks SET preferences=?,pending_preferences=1 WHERE id=?",
      )
      .run(JSON.stringify(prefs), id);
    this.event(id, "preferences.updated");
  }
  limit(id: string) {
    this.db
      .prepare(
        "UPDATE walks SET status='limited',message='Research limit reached. Your discoveries are still available.' WHERE id=?",
      )
      .run(id);
    this.event(id, "budget.reached");
  }
  profile(id: string) {
    const p = this.db
      .prepare("SELECT data FROM profiles WHERE id=?")
      .get(id) as any;
    return p ? json<CompanyProfile>(p.data) : undefined;
  }
  addCandidates(id: string, items: CompanyCandidate[]) {
    const map = this.candidates.get(id) || new Map<string, CompanyCandidate>();
    for (const c of items) {
      const profile = this.profile(c.id);
      map.set(c.id, {
        ...c,
        ...(profile ? { profile, status: "ready" as const } : {}),
      });
      this.db
        .prepare("INSERT OR IGNORE INTO candidate_refs(walk_id,id) VALUES(?,?)")
        .run(id, c.id);
    }
    this.candidates.set(id, map);
    this.detect(id);
    this.event(id, "candidates.changed");
  }
  detect(id: string) {
    for (const p of this.recent.get(id) || []) {
      if (Date.now() - p.timestamp > 120000) continue;
      for (const c of this.candidates.get(id)?.values() || []) {
        if (distance(p, c) > 100) continue;
        const exists = this.db
          .prepare("SELECT id FROM encounters WHERE walk_id=? AND id=?")
          .get(id, c.id);
        this.db
          .prepare(
            "INSERT INTO encounters(walk_id,id,first_seen,last_seen) VALUES(?,?,?,?) ON CONFLICT(walk_id,id) DO UPDATE SET last_seen=MAX(last_seen,excluded.last_seen),first_seen=MIN(first_seen,excluded.first_seen)",
          )
          .run(id, c.id, p.timestamp, p.timestamp);
        if (!exists)
          this.event(id, "company.encountered", {
            companyId: c.id,
            at: p.timestamp,
          });
      }
    }
  }
  publish(walkId: string, profile: CompanyProfile) {
    this.db
      .prepare(
        "INSERT INTO profiles(id,data,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated",
      )
      .run(profile.id, JSON.stringify(profile), Date.now());
    const c = this.candidates.get(walkId)?.get(profile.id);
    if (c) {
      c.profile = profile;
      c.status = profile.addressVerified ? "ready" : "unverified";
    }
    const already = this.db
      .prepare(
        "SELECT id FROM events WHERE walk_id=? AND type='company.ready' AND json_extract(data,'$.companyId')=? LIMIT 1",
      )
      .get(walkId, profile.id);
    this.event(walkId, already ? "company.updated" : "company.ready", {
      companyId: profile.id,
    });
  }
  state(id: string, owner: string): WalkState {
    const w = this.walk(id, owner);
    const refs = this.db
      .prepare("SELECT id FROM candidate_refs WHERE walk_id=?")
      .all(id) as any[];
    if (!this.candidates.has(id)) {
      const restored = new Map<string, CompanyCandidate>();
      for (const r of refs) {
        const row = this.db
          .prepare("SELECT data FROM osm_places WHERE id=?")
          .get(r.id) as any;
        if (row) {
          const c = json<CompanyCandidate>(row.data),
            profile = this.profile(r.id);
          restored.set(r.id, {
            ...c,
            ...(profile
              ? {
                  profile,
                  status: profile.addressVerified
                    ? ("ready" as const)
                    : ("unverified" as const),
                }
              : {}),
          });
        }
      }
      this.candidates.set(id, restored);
    }
    const profiles = refs
      .map((r) => this.profile(r.id))
      .filter(Boolean) as CompanyProfile[];
    const p = this.latest.get(id);
    const candidates = [...(this.candidates.get(id)?.values() || [])].map(
      (c) => ({
        ...c,
        ...(profiles.find((profile) => profile.id === c.id)
          ? { profile: profiles.find((profile) => profile.id === c.id) }
          : {}),
        distance: p ? distance(p, c) : c.distance,
      }),
    );
    const encounters = (
      this.db
        .prepare(
          "SELECT id,first_seen,last_seen FROM encounters WHERE walk_id=? ORDER BY last_seen DESC",
        )
        .all(id) as any[]
    ).map((r) => ({
      id: r.id,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      profile: this.profile(r.id),
      ...(r.id.startsWith("osm:")
        ? { place: this.candidates.get(id)?.get(r.id) }
        : {}),
    })) as Encounter[];
    const events = (
      this.db
        .prepare(
          "SELECT * FROM events WHERE walk_id=? ORDER BY id DESC LIMIT 100",
        )
        .all(id) as any[]
    )
      .reverse()
      .map((e) => ({
        id: e.id,
        type: e.type,
        data: json<Record<string, unknown>>(e.data),
        createdAt: e.created,
      }));
    return {
      id,
      status: w.status,
      preferences: json(w.preferences),
      candidates,
      profiles,
      encounters,
      events,
      message: w.message,
      configured: this.ready,
      runCount: w.run_count,
    };
  }
}
