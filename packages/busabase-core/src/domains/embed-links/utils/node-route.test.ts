import { describe, expect, it } from "vitest";
import type { EmbedTargetNodeVO } from "../types";
import { embedNodeInitialPath, isEmbedNodeRoute } from "./node-route";

const doc: EmbedTargetNodeVO = { id: "nod_doc", type: "doc", slug: "launch-notes", name: "Notes" };
const base: EmbedTargetNodeVO = { id: "nod_base", type: "base", slug: "deals", name: "Deals" };

describe("embed node routes", () => {
  it("opens on the node's own workbench route", () => {
    expect(embedNodeInitialPath(doc)).toBe("/doc/launch-notes");
    expect(embedNodeInitialPath(base)).toBe("/base/deals");
  });

  it("keeps the shared node reachable by slug or id, with any query", () => {
    expect(isEmbedNodeRoute("/doc/launch-notes", doc)).toBe(true);
    expect(isEmbedNodeRoute("/doc/nod_doc?preview=1", doc)).toBe(true);
  });

  it("refuses other nodes, other types and node sub-pages", () => {
    expect(isEmbedNodeRoute("/doc/other", doc)).toBe(false);
    expect(isEmbedNodeRoute("/file/launch-notes", doc)).toBe(false);
    expect(isEmbedNodeRoute("/doc/launch-notes/activity", doc)).toBe(false);
    expect(isEmbedNodeRoute("/inbox", doc)).toBe(false);
    expect(isEmbedNodeRoute("/", doc)).toBe(false);
  });

  it("lets a Base switch views and open records, but not edit, design or audit", () => {
    expect(isEmbedNodeRoute("/base/deals/viw_board", base)).toBe(true);
    expect(isEmbedNodeRoute("/base/nod_base/rec_1", base)).toBe(true);
    for (const page of ["design", "setup", "new", "activity"]) {
      expect(isEmbedNodeRoute(`/base/deals/${page}`, base)).toBe(false);
    }
    expect(isEmbedNodeRoute("/base/deals/rec_1/edit", base)).toBe(false);
    expect(isEmbedNodeRoute("/base/deals/rec_1/activity", base)).toBe(false);
    expect(isEmbedNodeRoute("/base/other/rec_1", base)).toBe(false);
  });
});
