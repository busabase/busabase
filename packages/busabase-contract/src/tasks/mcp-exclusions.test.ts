import { describe, expect, it } from "vitest";
import { busabaseContract } from "../contract/busabase";
import { AGENT_EXCLUDED_MCP_TOOLS } from "./index";

describe("backup transport MCP boundary", () => {
  it("keeps snapshot/projection available in REST while withholding them from agent tools", () => {
    expect(busabaseContract.dump.exportSnapshot["~orpc"].route).toMatchObject({
      method: "POST",
      path: "/api/v1/dump/export/snapshot",
    });
    expect(busabaseContract.dump.exportAssetAttachment["~orpc"].route).toMatchObject({
      method: "POST",
      path: "/api/v1/dump/export/asset-attachment",
    });
    expect(AGENT_EXCLUDED_MCP_TOOLS).toEqual(
      expect.arrayContaining(["dump_export_snapshot", "dump_export_asset_attachment"]),
    );
    expect(new Set(AGENT_EXCLUDED_MCP_TOOLS).size).toBe(AGENT_EXCLUDED_MCP_TOOLS.length);
  });

  it("preserves the existing physical attachment-download exception and session exclusions", () => {
    expect(AGENT_EXCLUDED_MCP_TOOLS).not.toContain("dump_export_attachment");
    expect(AGENT_EXCLUDED_MCP_TOOLS).toEqual(
      expect.arrayContaining([
        "dump_export_tables",
        "dump_export_asset_text",
        "dump_export_doc_bodies",
        "dump_import_begin",
        "dump_import_tables",
        "dump_import_commit",
        "dump_import_abort",
      ]),
    );
  });
});
