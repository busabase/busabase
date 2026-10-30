import {
  createAgentPromptEnvelope,
  createPromptResourceContext,
} from "busabase-contract/domains/agents/prompt-context";
import { describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../../../context";
import { validateAgentPromptResourceContext } from "./agent-prompt-context";

const snapshot = (source = { origin: "https://busa.test", edition: "desktop" as const }) =>
  createPromptResourceContext(
    createAgentPromptEnvelope({
      scenario: { id: "find-records", title: "Find records" },
      target: { nodeId: "private-node", nodeName: "目标", nodeType: "base" },
      source,
      segments: [{ kind: "task", text: "完整内容\nDo not truncate. " }],
    }),
    "insertion-1",
  );

describe("server Agent prompt snapshot validation", () => {
  it("rebuilds a non-fetching URI and preserves exact content without resolving the target", async () => {
    const input = { ...snapshot(), uri: "https://attacker.test/do-not-fetch" };
    const parsed = await runWithBusabaseContext({ embedOrigin: "https://busa.test" }, async () =>
      validateAgentPromptResourceContext([input]),
    );
    expect(parsed).toEqual([{ ...input, uri: "busabase-agent-prompt:///insertion-1" }]);
  });

  it.each([
    {},
    { embedOrigin: "https://other.test" },
    { embedOrigin: "https://busa.test", spaceId: "org-other" },
  ])("rejects incompatible or absent trusted host context %j", async (host) => {
    await expect(
      runWithBusabaseContext(host, async () => validateAgentPromptResourceContext([snapshot()])),
    ).rejects.toThrow(/different Busabase/);
  });

  it("checks cloud workspace identity independently of descriptive target ids", async () => {
    const input = createPromptResourceContext(
      createAgentPromptEnvelope({
        ...snapshot().metadata["busabase.agentPrompt"],
        source: { origin: "https://busa.test", edition: "cloud", spaceId: "org-a" },
      }),
      "cloud-context",
    );
    expect(
      await runWithBusabaseContext(
        { embedOrigin: "https://busa.test", spaceId: "org-a" },
        async () => validateAgentPromptResourceContext([input]),
      ),
    ).toEqual([input]);
    await expect(
      runWithBusabaseContext({ embedOrigin: "https://busa.test", spaceId: "org-b" }, async () =>
        validateAgentPromptResourceContext([input]),
      ),
    ).rejects.toThrow(/different Busabase/);
  });

  it("rejects inconsistent text and oversized context arrays", () => {
    const input = snapshot();
    expect(() =>
      validateAgentPromptResourceContext([{ ...input, text: `${input.text}\n` }]),
    ).toThrow();
    expect(() => validateAgentPromptResourceContext(new Array(21).fill(input))).toThrow();
    expect(validateAgentPromptResourceContext(undefined)).toEqual([]);
  });
});
