import { describe, expect, it } from "vitest";
import { agentClientHeaders, detectAgentClient } from "./agent-client";

describe("detectAgentClient", () => {
  it("returns nothing outside an agent", () => {
    expect(detectAgentClient({})).toBeUndefined();
    expect(detectAgentClient({ HOME: "/home/kelly", TERM: "xterm" })).toBeUndefined();
  });

  it("detects Claude Code (measured: CLAUDECODE=1)", () => {
    expect(detectAgentClient({ CLAUDECODE: "1" })).toBe("claude-code");
  });

  it("detects Codex (measured: CODEX_SESSION_ID / CODEX_THREAD_ID)", () => {
    expect(detectAgentClient({ CODEX_SESSION_ID: "x" })).toBe("codex");
    expect(detectAgentClient({ CODEX_THREAD_ID: "x" })).toBe("codex");
  });

  it("detects OpenCode, Gemini CLI and Pi from their source-verified markers", () => {
    expect(detectAgentClient({ OPENCODE: "1" })).toBe("opencode");
    expect(detectAgentClient({ GEMINI_CLI: "1" })).toBe("gemini-cli");
    expect(detectAgentClient({ PI_CODING_AGENT: "true" })).toBe("pi");
  });

  it("does not fire on a marker that is set but false-y", () => {
    expect(detectAgentClient({ CLAUDECODE: "0" })).toBeUndefined();
    expect(detectAgentClient({ CODEX_SESSION_ID: "  " })).toBeUndefined();
    expect(detectAgentClient({ PI_CODING_AGENT: "false" })).toBeUndefined();
  });

  it("falls back to the generic AI_AGENT convention, tool part only", () => {
    expect(detectAgentClient({ AI_AGENT: "claude-code_2-1-304_agent" })).toBe("claude-code");
    expect(detectAgentClient({ AI_AGENT: "hermes_0-9_agent" })).toBe("hermes");
    expect(detectAgentClient({ AI_AGENT: "opencode" })).toBe("opencode");
  });

  it("precedence: BUSABASE_AGENT > specific markers > AI_AGENT", () => {
    const all = {
      BUSABASE_AGENT: "my-bot",
      CLAUDECODE: "1",
      CODEX_SESSION_ID: "x",
      AI_AGENT: "something_1_agent",
    };
    expect(detectAgentClient(all)).toBe("my-bot");
    expect(detectAgentClient({ ...all, BUSABASE_AGENT: "" })).toBe("claude-code");
    expect(detectAgentClient({ CODEX_SESSION_ID: "x", AI_AGENT: "something_1_agent" })).toBe(
      "codex",
    );
  });

  it("drops a value the server would throw away anyway", () => {
    expect(detectAgentClient({ BUSABASE_AGENT: "!!!" })).toBeUndefined();
    expect(detectAgentClient({ BUSABASE_AGENT: "!!!", CLAUDECODE: "1" })).toBe("claude-code");
    expect(detectAgentClient({ AI_AGENT: "___" })).toBeUndefined();
  });
});

describe("agentClientHeaders", () => {
  it("sends x-busabase-agent only when an agent was detected", () => {
    expect(agentClientHeaders({ CODEX_SESSION_ID: "x" })).toEqual({ "x-busabase-agent": "codex" });
    expect(agentClientHeaders({})).toBeUndefined();
  });
});
