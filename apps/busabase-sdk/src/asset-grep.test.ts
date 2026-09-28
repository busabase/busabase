import type { UnifiedGrepResultVO } from "busabase-contract/contract/grep-schemas";
import { describe, expect, it } from "vitest";
import { grepAssets, toFilesOnlyGrepResult, toUnifiedFilesGrepInput } from "./asset-grep";

const owner = {
  nodeId: "nod_skill",
  nodeType: "skill",
  nodeName: "Weekly Report",
  path: ["Sales"],
};

const unified: UnifiedGrepResultVO = {
  matches: [
    {
      source: "files",
      assetId: "ast_1",
      fileName: "SKILL.md",
      drivePath: "SKILL.md",
      owner,
      line: 3,
      column: 1,
      text: "needle",
      before: [],
      after: [],
    },
    {
      source: "prompts",
      nodeId: "nod_base",
      nodeName: "Visits",
      nodeType: "base",
      nodeSlug: "visits",
      key: "log-visit",
      locale: "en",
      field: "body",
      line: 1,
      column: 1,
      text: "needle",
      before: [],
      after: [],
    },
  ],
  coverage: {
    files: { scanned: 1, missing: [], stale: [], unsearchable: 0, errored: [], notReached: 0 },
    nodes: { scanned: 0, errored: [], notReached: 0 },
    records: { scanned: 0, errored: [], notReached: 0 },
    prompts: { scanned: 1, errored: [], notReached: 0 },
  },
  truncated: false,
};

describe("files-only grep adapter", () => {
  it("keeps each file match's owner and drops non-file sources", () => {
    const result = toFilesOnlyGrepResult(unified);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.owner).toEqual(owner);
    expect(result.filesScanned).toBe(1);
  });

  it("reads an older server's response that has no owner and no prompts coverage", async () => {
    const legacy = {
      ...unified,
      matches: [{ ...unified.matches[0], owner: undefined }],
      coverage: { ...unified.coverage, prompts: undefined },
    } as UnifiedGrepResultVO;
    const result = await grepAssets({ grep: async () => legacy }, { pattern: "needle" });
    expect(result.matches[0]?.owner).toBeUndefined();
    expect(result.matches[0]?.fileName).toBe("SKILL.md");
  });

  it("asks unified grep for the files source only", () => {
    expect(toUnifiedFilesGrepInput({ pattern: "x" }).sources).toEqual(["files"]);
  });
});
