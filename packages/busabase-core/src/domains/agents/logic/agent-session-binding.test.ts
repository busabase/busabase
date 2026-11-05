import { describe, expect, it, vi } from "vitest";
import { agentSessionBindingFingerprint } from "./agent-session-binding";

describe("stable ACP session endpoint/credential binding", () => {
  const launch = {
    slug: "buda:agent-one",
    url: "wss://buda.example/api/acp?agentId=agent-one&mode=1",
    bindingRef: "vault-row:revision-one",
    authHeader: "Bearer private-token-one",
  };

  it("remains stable across equivalent URL ordering and OAuth access-token rotation", () => {
    expect(agentSessionBindingFingerprint(launch)).toBe(
      agentSessionBindingFingerprint({
        ...launch,
        url: "wss://BUDA.example:443/api/acp?mode=1&agentId=agent-one#client-only",
        authHeader: "Bearer rotated-token",
      }),
    );
  });

  it.each([
    { bindingRef: "vault-row:revision-two" },
    { bindingRef: "another-vault:revision-one" },
    { url: "wss://another.example/api/acp?agentId=agent-one&mode=1" },
    { url: "wss://buda.example/api/acp?agentId=another-agent&mode=1" },
    { slug: "buda:another-agent" },
  ])("changes when the authorized binding changes %j", (change) => {
    expect(agentSessionBindingFingerprint({ ...launch, ...change })).not.toBe(
      agentSessionBindingFingerprint(launch),
    );
  });

  it("uses credential identity for local/env fallbacks without a durable ref", () => {
    const local = { ...launch, bindingRef: undefined };
    expect(agentSessionBindingFingerprint(local)).not.toBe(
      agentSessionBindingFingerprint({ ...local, authHeader: "Bearer rotated-token" }),
    );
  });

  it("returns only an opaque hash and never logs or exposes malformed endpoint credentials", () => {
    const info = vi.spyOn(console, "info");
    const warn = vi.spyOn(console, "warn");
    try {
      const fingerprint = agentSessionBindingFingerprint(launch);
      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(fingerprint).not.toContain("private-token");
      expect(fingerprint).not.toContain("vault-row");
      expect(() =>
        agentSessionBindingFingerprint({ ...launch, url: "private-token-is-not-a-url" }),
      ).toThrow("The ACP endpoint binding is invalid.");
      expect(info).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });
});
