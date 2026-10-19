import { it, expect } from "vitest";
import Fastify from "fastify";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
it("publishes a sourced profile even when the agent supplies an overlong relevance sentence", async () => {
  const app = Fastify();
  let body: any;
  app.post("/worker/tool", async (req) => {
    body = req.body;
    return { published: true };
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", resolve("services/worker/src/mcp.ts")],
    env: {
      PATH: process.env.PATH!,
      TOOLS_URL: address,
      WORKER_TOOLS_TOKEN: "test-only-token",
      BIZROAM_JOB_ID: "test-job",
      BIZROAM_JOB_LEASE: "test-lease",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "test-bizroam", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual([
      "context",
      "discover",
      "research",
      "publish",
    ]);
    const result = await client.callTool({
      name: "publish",
      arguments: {
        companyId: "osm:node:42",
        reason: "A relevant nearby technology company. ".repeat(15),
      },
    });
    expect(result.isError).not.toBe(true);
    expect(body.args.companyId).toBe("osm:node:42");
    expect(body.args.reason.length).toBeLessThanOrEqual(400);
    expect(body.tool).toBe("publish");
  } finally {
    await client.close();
    await transport.close();
    await app.close();
  }
}, 15000);
