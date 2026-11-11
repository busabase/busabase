// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { BaseFieldVO, BaseVO, RecordVO } from "busabase-contract/types";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type RecordCellUpdateResult,
  type UpdateRecordCell,
  useBaseGridEditing,
} from "./use-base-grid-editing";

afterEach(cleanup);

const field: BaseFieldVO = {
  id: "fld_notes",
  baseId: "bas_deliveries",
  slug: "notes",
  name: "Notes",
  type: "text",
  position: 1,
  required: false,
  options: {},
};
const base: BaseVO = {
  id: field.baseId,
  nodeId: "nod_deliveries",
  slug: "deliveries",
  name: "Deliveries",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-11-10T00:00:00Z",
  fields: [field],
};
const record: RecordVO = {
  id: "rec_delivery",
  baseId: base.id,
  headCommitId: "cmt_initial",
  parentRecordId: null,
  parentCommitId: null,
  status: "active",
  createdBy: "usr_proposer",
  archivedAt: null,
  createdAt: base.createdAt,
  updatedAt: base.createdAt,
  base,
  headCommit: {
    id: "cmt_initial",
    baseId: base.id,
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload: { notes: "Original delivery" },
    operation: "record_create",
    message: "",
    author: "usr_proposer",
    createdAt: base.createdAt,
  },
};
const pageOne = "base:view:page=1";
const pageTwo = "base:view:page=2";

function setup(onUpdateRecordCell: UpdateRecordCell, canMerge = false) {
  const gridRef = createRef<HTMLElement>();
  return renderHook(
    ({ scope, records }: { scope: string; records: RecordVO[] }) =>
      useBaseGridEditing({
        canMerge,
        enabled: true,
        ensureRowVisible: vi.fn(),
        fields: [field],
        formatSaveError: () => "Save failed",
        gridRef,
        onOpenRecord: vi.fn(),
        onUpdateRecordCell,
        proposalScope: scope,
        records,
        resolveFieldName: () => "Notes",
      }),
    { initialProps: { scope: pageOne, records: [record] } },
  );
}

function deferredSave() {
  let resolve!: (value: RecordCellUpdateResult) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<RecordCellUpdateResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("inline proposal lifetime within a collection query", () => {
  it("drops a proposal marker on paging and does not revive it when returning with the same head", async () => {
    const update = vi.fn<UpdateRecordCell>().mockResolvedValue({
      materialized: false,
      changeRequestId: "cr_closed_by_reviewer",
    });
    const { result, rerender } = setup(update);
    act(() => result.current.commit(record, field, "Proposed delivery", "none"));
    await waitFor(() =>
      expect(result.current.getCellStatus(record, field).pending?.changeRequestId).toBe(
        "cr_closed_by_reviewer",
      ),
    );
    expect(result.current.notice?.kind).toBe("pending");

    rerender({ scope: pageTwo, records: [] });
    // Closing/rejecting a CR does not advance this record's head.
    rerender({ scope: pageOne, records: [record] });
    expect(result.current.getCellStatus(record, field).pending).toBeNull();
    expect(result.current.notice).toBeNull();
    expect(result.current.getDisplayValue(record, field)).toBe("Original delivery");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("keeps a legitimate proposal across ordinary data refreshes of the same query", async () => {
    const { result, rerender } = setup(
      vi.fn<UpdateRecordCell>().mockResolvedValue({
        materialized: false,
        changeRequestId: "cr_pending",
      }),
    );
    act(() => result.current.commit(record, field, "Proposed delivery", "none"));
    await waitFor(() =>
      expect(result.current.getCellStatus(record, field).pending?.changeRequestId).toBe(
        "cr_pending",
      ),
    );
    rerender({ scope: pageOne, records: [{ ...record }] });
    expect(result.current.getCellStatus(record, field).pending?.changeRequestId).toBe("cr_pending");
    expect(result.current.notice?.kind).toBe("pending");
  });

  it("hides a proposal when an external merge advances the record head", async () => {
    const { result, rerender } = setup(
      vi.fn<UpdateRecordCell>().mockResolvedValue({
        materialized: false,
        changeRequestId: "cr_pending",
      }),
    );
    act(() => result.current.commit(record, field, "Proposed delivery", "none"));
    await waitFor(() => expect(result.current.getCellStatus(record, field).pending).not.toBeNull());
    const merged = { ...record, headCommitId: "cmt_external" };
    rerender({ scope: pageOne, records: [merged] });
    expect(result.current.getCellStatus(merged, field).pending).toBeNull();
  });

  it("drops proposal markers when the committed find query changes", async () => {
    const { result, rerender } = setup(
      vi.fn<UpdateRecordCell>().mockResolvedValue({
        materialized: false,
        changeRequestId: "cr_pending",
      }),
    );
    act(() => result.current.commit(record, field, "Proposed delivery", "none"));
    await waitFor(() => expect(result.current.getCellStatus(record, field).pending).not.toBeNull());
    rerender({ scope: `${pageOne}&find=Acme`, records: [record] });
    expect(result.current.getCellStatus(record, field).pending).toBeNull();
    expect(result.current.notice).toBeNull();
  });

  it.each([false, true])(
    "does not attach a late proposal response to a new query (round trip: %s)",
    async (roundTrip) => {
      const pending = deferredSave();
      const update = vi.fn<UpdateRecordCell>().mockReturnValue(pending.promise);
      const { result, rerender } = setup(update);
      act(() => result.current.commit(record, field, "Proposed delivery", "none"));
      expect(result.current.getCellStatus(record, field).saving).toBe(true);
      rerender({ scope: pageTwo, records: [] });
      if (roundTrip) rerender({ scope: pageOne, records: [record] });
      await act(async () => {
        pending.resolve({ materialized: false, changeRequestId: "cr_late" });
        await pending.promise;
      });
      expect(result.current.getCellStatus(record, field).saving).toBe(false);
      expect(result.current.getCellStatus(record, field).pending).toBeNull();
      expect(result.current.notice).toBeNull();
      expect(update).toHaveBeenCalledTimes(1);
    },
  );

  it("continues an in-flight merge and its saved overlay across paging", async () => {
    const pending = deferredSave();
    const { result, rerender } = setup(
      vi.fn<UpdateRecordCell>().mockReturnValue(pending.promise),
      true,
    );
    act(() => result.current.commit(record, field, "Merged delivery", "none"));
    rerender({ scope: pageTwo, records: [] });
    expect(result.current.getCellStatus(record, field).saving).toBe(true);
    await act(async () => {
      pending.resolve({ materialized: true, headCommitId: "cmt_merged" });
      await pending.promise;
    });
    rerender({ scope: pageOne, records: [record] });
    expect(result.current.getCellStatus(record, field).saving).toBe(false);
    expect(result.current.getDisplayValue(record, field)).toBe("Merged delivery");
    const refreshed = {
      ...record,
      headCommitId: "cmt_merged",
      headCommit: { ...record.headCommit, payload: { notes: "Merged delivery" } },
    };
    rerender({ scope: pageOne, records: [refreshed] });
    expect(result.current.getDisplayValue(refreshed, field)).toBe("Merged delivery");
    expect(result.current.getCellStatus(refreshed, field).pending).toBeNull();
  });

  it("preserves save failure feedback when the query changes", async () => {
    const pending = deferredSave();
    const { result, rerender } = setup(vi.fn<UpdateRecordCell>().mockReturnValue(pending.promise));
    act(() => result.current.commit(record, field, "Proposed delivery", "none"));
    await act(async () => {
      pending.reject(new Error("HTTP failure"));
      await pending.promise.catch(() => undefined);
    });
    expect(result.current.notice?.kind).toBe("error");
    rerender({ scope: pageTwo, records: [] });
    expect(result.current.notice).toEqual({
      kind: "error",
      fieldName: "Notes",
      message: "Save failed",
    });
  });
});
