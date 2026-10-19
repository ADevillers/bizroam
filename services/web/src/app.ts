import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import statics from "@fastify/static";
import { verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { openDb } from "../../../packages/shared/src/db.js";
import {
  digest,
  equal,
  statusError,
} from "../../../packages/shared/src/security.js";
import {
  PreferencesSchema,
  LocationSchema,
} from "../../../packages/shared/src/schema.js";
export type WebOptions = {
  dbPath: string;
  passwordHash: string;
  origin: string;
  toolsUrl: string;
  toolsToken: string;
  secure?: boolean;
  uiPath?: string;
  trustProxy?: string;
  transport?: typeof fetch;
};
export async function createWeb(o: WebOptions) {
  const db = openDb(o.dbPath);
  const origin = new URL(o.origin).origin;
  const transport = o.transport || fetch;
  const app = Fastify({
    bodyLimit: 8192,
    trustProxy: o.trustProxy ? [o.trustProxy] : false,
    logger: {
      level: "info",
      redact: [
        "req.headers.cookie",
        "req.headers.authorization",
        "res.headers.set-cookie",
      ],
      serializers: {
        req: (q) => ({ method: q.method, url: q.url.split("?")[0] }),
      },
    },
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        upgradeInsecureRequests: o.secure === false ? null : [],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https://tile.openstreetmap.org"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
  async function call(path: string, body?: unknown) {
    const response = await transport(`${o.toolsUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${o.toolsToken}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      let message = "Research service unavailable";
      try {
        message = ((await response.json()) as any).error || message;
      } catch {}
      throw statusError(message, response.status);
    }
    return response.json() as Promise<any>;
  }
  app.setErrorHandler((e: any, _q, r) =>
    r.code(e instanceof z.ZodError ? 400 : e.statusCode || 503).send({
      error:
        e instanceof z.ZodError
          ? "Invalid request"
          : e.statusCode
            ? e.message
            : "Service temporarily unavailable",
    }),
  );
  app.addHook("onRequest", async (q, r) => {
    if (!q.url.startsWith("/api/")) return;
    r.header("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(q.method) &&
      q.headers.origin !== origin
    )
      return r.code(403).send({ error: "Request origin rejected" });
    if (q.url === "/api/auth/login" || q.url === "/api/session") return;
    const token = q.cookies.bizroam;
    const session = token
      ? (db
          .prepare("SELECT * FROM sessions WHERE id=? AND expires>?")
          .get(digest(token), Date.now()) as any)
      : null;
    if (!session) return r.code(401).send({ error: "Sign in to continue" });
    (q as any).session = session;
    if (
      !["GET", "HEAD"].includes(q.method) &&
      !equal(q.headers["x-csrf-token"] as string, session.csrf)
    )
      return r.code(403).send({ error: "Invalid session token" });
  });
  app.get("/healthz", () => ({ ok: true }));
  app.post("/api/auth/login", async (q, r) => {
    const { password } = z
      .object({ password: z.string().min(1).max(200) })
      .strict()
      .parse(q.body);
    const now = Date.now();
    db.prepare("DELETE FROM login_attempts WHERE at<?").run(now - 900000);
    const count = (key: string) =>
      Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM login_attempts WHERE key=? AND at>?",
            )
            .get(key, now - 900000) as any
        ).n,
      );
    if (count(q.ip) >= 5 || count("global") >= 50)
      return r
        .code(429)
        .send({ error: "Too many attempts. Try again in 15 minutes." });
    db.prepare("INSERT INTO login_attempts VALUES(?,?)").run(q.ip, now);
    db.prepare("INSERT INTO login_attempts VALUES(?,?)").run("global", now);
    if (!(await verify(o.passwordHash, password)))
      return r.code(401).send({ error: "That password does not match." });
    db.prepare("DELETE FROM login_attempts WHERE key=? AND at=?").run(
      q.ip,
      now,
    );
    db.prepare("DELETE FROM login_attempts WHERE key='global' AND at=?").run(
      now,
    );
    const token = randomBytes(32).toString("base64url"),
      csrf = randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM sessions WHERE expires<?").run(now);
    if (q.cookies.bizroam)
      db.prepare("DELETE FROM sessions WHERE id=?").run(
        digest(q.cookies.bizroam),
      );
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      digest(token),
      csrf,
      now + 86400000,
    );
    r.setCookie("bizroam", token, {
      httpOnly: true,
      secure: o.secure !== false,
      sameSite: "strict",
      path: "/",
      maxAge: 86400,
    });
    return { authenticated: true, csrf };
  });
  app.get("/api/session", (q) => {
    const s = q.cookies.bizroam
      ? (db
          .prepare("SELECT csrf FROM sessions WHERE id=? AND expires>?")
          .get(digest(q.cookies.bizroam), Date.now()) as any)
      : null;
    return s ? { authenticated: true, csrf: s.csrf } : { authenticated: false };
  });
  app.post("/api/auth/logout", async (q, r) => {
    db.prepare("DELETE FROM sessions WHERE id=?").run((q as any).session.id);
    r.clearCookie("bizroam", { path: "/" });
    return { ok: true };
  });
  app.get("/api/config", async () => ({
    mapProvider: "openstreetmap",
    ...(await call("/web/config")),
  }));
  app.post("/api/walks", (q) =>
    call("/web/walks", {
      owner: (q as any).session.id,
      preferences: PreferencesSchema.parse(q.body),
    }),
  );
  const action = (q: any, which: string, value?: unknown) =>
    call("/web/action", {
      id: q.params.id,
      owner: q.session.id,
      action: which,
      ...(value === undefined ? {} : { value }),
    });
  app.post("/api/walks/:id/location", (q) =>
    action(q, "location", LocationSchema.parse(q.body)),
  );
  app.patch("/api/walks/:id/preferences", (q) =>
    action(q, "preferences", PreferencesSchema.parse(q.body)),
  );
  app.post("/api/walks/:id/pause", (q) => action(q, "pause"));
  app.post("/api/walks/:id/resume", (q) => action(q, "resume"));
  app.get("/api/walks/:id/state", (q) => action(q, "state"));
  app.get("/api/places/:id", (q) =>
    call("/web/place", {
      id: (q.params as any).id,
      owner: (q as any).session.id,
    }),
  );
  app.get("/api/companies/:id", (q) =>
    call("/web/company", {
      id: (q.params as any).id,
      owner: (q as any).session.id,
    }),
  );
  app.get("/api/walks/:id/events", async (q, r) => {
    const initial = await action(q, "state");
    r.hijack();
    r.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    let cursor = Number(q.headers["last-event-id"] || 0);
    let busy = false;
    let closed = false;
    const push = (state: any) => {
      const events = state.events.filter((e: any) => e.id > cursor);
      for (const e of events) {
        r.raw.write(
          `id: ${e.id}\nevent: discovery\ndata: ${JSON.stringify(e)}\n\n`,
        );
        cursor = e.id;
      }
    };
    push(initial);
    const timer = setInterval(async () => {
      if (busy || closed) return;
      busy = true;
      try {
        if ((q as any).session.expires < Date.now()) {
          r.raw.end();
          return;
        }
        const state = await action(q, "state");
        push(state);
        r.raw.write(": heartbeat\n\n");
      } catch {
        r.raw.end();
      } finally {
        busy = false;
      }
    }, 2000);
    r.raw.on("close", () => {
      closed = true;
      clearInterval(timer);
    });
  });
  const ui = o.uiPath || resolve("dist-ui");
  if (existsSync(ui)) {
    await app.register(statics, { root: ui, prefix: "/" });
    app.setNotFoundHandler((q, r) => {
      if (q.url.startsWith("/api/"))
        return r.code(404).send({ error: "Not found" });
      return r.sendFile("index.html");
    });
  }
  app.addHook("onClose", () => {
    db.close();
  });
  return app;
}
