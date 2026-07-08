import { describe, expect, it } from "vitest";
import { buildSkillMarkdown } from "../src/skill-doc";

/**
 * The skill doc is the agent-facing contract for the HTTP API. It previously told
 * agents to loop one change request per record, to merge a folder before
 * referencing it, and to upload files through the old attachments CLI. Those are
 * all now false. These assertions pin that the doc advertises the bulk / batch /
 * temp-ref / assets capabilities and never reintroduces stale guidance.
 */

const cloud = buildSkillMarkdown("https://busabase.com", { mode: "cloud", spaceId: "spc_x" });
const local = buildSkillMarkdown("http://localhost:15419", { mode: "local" });

describe("buildSkillMarkdown advertises the batch/bulk/temp-ref/assets surface", () => {
  it("documents the bulk record change-request endpoint", () => {
    for (const doc of [cloud, local]) {
      expect(doc).toContain("/records/bulk-change-request");
      expect(doc).toContain('"records"');
    }
  });

  it("documents batch review and merge", () => {
    expect(cloud).toContain("/change-requests/reviews");
    expect(cloud).toContain("/change-requests/merge");
    expect(cloud).toContain('"changeRequestIds"');
  });

  it("documents in-CR node temp references", () => {
    expect(cloud).toContain("parentNodeRef");
    expect(cloud).toContain('"ref"');
  });

  it("documents asset-backed attachment uploads", () => {
    for (const doc of [cloud, local]) {
      expect(doc).toContain("/api/v1/assets/upload-urls");
      expect(doc).toContain("/api/v1/assets/confirmations");
      expect(doc).toContain("busabase-cli assets upload");
      expect(doc).toContain("assetId");
      expect(doc).toContain("attachmentId");
    }
  });

  it("does not reintroduce the removed attachments upload command", () => {
    for (const doc of [cloud, local]) {
      expect(doc).not.toContain("busabase-cli attachments upload");
    }
  });

  it("no longer claims there is no bulk endpoint", () => {
    for (const doc of [cloud, local]) {
      expect(doc).not.toContain("there is no bulk endpoint");
    }
  });

  it("describes the multi-space guard as a rejection, not a silent fallback", () => {
    // Cloud space-targeting section must reflect the 400-on-ambiguity behavior.
    expect(cloud).toMatch(/rejected|400/);
    expect(cloud).not.toContain("silently falls back to the\nuser's default space");
  });
});
