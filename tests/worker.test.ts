import { it, expect } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  statSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareWorkspace } from "../services/worker/src/workspace.js";
it("restarts with an existing read-only mission and replaces it atomically", () => {
  const dir = mkdtempSync(join(tmpdir(), "bizroam-worker-"));
  try {
    prepareWorkspace(dir, "First mission");
    expect(statSync(join(dir, "AGENTS.md")).mode & 0o222).toBe(0);
    prepareWorkspace(dir, "Updated fixed mission");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe(
      "Updated fixed mission\n",
    );
    expect(readdirSync(dir)).toEqual(["AGENTS.md"]);
    expect(statSync(join(dir, "AGENTS.md")).mode & 0o222).toBe(0);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

import { agentConfig, MissionProgress } from "../services/worker/src/agent.js";
import type { ThreadEvent } from "@openai/codex-sdk";
const toolEvent = (
  tool: string,
  result: unknown,
  status = "completed",
  server = "bizroam",
) =>
  ({
    type: "item.completed",
    item: {
      id: "test",
      type: "mcp_tool_call",
      server,
      tool,
      arguments: {},
      status,
      result: {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structured_content: null,
      },
    },
  }) as ThreadEvent;
it("preauthorizes only the four bounded business tools and keeps other capabilities disabled", () => {
  const config = agentConfig("/app/mcp.js");
  expect(config.features.shell_tool).toBe(false);
  expect(config.web_search).toBe("disabled");
  expect(config.mcp_servers.bizroam.enabled_tools).toEqual([
    "context",
    "discover",
    "research",
    "publish",
  ]);
  expect(config.mcp_servers.bizroam.default_tools_approval_mode).toBe("prompt");
  expect(Object.keys(config.mcp_servers.bizroam.tools)).toEqual(
    config.mcp_servers.bizroam.enabled_tools,
  );
});
it("does not report a conversation without executed business tools as successful", () => {
  expect(() => new MissionProgress().assertComplete()).toThrow(
    "research tools",
  );
  const failed = new MissionProgress();
  failed.observe(toolEvent("context", null, "failed"));
  expect(() => failed.assertComplete()).toThrow("research tools");
});
it("accepts an empty verified search, handles partial success, and rejects unexpected tools", () => {
  const p = new MissionProgress();
  p.observe(toolEvent("context", { preferences: { tags: [], text: "" } }));
  p.observe(toolEvent("discover", []));
  expect(() => p.assertComplete()).not.toThrow();
  p.observe(toolEvent("research", null, "failed"));
  expect(() => p.assertComplete()).toThrow("profile");
  p.observe(toolEvent("publish", { published: true }));
  expect(() => p.assertComplete()).not.toThrow();
  expect(() => p.observe(toolEvent("shell", {}))).toThrow("unexpected tool");
  expect(() =>
    p.observe(toolEvent("context", {}, "completed", "another-server")),
  ).toThrow("unexpected tool");
});
