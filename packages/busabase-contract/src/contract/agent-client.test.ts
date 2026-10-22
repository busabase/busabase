import { describe, expect, it } from "vitest";
import { normalizeAgentClient } from "./agent-client";
import { sourceAttributionSchema } from "./schemas";

describe("normalizeAgentClient", () => {
  it("maps known agents to their product name", () => {
    expect(normalizeAgentClient("codex")).toEqual({ id: "codex", name: "Codex" });
    expect(normalizeAgentClient("claude-code")).toEqual({ id: "claude-code", name: "Claude Code" });
    expect(normalizeAgentClient("  Claude Code ")).toEqual({
      id: "claude-code",
      name: "Claude Code",
    });
    expect(normalizeAgentClient("opencode")).toEqual({ id: "opencode", name: "OpenCode" });
    expect(normalizeAgentClient("gemini-cli")).toEqual({ id: "gemini-cli", name: "Gemini CLI" });
    expect(normalizeAgentClient("pi")).toEqual({ id: "pi", name: "Pi" });
  });

  it("understands the AI_AGENT `<tool>_<version>_agent` convention", () => {
    expect(normalizeAgentClient("claude-code_2-1-304_agent")).toEqual({
      id: "claude-code",
      name: "Claude Code",
    });
    expect(normalizeAgentClient("hermes_1-0_agent")).toEqual({ id: "hermes", name: "Hermes" });
  });

  it("sanitizes unknown agents into a safe id and a derived name", () => {
    expect(normalizeAgentClient("My_Custom Agent!")).toEqual({
      id: "my-custom-agent",
      name: "My Custom Agent",
    });
    const html = normalizeAgentClient('<img src=x onerror="alert(1)">');
    expect(html).toEqual({ id: "img-src-x-onerror-alert-1", name: "Img Src X Onerror Alert 1" });
    expect(`${html?.id}${html?.name}`).not.toMatch(/[<>"=()]/);
  });

  it("caps the id at 40 characters", () => {
    const result = normalizeAgentClient(`${"a".repeat(39)}-bbbb`);
    expect(result?.id).toBe("a".repeat(39));
    expect(normalizeAgentClient("x".repeat(80))?.id).toHaveLength(40);
  });

  it("returns null for empty or garbage values", () => {
    expect(normalizeAgentClient(null)).toBeNull();
    expect(normalizeAgentClient(undefined)).toBeNull();
    expect(normalizeAgentClient("")).toBeNull();
    expect(normalizeAgentClient("   ")).toBeNull();
    expect(normalizeAgentClient("!!!___///")).toBeNull();
    expect(normalizeAgentClient("代理")).toBeNull();
    expect(normalizeAgentClient("a".repeat(300))).toBeNull();
  });
});

describe("sourceAttribution contract with an agent", () => {
  it("accepts and keeps the agent", () => {
    const parsed = sourceAttributionSchema.parse({
      displayName: "Kelly Agent",
      ownerName: "Kelly",
      channel: "cli",
      agent: { id: "codex", name: "Codex" },
    });
    expect(parsed.agent).toEqual({ id: "codex", name: "Codex" });
  });

  it("keeps agent optional so old attributions parse unchanged", () => {
    const old = { displayName: "Kelly Agent", ownerName: "Kelly", channel: "cli" as const };
    expect(sourceAttributionSchema.parse(old)).toEqual(old);
  });
});
