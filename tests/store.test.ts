import { describe, it, expect, afterEach, vi } from "vitest";
import { Store } from "../services/tools/src/store.js";
import {
  defaultPreferences,
  distance,
  usableLocation,
  type CompanyCandidate,
} from "../packages/shared/src/schema.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const stores: Store[] = [];
const make = (ready = true, path = ":memory:") => {
  const s = new Store(path, ready);
  stores.push(s);
  return s;
};
const pos = (lat = 37.7749) => ({
  lat,
  lng: -122.4194,
  accuracy: 8,
  timestamp: Date.now(),
  visible: true,
});
afterEach(() => {
  for (const s of stores.splice(0)) s.db.close();
  vi.restoreAllMocks();
});
describe("geography and encounters", () => {
  it("calculates metre distances and rejects stale or imprecise fixes", () => {
    expect(distance(pos(), pos(37.7758))).toBeCloseTo(100, 0);
    expect(usableLocation({ ...pos(), accuracy: 51 })).toBe(false);
    expect(usableLocation({ ...pos(), timestamp: Date.now() - 31000 })).toBe(
      false,
    );
  });
  it("records encounters from the recent location buffer and deduplicates", () => {
    const s = make(false),
      id = s.create("owner", defaultPreferences);
    s.location(id, "owner", pos());
    const c: CompanyCandidate = {
      id: "place",
      name: "Business",
      address: "Example",
      lat: 37.775,
      lng: -122.4194,
      distance: 11,
      status: "discovered",
    };
    s.addCandidates(id, [c]);
    s.location(id, "owner", pos());
    expect(s.state(id, "owner").encounters).toHaveLength(1);
    s.addCandidates(id, [{ ...c, id: "far", lat: 38 }]);
    expect(s.state(id, "owner").encounters).toHaveLength(1);
  });
  it("does not record inaccurate positions", () => {
    const s = make(false),
      id = s.create("owner", defaultPreferences);
    s.location(id, "owner", { ...pos(), accuracy: 200 });
    s.addCandidates(id, [
      {
        id: "x",
        name: "X",
        address: "A",
        lat: 37.7749,
        lng: -122.4194,
        distance: 0,
        status: "discovered",
      },
    ]);
    expect(s.state(id, "owner").encounters).toHaveLength(0);
  });
});
describe("mission state and quotas", () => {
  it("researches a fresh desktop fix without claiming an inaccurate encounter", () => {
    const s = make(),
      id = s.create("owner", defaultPreferences);
    s.location(id, "owner", { ...pos(), accuracy: 1200 });
    expect(s.claim()).toBeTruthy();
    s.addCandidates(id, [
      {
        id: "desktop-place",
        name: "Nearby",
        address: "Example",
        lat: 37.7749,
        lng: -122.4194,
        distance: 0,
        status: "discovered",
      },
    ]);
    expect(s.state(id, "owner").encounters).toHaveLength(0);
  });
  it("does not research stale desktop fixes", () => {
    const s = make(),
      id = s.create("owner", defaultPreferences);
    s.location(id, "owner", {
      ...pos(),
      accuracy: 1200,
      timestamp: Date.now() - 31000,
    });
    expect(s.claim()).toBeNull();
  });
  it("requires a recent worker heartbeat when enabled in deployment", () => {
    const s = new Store(":memory:", true, true);
    stores.push(s);
    const id = s.create("owner", defaultPreferences);
    s.location(id, "owner", pos());
    expect(s.claim()).toBeNull();
    s.workerUntil = Date.now() + 20000;
    s.location(id, "owner", pos());
    expect(s.claim()).toBeTruthy();
  });
  it("cancels orphaned queued work after heartbeat loss", () => {
    const s = make(),
      id = s.create("owner", defaultPreferences);
    s.location(id, "owner", pos());
    s.db.prepare("UPDATE walks SET heartbeat=0 WHERE id=?").run(id);
    s.tick();
    expect(
      s.db.prepare("SELECT count(*) n FROM jobs WHERE state='queued'").get(),
    ).toMatchObject({ n: 0 });
  });
  it("does not schedule when connections are disabled", () => {
    const s = make(false),
      id = s.create("owner", defaultPreferences);
    s.location(id, "owner", pos());
    expect(s.claim()).toBeNull();
  });
  it("coalesces positions and permits only one queued/running job", () => {
    const s = make(),
      id = s.create("owner", defaultPreferences);
    s.location(id, "owner", pos());
    s.location(id, "owner", pos(37.78));
    const job = s.claim()!;
    expect(job).toBeTruthy();
    expect(s.claim()).toBeNull();
    s.tick();
    expect(s.db.prepare("SELECT count(*) n FROM jobs").get()).toMatchObject({
      n: 1,
    });
  });
  it("finishes an in-flight mission while paused and does not schedule another", () => {
    const s = make(),
      id = s.create("owner", defaultPreferences);
    s.location(id, "owner", pos());
    const j = s.claim()!;
    s.pause(id, "owner");
    s.finish(j.id, j.lease, "test-thread", null);
    s.tick();
    expect(s.state(id, "owner").status).toBe("paused");
    expect(s.claim()).toBeNull();
  });
  it("cancels queued work when the page leaves", () => {
    const s = make(),
      id = s.create("owner", defaultPreferences);
    s.location(id, "owner", pos());
    s.pause(id, "owner");
    expect(s.claim()).toBeNull();
  });
  it("pauses when heartbeat expires", () => {
    const s = make(),
      id = s.create("owner", defaultPreferences);
    s.db.prepare("UPDATE walks SET heartbeat=0 WHERE id=?").run(id);
    s.tick();
    expect(s.state(id, "owner").status).toBe("paused");
  });
  it("enforces mission tool limits and prevents expired lease use", () => {
    const s = make(),
      id = s.create("owner", defaultPreferences);
    s.location(id, "owner", pos());
    const j = s.claim()!;
    for (let i = 0; i < 12; i++) s.tool(j.id, j.lease);
    expect(() => s.tool(j.id, j.lease)).toThrow("limit");
    expect(() => s.tool(j.id, "wrong")).toThrow("expired");
  });
  it("persists counters and interrupts rather than replays jobs after restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "bizroam-"));
    try {
      const path = join(dir, "db.sqlite");
      const s = make(true, path);
      s.reserve("parallel", 1);
      const id = s.create("owner", defaultPreferences);
      s.location(id, "owner", pos());
      s.claim();
      s.db.close();
      stores.pop();
      const next = make(true, path);
      expect(() => next.reserve("parallel", 1)).toThrow("limit");
      expect(next.claim()).toBeNull();
      expect(next.state(id, "owner").status).toBe("paused");
    } finally {
      for (const s of stores.splice(0)) s.db.close();
      rmSync(dir, { recursive: true });
    }
  });
  it("rejects access to another browser session", () => {
    const s = make(),
      id = s.create("owner", defaultPreferences);
    expect(() => s.state(id, "other")).toThrow("not found");
  });
  it("does not start a second walk while another is active", () => {
    const s = make();
    s.create("owner", defaultPreferences);
    expect(() => s.create("other", defaultPreferences)).toThrow(
      "already active",
    );
  });
});
