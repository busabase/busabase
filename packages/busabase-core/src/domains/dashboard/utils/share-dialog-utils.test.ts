import type { EmbedLinkVO } from "busabase-contract/contract/embed-link-schemas";
import { describe, expect, it } from "vitest";
import {
  expiryIsoForPreset,
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
