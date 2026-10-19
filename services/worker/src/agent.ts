import type { ThreadEvent } from "@openai/codex-sdk";

const tools = ["context", "discover", "research", "publish"];
export function agentConfig(mcpPath: string) {
  return {
    features: {
      shell_tool: false,
      shell_snapshot: false,
      skill_mcp_dependency_install: false,
    },
    web_search: "disabled",
    mcp_servers: {
      bizroam: {
        command: process.execPath,
        args: [mcpPath],
        env_vars: [
          "TOOLS_URL",
          "WORKER_TOOLS_TOKEN",
          "BIZROAM_JOB_ID",
          "BIZROAM_JOB_LEASE",
        ],
        enabled_tools: tools,
        default_tools_approval_mode: "prompt",
        tools: Object.fromEntries(
          tools.map((name) => [name, { approval_mode: "approve" }]),
        ),
        required: true,
        tool_timeout_sec: 100,
      },
    },
    tool_output_token_limit: 5000,
  };
}

export class MissionError extends Error {}
export class MissionProgress {
  private context = false;
  private discovered = false;
  private failed = false;
  private published = 0;
  observe(event: ThreadEvent) {
    if (event.type !== "item.completed") return;
    const item = event.item;
    if (["command_execution", "web_search", "file_change"].includes(item.type))
      throw new MissionError(
        "The guide stopped after an unexpected capability request.",
      );
    if (item.type !== "mcp_tool_call") return;
    if (item.server !== "bizroam" || !tools.includes(item.tool))
      throw new MissionError(
        "The guide stopped after an unexpected tool request.",
      );
    if (item.status !== "completed") {
      this.failed = true;
      return;
    }
    let result: any;
    try {
      result = JSON.parse(
        (item.result?.content || [])
          .filter((c) => c.type === "text")
          .map((c) => (c.type === "text" ? c.text : ""))
          .join(""),
      );
    } catch {
      this.failed = true;
      return;
    }
    if (
      item.tool === "context" &&
      result &&
      typeof result.preferences === "object"
    )
      this.context = true;
    if (item.tool === "discover" && Array.isArray(result))
      this.discovered = true;
    if (item.tool === "publish" && result?.published === true) this.published++;
  }
  assertComplete() {
    if (!this.context || !this.discovered)
      throw new MissionError(
        "The guide could not access its research tools. Pause and resume to retry.",
      );
    if (this.failed && !this.published)
      throw new MissionError(
        "Research could not produce a verified profile. Pause and resume to retry.",
      );
  }
}
