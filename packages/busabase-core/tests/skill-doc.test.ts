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
const cloudBootstrap = buildSkillMarkdown("https://busabase.com", {
  mode: "cloud",
  stage: "bootstrap",
  spaceId: "spc_x",
});

describe("buildSkillMarkdown advertises the batch/bulk/temp-ref/assets surface", () => {
  it("documents standard OAuth access tokens without the removed session format", () => {
    const authenticated = buildSkillMarkdown("https://busabase.com", {
      apiKey: "bso_example",
      mode: "cloud",
      spaceId: "spc_x",
    });
    expect(authenticated).toContain("rotating OAuth\naccess token");
    expect(authenticated).toContain("`bso_…`");
    expect(authenticated).not.toContain("`bss_…`");
  });

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

describe("generated Cloud onboarding", () => {
  it("uses device authorization without exposing or requesting secrets", () => {
    expect(cloudBootstrap).toContain("login --device-code");
    expect(cloudBootstrap).toContain("selects an\nexisting API key or creates a new one");
    expect(cloudBootstrap).toContain("The browser never receives the\nkey secret");
    expect(cloudBootstrap).not.toContain("cat ~/.busabase/.env");
    expect(cloudBootstrap).not.toContain("<paste the new key>");
    expect(cloudBootstrap).not.toContain('export BUSABASE_API_KEY="sk_');
  });

  it("branches on the persistent bootstrap marker instead of Space emptiness", () => {
    expect(cloudBootstrap).toContain("bootstrapRequired: true");
    expect(cloudBootstrap).toContain("bootstrapRequired: false");
    expect(cloudBootstrap).toContain("agentBootstrapVersion");
    expect(cloudBootstrap).not.toContain("`bases` is `[]`");
  });

  it("uses a dashboard-selected Space as a locked target, not as proof it is existing", () => {
    expect(cloudBootstrap).toContain("Dashboard Space supplied (`spc_x`)");
    expect(cloudBootstrap).toContain(
      "Preselection does not decide whether initialization is required",
    );
    expect(cloudBootstrap).toContain("including a preselected empty Space with no");
    expect(cloudBootstrap).toContain(
      "initialize this\n  Space even when the dashboard preselected it",
    );
    expect(cloudBootstrap).not.toContain("and no dashboard Space was\npreselected");
  });

  it("auto-merges idempotent system starter data and marks completion", () => {
    expect(cloudBootstrap).toContain('"submittedBy": "system-onboarding"');
    expect(cloudBootstrap).toContain(
      '"idempotencyKey": "system-onboarding:v1:content:launch-announcement"',
    );
    expect(cloudBootstrap).toContain('"autoMerge": true');
    expect(cloudBootstrap).toContain("/api/v1/onboarding/bootstrap-complete");
    expect(cloudBootstrap).not.toContain("First approval");
  });
});
