import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentSessionCanonicalJson,
  agentSessionCommandDigest,
  agentSessionEventDigest,
  agentSessionJournalEnabled,
  agentSessionPendingCommandLimit,
} from "./agent-session-journal-policy";

afterEach(() => vi.unstubAllEnvs());

describe("supervised session activation and identities", () => {
  it("bounds pending admission configuration and keeps an explicit default", () => {
    vi.stubEnv("BUSABASE_AGENT_MAX_PENDING_COMMANDS", "");
    expect(agentSessionPendingCommandLimit()).toBe(128);
    vi.stubEnv("BUSABASE_AGENT_MAX_PENDING_COMMANDS", "2");
    expect(agentSessionPendingCommandLimit()).toBe(2);
    vi.stubEnv("BUSABASE_AGENT_MAX_PENDING_COMMANDS", "99999");
    expect(agentSessionPendingCommandLimit()).toBe(1_024);
    vi.stubEnv("BUSABASE_AGENT_MAX_PENDING_COMMANDS", "0");
    expect(agentSessionPendingCommandLimit()).toBe(2);
    vi.stubEnv("BUSABASE_AGENT_MAX_PENDING_COMMANDS", "not-a-limit");
    expect(agentSessionPendingCommandLimit()).toBe(128);
  });
  it("requires both activation and the explicit legacy-worker drain", () => {
    vi.stubEnv("BUSABASE_AGENT_SUPERVISOR_ENABLED", "true");
    vi.stubEnv("BUSABASE_AGENT_LEGACY_WRITERS_DRAINED", "false");
    expect(agentSessionJournalEnabled()).toBe(false);
    vi.stubEnv("BUSABASE_AGENT_LEGACY_WRITERS_DRAINED", "true");
    expect(agentSessionJournalEnabled()).toBe(true);
    vi.stubEnv("BUSABASE_AGENT_SUPERVISOR_ENABLED", "false");
    expect(agentSessionJournalEnabled()).toBe(false);
  });

  it("normalizes JSON key order but retains semantic message/command identity", () => {
    expect(agentSessionCommandDigest({ b: 2, a: "hi" })).toBe(
      agentSessionCommandDigest({ a: "hi", b: 2 }),
    );
    expect(agentSessionCommandDigest({ commandId: "cmd_A", text: "hi" })).not.toBe(
      agentSessionCommandDigest({ commandId: "cmd_B", text: "hi" }),
    );
  });

  it("ignores only delivery metadata and outer receipt time for source event identity", () => {
    const original = {
      kind: "acpUpdate",
      at: "first receipt",
      acpUpdate: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
        _meta: { "buda.im": { seq: 5 } },
      },
    };
    const replay = {
      ...original,
      at: "later receipt",
      acpUpdate: { ...original.acpUpdate, _meta: { "buda.im": { seq: 5, replay: true } } },
    };
    expect(agentSessionEventDigest(original)).toBe(agentSessionEventDigest(replay));
    expect(
      agentSessionEventDigest({
        ...original,
        acpUpdate: { ...original.acpUpdate, content: { type: "text", text: "different" } },
      }),
    ).not.toBe(agentSessionEventDigest(original));
    expect(
      agentSessionEventDigest({ kind: "permissionResolved", permissionOptionId: "allow" }),
    ).not.toBe(agentSessionEventDigest({ kind: "permissionResolved", permissionOptionId: "deny" }));
  });

  it("rejects non-JSON and cyclic payloads rather than invoking custom serialization", () => {
    const input: { self?: unknown } = {};
    input.self = input;
    expect(() => agentSessionCanonicalJson(input)).toThrow(/circular/);
    expect(() => agentSessionCanonicalJson({ n: Number.NaN })).toThrow(/non-JSON/);
    expect(() => agentSessionCanonicalJson({ f: () => "secret" })).toThrow(/JSON/);
    expect(() => agentSessionCanonicalJson({ value: new Date() })).toThrow(/plain JSON/);
  });

  it("retains own prototype-shaped JSON keys as semantic input without pollution", () => {
    const a = JSON.parse('{"__proto__":{"polluted":"A"},"constructor":"name","prototype":"value"}');
    const b = JSON.parse('{"__proto__":{"polluted":"B"},"constructor":"name","prototype":"value"}');
    expect(agentSessionCanonicalJson(a)).toContain('"__proto__":{"polluted":"A"}');
    expect(agentSessionCanonicalJson(a)).toContain('"constructor":"name"');
    expect(agentSessionCanonicalJson(a)).toContain('"prototype":"value"');
    expect(agentSessionCommandDigest(a)).not.toBe(agentSessionCommandDigest(b));
    expect(agentSessionCommandDigest(a)).not.toBe(
      agentSessionCommandDigest({ constructor: "name", prototype: "value" }),
    );
    expect(Object.getPrototypeOf({})).not.toHaveProperty("polluted");
  });
});
