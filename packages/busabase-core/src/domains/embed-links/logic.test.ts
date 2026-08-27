import { describe, expect, it } from "vitest";
import { hashEmbedSecret, isEmbedLinkActive, verifyEmbedSecret } from "./logic";

describe("embed link capabilities", () => {
  it("stores and compares only a deterministic secret hash", () => {
    const secret = "A".repeat(43);
    const hash = hashEmbedSecret(secret);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(secret);
    expect(verifyEmbedSecret(secret, hash)).toBe(true);
    expect(verifyEmbedSecret("B".repeat(43), hash)).toBe(false);
  });

  it("fails closed after expiry or revocation", () => {
    const now = new Date("2026-07-21T00:00:00.000Z");
    expect(
      isEmbedLinkActive({ expiresAt: new Date("2026-07-21T00:15:00.000Z"), revokedAt: null }, now),
    ).toBe(true);
    expect(isEmbedLinkActive({ expiresAt: now, revokedAt: null }, now)).toBe(false);
    expect(
      isEmbedLinkActive({ expiresAt: new Date("2026-07-21T00:15:00.000Z"), revokedAt: now }, now),
    ).toBe(false);
  });
});
