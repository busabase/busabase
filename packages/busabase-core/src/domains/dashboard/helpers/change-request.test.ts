import type { OperationVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { coreMessagesEn } from "../../../i18n/messages";
import {
  getOperationImpact,
  getRestoredSlugChanges,
  getRestoreToastMessage,
  getViewMoveTargetPosition,
} from "./change-request";
import { shortIdentifier } from "./format";

const change = (name: string, fromSlug: string, toSlug: string) => ({
  nodeId: `nod_${toSlug}`,
  nodeType: "base",
  name,
  fromSlug,
  toSlug,
});

describe("getRestoredSlugChanges", () => {
  it("reads the entries the merge engine wrote", () => {
    const entry = change("base1", "base1", "base1-2");
    expect(getRestoredSlugChanges({ mergeSummary: { slugChanges: [entry] } })).toEqual([entry]);
  });

  it("returns nothing for change requests merged before slug changes were recorded", () => {
    expect(getRestoredSlugChanges({ mergeSummary: {} })).toEqual([]);
    expect(getRestoredSlugChanges({ mergeSummary: { slugChanges: "base1-2" } })).toEqual([]);
  });

  it("drops malformed entries instead of rendering half of one", () => {
    const entry = change("base1", "base1", "base1-2");
    expect(
      getRestoredSlugChanges({
        mergeSummary: { slugChanges: [null, { nodeId: "nod_x", toSlug: "x-2" }, entry] },
      }),
    ).toEqual([entry]);
  });
});

describe("getRestoreToastMessage", () => {
  const copy = coreMessagesEn.base;

  it("keeps the plain toast when nothing moved", () => {
    expect(getRestoreToastMessage({ mergeSummary: {} }, copy, "Base restored")).toBe(
      "Base restored",
    );
  });

  it("names the new slug when one item moved", () => {
    expect(
      getRestoreToastMessage(
        { mergeSummary: { slugChanges: [change("base1", "base1", "base1-2")] } },
        copy,
        "Base restored",
      ),
    ).toBe('base1 restored. Its slug "base1" was taken, so it is now "base1-2".');
  });

  it("counts the moved items when a folder brought several back", () => {
    expect(
      getRestoreToastMessage(
        {
          mergeSummary: {
            slugChanges: [change("rep", "rep", "rep-3"), change("spec", "spec", "spec-2")],
          },
        },
        copy,
        "folder restored",
      ),
    ).toContain("2 items had their slug taken");
  });
});

describe("view move impact", () => {
  const viewUpdate = (
    payload: Record<string, unknown>,
    baseFields: Record<string, unknown> | null = {
      name: "Board",
      description: "",
      config: { filters: [], sorts: [] },
      position: 2,
    },
  ) =>
    ({
      operation: "view_update",
      targetViewId: "viw_board_123456",
      mergedViewId: null,
      baseFields,
      headCommit: { payload },
    }) as unknown as OperationVO;

  it("reads a position-only update as a move, counting tabs from 1", () => {
    const operation = viewUpdate({ position: 0 });
    expect(getViewMoveTargetPosition(operation)).toBe(0);
    expect(getOperationImpact(operation, coreMessagesEn)).toBe(
      `Moves view ${shortIdentifier("viw_board_123456")} to position 1`,
    );
  });

  it("keeps calling an update that also edits the view an update", () => {
    const renamed = viewUpdate({
      name: "Kanban",
      description: "",
      config: { filters: [], sorts: [] },
      position: 0,
    });
    expect(getViewMoveTargetPosition(renamed)).toBeNull();
    expect(getOperationImpact(renamed, coreMessagesEn)).toBe(
      `Updates view ${shortIdentifier("viw_board_123456")}`,
    );
    expect(getViewMoveTargetPosition(viewUpdate({ name: "Board" }))).toBeNull();
  });

  it("treats an unchanged snapshot carried along with the move as a move", () => {
    expect(
      getViewMoveTargetPosition(
        viewUpdate({
          name: "Board",
          description: "",
          config: { sorts: [], filters: [] },
          position: 3,
        }),
      ),
    ).toBe(3);
  });
});
