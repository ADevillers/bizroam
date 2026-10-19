import Fastify from "fastify";
import { z } from "zod";
import { equal, statusError } from "../../../packages/shared/src/security.js";
import {
  PreferencesSchema,
  LocationSchema,
} from "../../../packages/shared/src/schema.js";
import { Store } from "./store.js";
import { Providers } from "./providers.js";
export function createTools(
  store: Store,
  webToken: string,
  workerToken: string,
) {
  const app = Fastify({ bodyLimit: 16384, logger: false });
  const providers = new Providers(store);
  const researched = new Map<string, Map<string, any>>();
  app.setErrorHandler((e: any, _q, r) =>
    r.code(e.statusCode || 400).send({
      error:
        e instanceof z.ZodError
          ? "Invalid request"
          : e.statusCode
            ? e.message
            : "Service request failed",
    }),
  );
  app.addHook("onRequest", async (q, r) => {
    if (q.url === "/healthz") return;
    const token = q.headers.authorization?.replace(/^Bearer /, "");
    const expected = q.url.startsWith("/worker/") ? workerToken : webToken;
    if (!equal(token, expected))
      return r.code(401).send({ error: "Unauthorized" });
  });
  app.get("/healthz", () => ({ ok: true }));
  app.post("/web/walks", async (q) => {
    const b = z
      .object({ owner: z.string(), preferences: PreferencesSchema })
      .strict()
      .parse(q.body);
    return { id: store.create(b.owner, b.preferences) };
  });
  app.post("/web/action", async (q) => {
    const b = z
      .object({
        id: z.string().uuid(),
        owner: z.string(),
        action: z.enum(["location", "preferences", "pause", "resume", "state"]),
        value: z.unknown().optional(),
      })
      .strict()
      .parse(q.body);
    store.walk(b.id, b.owner);
    switch (b.action) {
      case "location":
        store.location(b.id, b.owner, LocationSchema.parse(b.value));
        break;
      case "preferences":
        store.preferences(b.id, b.owner, PreferencesSchema.parse(b.value));
        break;
      case "pause":
        store.pause(b.id, b.owner);
        break;
      case "resume":
        store.resume(b.id, b.owner);
        break;
    }
    return store.state(b.id, b.owner);
  });
  app.post("/web/company", async (q) => {
    const b = z
      .object({ id: z.string().max(256), owner: z.string() })
      .strict()
      .parse(q.body);
    const allowed = store.db
      .prepare(
        "SELECT candidate_refs.id FROM candidate_refs JOIN walks ON walks.id=candidate_refs.walk_id WHERE walks.owner=? AND candidate_refs.id=?",
      )
      .get(b.owner, b.id);
    if (!allowed) throw statusError("Company not found", 404);
    return store.profile(b.id) || null;
  });
  app.post("/web/place", async (q) => {
    const b = z
      .object({ id: z.string().max(256), owner: z.string() })
      .strict()
      .parse(q.body);
    const allowed = store.db
      .prepare(
        "SELECT candidate_refs.id FROM candidate_refs JOIN walks ON walks.id=candidate_refs.walk_id WHERE walks.owner=? AND candidate_refs.id=?",
      )
      .get(b.owner, b.id);
    if (!allowed) throw statusError("Place not found", 404);
    return providers.restorePlace(b.id);
  });
  app.get("/web/config", () => ({ configured: store.ready }));
  app.post("/worker/heartbeat", (q) => {
    const b = z.object({ ready: z.boolean() }).strict().parse(q.body);
    store.workerUntil = b.ready ? Date.now() + 20000 : 0;
    return { ok: true };
  });
  app.post("/worker/claim", () => store.claim());
  app.post("/worker/checkpoint", (q) => {
    const b = z
      .object({ id: z.string(), lease: z.string(), threadId: z.string() })
      .strict()
      .parse(q.body);
    const job = store.job(b.id, b.lease);
    store.db
      .prepare("UPDATE walks SET thread_id=? WHERE id=?")
      .run(b.threadId, job.walk_id);
    return { ok: true };
  });
  app.post("/worker/finish", (q) => {
    const b = z
      .object({
        id: z.string(),
        lease: z.string(),
        threadId: z.string().nullable(),
        error: z.string().max(200).nullable(),
      })
      .strict()
      .parse(q.body);
    const job = store.db
      .prepare("SELECT * FROM jobs WHERE id=?")
      .get(b.id) as any;
    store.finish(b.id, b.lease, b.threadId, b.error);
    console.info(
      JSON.stringify({
        event: "mission.finished",
        durationMs: Date.now() - job.started,
        ok: !b.error,
        tools: job.tool_count,
        research: job.research_count,
      }),
    );
    researched.delete(b.id);
    return { ok: true };
  });
  app.post("/worker/tool", async (q) => {
    const b = z
      .object({
        id: z.string(),
        lease: z.string(),
        tool: z.enum(["context", "discover", "research", "publish"]),
        args: z.record(z.string(), z.unknown()),
      })
      .strict()
      .parse(q.body);
    const job = store.tool(b.id, b.lease);
    if (b.tool === "context") {
      const w = store.walk(job.walk_id);
      return {
        preferences: JSON.parse(w.preferences),
        previousProfiles: store
          .state(w.id, w.owner)
          .profiles.map((p) => ({ id: p.id, name: p.name, tags: p.tags })),
        maximumCompanies: 3,
      };
    }
    if (b.tool === "discover") {
      const args = z
        .object({ query: z.string().max(150).default("") })
        .strict()
        .parse(b.args);
      return providers.discover(job, args.query);
    }
    if (b.tool === "research") {
      const args = z
        .object({
          companyId: z.string().max(256),
          deeper: z.boolean().default(false),
        })
        .strict()
        .parse(b.args);
      const profile = await providers.research(
        job,
        args.companyId,
        args.deeper,
      );
      const cache = researched.get(job.id) || new Map();
      cache.set(profile.id, profile);
      researched.set(job.id, cache);
      return profile;
    }
    const args = z
      .object({
        companyId: z.string().max(256),
        reason: z.string().min(1).max(400),
      })
      .strict()
      .parse(b.args);
    const profile = researched.get(job.id)?.get(args.companyId);
    if (!profile) throw statusError("Research the company before publication");
    store.publish(job.walk_id, { ...profile, reason: args.reason });
    return { published: true };
  });
  return app;
}
