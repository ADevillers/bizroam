import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { hash } from "@node-rs/argon2";
import { createWeb } from "../services/web/src/app.js";
import { createTools } from "../services/tools/src/app.js";
import { Store } from "../services/tools/src/store.js";
import {
  newsArguments,
  newsLinks,
  extractSources,
} from "../services/tools/src/providers.js";
it('associates citations with pretty-printed financial objects and escaped strings', () => {
  const facts = { description: 'A company with "quoted" text', companyValue: { amountUsd: 1e9, kind: 'valuation', asOf: '2025' }, funding: null };
  const text = JSON.stringify(facts, null, 2);
  const start = text.indexOf('1000000000');
  const sources = extractSources([{ text, annotations: [{ type: 'url_citation', url: 'https://example.com/value', title: 'Value source', start_index: start, end_index: start + 10 }] }], facts);
  expect(sources[0].fields).toEqual(['companyValue']);
});
let passwordHash: string;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  passwordHash = await hash("test-password");
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
async function web() {
  let calls = 0;
  const app = await createWeb({
    dbPath: ":memory:",
    passwordHash,
    origin: "http://localhost:3000",
    toolsUrl: "http://internal",
    toolsToken: "w".repeat(64),
    secure: false,
    transport: async () => {
      calls++;
      return new Response(JSON.stringify({ configured: false }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  closers.push(() => app.close());
  return { app, calls: () => calls };
}
async function login(app: any) {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: "http://localhost:3000" },
    payload: { password: "test-password" },
  });
  return { cookie: r.headers["set-cookie"].split(";")[0], csrf: r.json().csrf };
}
describe("public boundary", () => {
  it("rejects all protected routes including SSE before calling a provider", async () => {
    const { app, calls } = await web();
    for (const url of [
      "/api/config",
      "/api/walks/x/state",
      "/api/walks/x/events",
      "/api/companies/x",
      "/api/places/x",
    ])
      expect((await app.inject({ url })).statusCode).toBe(401);
    expect(calls()).toBe(0);
  });
  it("protects login from cross-origin requests", async () => {
    const { app } = await web();
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://evil.example" },
      payload: { password: "test-password" },
    });
    expect(r.statusCode).toBe(403);
  });
  it("sets HttpOnly cookies and requires CSRF for mutations", async () => {
    const { app, calls } = await web();
    const { cookie, csrf } = await login(app);
    expect(cookie).toContain("bizroam=");
    const r = await app.inject({
      method: "POST",
      url: "/api/walks",
      headers: { cookie, origin: "http://localhost:3000" },
      payload: { tags: [], text: "" },
    });
    expect(r.statusCode).toBe(403);
    expect(calls()).toBe(0);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: {
            cookie,
            origin: "http://localhost:3000",
            "x-csrf-token": csrf,
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/config", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
  });
  it("limits failed passwords and ignores forged forwarded headers", async () => {
    const { app } = await web();
    for (let i = 0; i < 5; i++)
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/login",
            headers: {
              origin: "http://localhost:3000",
              "x-forwarded-for": `1.2.3.${i}`,
            },
            payload: { password: "wrong" },
          })
        ).statusCode,
      ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin: "http://localhost:3000" },
          payload: { password: "test-password" },
        })
      ).statusCode,
    ).toBe(429);
  });
});
describe("internal boundary", () => {
  it("separates web and worker capabilities and rejects arbitrary tools", async () => {
    const s = new Store(":memory:", true),
      app = createTools(s, "w".repeat(64), "k".repeat(64));
    closers.push(async () => {
      await app.close();
      s.db.close();
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/worker/claim",
          headers: { authorization: `Bearer ${"w".repeat(64)}` },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/worker/tool",
          headers: { authorization: `Bearer ${"k".repeat(64)}` },
          payload: {
            id: "x",
            lease: "x",
            tool: "shell",
            args: { command: "cat /secrets" },
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: "/web/config",
          headers: { authorization: `Bearer ${"k".repeat(64)}` },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("only allows controlled community search arguments and normalized Hacker News links", () => {
    expect(
      newsArguments(
        {
          properties: {
            query: { type: "string" },
            size: { type: "integer" },
            tags: { type: "array" },
          },
          required: ["query"],
        },
        "NerdWallet",
      ),
    ).toEqual({ query: "NerdWallet", size: 3, tags: ["story"] });
    expect(
      newsArguments(
        {
          properties: {
            query: { type: "string" },
            hits_per_page: { type: "integer" },
            url: { type: "string" },
          },
        },
        "Example company",
      ),
    ).toEqual({ query: "Example company", hits_per_page: 3 });
    expect(() =>
      newsArguments(
        {
          required: ["url"],
          properties: { query: { type: "string" }, url: { type: "string" } },
        },
        "Example",
      ),
    ).toThrow("unsupported");
    expect(
      newsLinks(
        {
          data: {
            hits: [
              {
                title: "Example launches",
                objectID: "123",
                url: "https://evil.example",
              },
              { title: "Unrelated", objectID: "456" },
              { title: "Example", objectID: "../bad" },
            ],
          },
        },
        "Example",
      ),
    ).toEqual([
      {
        title: "Example launches",
        url: "https://news.ycombinator.com/item?id=123",
      },
    ]);
  });
  it("maps citations to the supported field and excludes dangerous URLs", () => {
    const text = JSON.stringify({
      description: "Makes useful robots",
      address: null,
    });
    const i = text.indexOf("Makes");
    const sources = extractSources(
      [
        {
          text,
          annotations: [
            {
              type: "url_citation",
              url: "https://example.com",
              title: "Source",
              start_index: i,
              end_index: i + 5,
            },
            {
              type: "url_citation",
              url: "javascript:alert(1)",
              start_index: 0,
              end_index: 100,
            },
          ],
        },
      ],
      { description: "Makes useful robots", address: null },
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].fields).toEqual(["description"]);
  });
});
