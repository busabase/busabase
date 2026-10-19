import { describe, expect, it } from "vitest";
import { isRecordEmbedProcedureAllowed } from "./record-scope";

const scope = {
  recordId: "rec_shared",
  baseId: "base_shared",
  baseNodeId: "nod_shared",
  baseSlug: "shared-base",
};

describe("record-detail capability request scope", () => {
  it("allows only the shared record and the preview's owning Base metadata", () => {
    expect(
      isRecordEmbedProcedureAllowed(["records", "get"], { recordId: scope.recordId }, scope),
    ).toBe(true);
    expect(
      isRecordEmbedProcedureAllowed(
        ["core", "records", "get"],
        { recordId: scope.recordId },
        scope,
      ),
    ).toBe(true);
    expect(
      isRecordEmbedProcedureAllowed(["bases", "listViews"], { baseId: scope.baseId }, scope),
    ).toBe(true);
    for (const nodeId of [scope.baseId, scope.baseNodeId, scope.baseSlug]) {
      expect(
        isRecordEmbedProcedureAllowed(
          ["nodes", "resolveRouteState"],
          { nodeId, type: "base" },
          scope,
        ),
      ).toBe(true);
    }
  });

  it.each([
    ["records.get", { recordId: "rec_other" }],
    ["records.get", { recordId: [scope.recordId, "rec_other"] }],
    ["records.list", { baseId: scope.baseId }],
    ["records.listPage", { baseId: scope.baseId }],
    ["records.count", { baseId: scope.baseId }],
    ["records.search", { query: "" }],
    ["records.listLinks", { recordId: scope.recordId }],
    ["bases.list", {}],
    ["bases.get", { baseId: scope.baseId }],
    ["bases.listViews", { baseId: "base_other" }],
    ["nodes.list", {}],
    ["nodes.resolveRouteState", { nodeId: "nod_other" }],
    ["nodes.resolveRouteState", { nodeId: scope.baseSlug, type: "doc" }],
    ["assets.list", {}],
    ["records.changeRequest", { recordId: scope.recordId }],
    ["embedLinks.create", { type: "record-detail", typeId: scope.recordId }],
  ])("refuses requests outside the record preview: %s", (path, input) => {
    expect(isRecordEmbedProcedureAllowed(path.split("."), input, scope)).toBe(false);
  });

  it.each([null, undefined, "rec_shared", [], { recordId: 42 }])(
    "rejects malformed input %j",
    (input) => {
      expect(isRecordEmbedProcedureAllowed(["records", "get"], input, scope)).toBe(false);
    },
  );
});
