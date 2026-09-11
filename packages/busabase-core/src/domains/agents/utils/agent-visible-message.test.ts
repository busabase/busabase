import { describe, expect, it } from "vitest";
import { shouldRenderAgentMessage } from "./agent-visible-message";

describe("shouldRenderAgentMessage", () => {
  it("hides a legacy persisted unsupported-HTTP-MCP note", () => {
    expect(
      shouldRenderAgentMessage(
        "Claude Code does not support HTTP MCP servers, so it has no access to this workspace's data. It can still answer general questions.",
      ),
    ).toBe(false);
  });

  it("hides the same note regardless of which agent's name it was stamped with", () => {
    expect(
      shouldRenderAgentMessage(
        "Some Other Agent does not support HTTP MCP servers, so it has no access to this workspace's data. It can still answer general questions.",
      ),
    ).toBe(false);
  });

  it("hides bare ACP connection-closed transport noise", () => {
    expect(shouldRenderAgentMessage("ACP connection closed")).toBe(false);
  });

  it("hides ACP connection-closed noise with a punctuation/whitespace prefix", () => {
    expect(shouldRenderAgentMessage(":ACP connection closed")).toBe(false);
    expect(shouldRenderAgentMessage("  : ACP connection closed.")).toBe(false);
    expect(shouldRenderAgentMessage("Error: ACP connection closed")).toBe(false);
  });

  it("keeps a legitimate attachment/capability note", () => {
    expect(
      shouldRenderAgentMessage(
        "This agent does not support audio attachments, so budget.pdf was not sent.",
      ),
    ).toBe(true);
  });

  it("keeps an arbitrary session-level note that merely mentions a connection", () => {
    expect(shouldRenderAgentMessage("Reconnecting to the agent after a network blip…")).toBe(true);
  });
});
