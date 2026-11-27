import type { EmbedLinkVO } from "busabase-contract/contract/embed-link-schemas";
import { describe, expect, it } from "vitest";
import {
  expiryIsoForPreset,
  generateSharePassword,
  isSharePasswordLengthValid,
  nearestSharedAncestor,
  partitionEmbedLinks,
  publicPreviewUrl,
  toDatetimeLocalValue,
} from "./share-dialog-utils";

const link = (id: string, active: boolean, revokedAt: string | null = null): EmbedLinkVO => ({
  id,
  type: "node",
  typeId: "nod_handbook",
  targetName: "Handbook",
  nodeType: "doc",
  createdAt: "2026-09-22T00:00:00.000Z",
  expiresAt: "2026-10-22T00:00:00.000Z",
  revokedAt,
  active,
  framePolicy: { mode: "origins", allowedOrigins: ["https://example.com"] },
});

describe("share dialog utilities", () => {
  it("calculates relative expiry presets from the supplied clock", () => {
    const now = new Date("2026-09-22T10:00:00.000Z");
    expect(expiryIsoForPreset("never", "", now)).toBeNull();
    expect(expiryIsoForPreset("1-day", "", now)).toBe("2026-09-23T10:00:00.000Z");
    expect(expiryIsoForPreset("7-days", "", now)).toBe("2026-09-29T10:00:00.000Z");
    expect(expiryIsoForPreset("30-days", "", now)).toBe("2026-10-22T10:00:00.000Z");
  });

  it("accepts an explicit custom datetime and rejects an empty one", () => {
    expect(expiryIsoForPreset("custom", "2026-09-30T12:30")).toBe(
      new Date("2026-09-30T12:30").toISOString(),
    );
    expect(expiryIsoForPreset("custom", "")).toBeNull();
    expect(toDatetimeLocalValue("not-a-date")).toBe("");
  });

  it("keeps only server-active links in the active group", () => {
    const active = link("active", true);
    const expired = link("expired", false);
    const revoked = link("revoked", false, "2026-09-22T01:00:00.000Z");
    const groups = partitionEmbedLinks([active, expired, revoked]);
    expect(groups.active.map(({ id }) => id)).toEqual(["active"]);
    expect(groups.history.map(({ id }) => id)).toEqual(["expired", "revoked"]);
  });

  it("adds visitor preview mode without discarding an existing query", () => {
    expect(publicPreviewUrl("https://busabase.com/dashboard/org/base/blog?source=share")).toBe(
      "https://busabase.com/dashboard/org/base/blog?source=share&share-preview=1",
    );
  });
});

describe("nearestSharedAncestor", () => {
  const row = (nodeId: string) => ({ nodeId, name: nodeId });

  it("picks the nearest shared ancestor when several are shared", () => {
    // root-first: root > projects > q3
    const hit = nearestSharedAncestor(["root", "projects", "q3"], [row("root"), row("projects")]);
    expect(hit?.nodeId).toBe("projects");
  });

  it("returns null when no ancestor carries its own share", () => {
    expect(nearestSharedAncestor(["root", "projects"], [row("elsewhere")])).toBeNull();
    expect(nearestSharedAncestor([], [row("root")])).toBeNull();
  });
});

describe("generateSharePassword", () => {
  /** A fake CSPRNG that hands out the given uint32 draws in order. */
  const draws = (...values: number[]) => {
    const queue = [...values];
    return (array: Uint32Array) => {
      array[0] = queue.shift() ?? 0;
      return array;
    };
  };

  it("produces six digits from the platform CSPRNG", () => {
    for (let index = 0; index < 50; index += 1) {
      const password = generateSharePassword();
      expect(password).toMatch(/^\d{6}$/);
      expect(isSharePasswordLengthValid(password)).toBe(true);
    }
  });

  it("keeps leading zeros", () => {
    expect(generateSharePassword(draws(42))).toBe("000042");
  });

  it("redraws instead of folding the biased top of the uint32 range in with modulo", () => {
    // 4_294_000_000 is the first value of the incomplete last block of a
    // million; `% 1e6` would turn it into 000000 and over-weight low codes.
    expect(generateSharePassword(draws(4_294_000_000, 4_294_967_295, 123_456))).toBe("123456");
    expect(generateSharePassword(draws(4_293_999_999))).toBe("999999");
  });
});

describe("isSharePasswordLengthValid", () => {
  it("accepts 4 to 64 characters, the bounds nodes.share.set enforces", () => {
    expect(isSharePasswordLengthValid("")).toBe(false);
    expect(isSharePasswordLengthValid("123")).toBe(false);
    expect(isSharePasswordLengthValid("1234")).toBe(true);
    expect(isSharePasswordLengthValid("x".repeat(64))).toBe(true);
    expect(isSharePasswordLengthValid("x".repeat(65))).toBe(false);
  });
});
