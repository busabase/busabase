// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type {
  BusabaseDashboardApiClient,
  RecordUpdateChangeRequestResult,
} from "busabase-contract/api-client";
import type {
  BaseFieldVO,
  ChangeRequestStatus,
  ChangeRequestVO,
  OperationVO,
  RecordRevertPreviewVO,
  RecordVO,
} from "busabase-contract/types";
import type { ReactNode } from "react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CoreI18nProvider } from "../../../i18n";
import { DashboardVisitorProvider } from "../visitor-context";
import { RecordDetailView } from "./record-views";
import { SubmitPermissionProvider } from "./split-submit-button";

Object.assign(globalThis, { React });

// The History panel's "Revert to before this change" action: who sees it,
// on which entries, and the preview → confirm round trip through the client.

const RECORD_ID = "rec_deal";
const timestamp = "2026-11-01T09:00:00.000Z";

const field = (slug: string, name: string, position: number): BaseFieldVO => ({
  id: `fld_${slug}`,
  baseId: "bas_deals",
  slug,
  name,
  type: "text",
  required: false,
  options: {},
  position,
});

const makeRecord = (viewerPermissionLevel?: ApiKeyPermissionLevel): RecordVO =>
  ({
    id: RECORD_ID,
    baseId: "bas_deals",
    status: "active",
    createdBy: "usr_kelly",
    headCommitId: "cmt_head",
    parentRecordId: null,
    parentCommitId: null,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    base: {
      id: "bas_deals",
      nodeId: "nod_deals",
      slug: "deals",
      name: "Deals",
      description: "",
      reviewPolicy: { kind: "single", requiredApprovals: 1 },
      createdAt: timestamp,
      fields: [field("name", "Name", 0), field("stage", "Stage", 1)],
      ...(viewerPermissionLevel ? { viewerPermissionLevel } : {}),
    },
    headCommit: {
      id: "cmt_head",
      baseId: "bas_deals",
      targetType: "base",
      nodeId: null,
      operationId: null,
      parentCommitId: null,
      payload: { name: "Acme", stage: "Won" },
      operation: "record_update",
      message: "Mark Acme won",
      author: "usr_kelly",
      createdAt: timestamp,
    },
  }) as unknown as RecordVO;

const operation = (changeRequestId: string, overrides: Partial<OperationVO> = {}): OperationVO =>
  ({
    id: `opr_${changeRequestId}`,
    changeRequestId,
    baseId: "bas_deals",
    targetType: "base",
    nodeId: null,
    operation: "record_update",
    status: "merged",
    targetRecordId: RECORD_ID,
    targetViewId: null,
    filePath: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: "cmt_before",
    headCommitId: `cmt_${changeRequestId}`,
    deleteMode: "archive",
    mergedRecordId: RECORD_ID,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    headCommit: {
      id: `cmt_${changeRequestId}`,
      baseId: "bas_deals",
      targetType: "base",
      nodeId: null,
      operationId: `opr_${changeRequestId}`,
      parentCommitId: null,
      payload: { stage: "Won" },
      operation: "record_update",
      message: "Mark Acme won",
      author: "usr_kelly",
      createdAt: timestamp,
    },
    baseFields: { name: "Acme", stage: "Lead" },
    ...overrides,
  }) as OperationVO;

const changeRequest = (
  id: string,
  status: ChangeRequestStatus,
  operations: OperationVO[],
): ChangeRequestVO =>
  ({
    id,
    baseId: "bas_deals",
    targetType: "base",
    nodeId: null,
    status,
    submittedBy: "usr_kelly",
    submittedByUser: { id: "usr_kelly", name: "Kelly", email: null, image: null },
    sourceMeta: {},
    reviewPolicySnapshot: {},
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: status === "merged" ? timestamp : null,
    createdAt: timestamp,
    updatedAt: timestamp,
    base: null,
    node: null,
    operations,
    primaryOperation: operations[0] ?? null,
    operationCount: operations.length,
    reviews: [],
  }) as unknown as ChangeRequestVO;

const merged = changeRequest("crq_mark_won", "merged", [operation("crq_mark_won")]);
const pending = changeRequest("crq_pending", "in_review", [
  operation("crq_pending", {
    status: "pending",
    headCommit: { ...operation("crq_pending").headCommit, payload: { stage: "Lost" } },
  }),
]);
// Merged, but it only used this deal as the source of a different record.
const duplicated = changeRequest("crq_duplicate", "merged", [
  operation("crq_duplicate", {
    operation: "record_create",
    targetRecordId: null,
    mergedRecordId: "rec_copy",
    sourceRecordId: RECORD_ID,
    baseFields: null,
  }),
]);

const summary = (id: string, message: string) => ({
  id,
  status: "merged",
  submittedBy: "usr_kelly",
  submittedByUser: null,
  message,
  operations: ["record_update"],
  createdAt: timestamp,
  mergedAt: timestamp,
});

const preview: RecordRevertPreviewVO = {
  recordId: RECORD_ID,
  baseId: "bas_deals",
  toBeforeChangeRequestId: merged.id,
  action: "update",
  undoneChangeRequests: [
    summary("crq_later", "Add a later note"),
    summary(merged.id, "Mark Acme won"),
  ],
  currentFields: { name: "Acme", stage: "Won" },
  fields: { stage: "Lead" },
  fieldChanges: [{ slug: "stage", beforeValue: "Won", afterValue: "Lead" }],
  pendingChangeRequests: [],
  viewerCanRevert: true,
  willAutoMerge: true,
  planFingerprint: "fp_previewed",
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const renderDetail = (options: {
  viewerPermissionLevel?: ApiKeyPermissionLevel;
  /** The open Base's level (`bases.get`), passed down by the dashboard. */
  basePermissionLevel?: ApiKeyPermissionLevel;
  workspaceLevel?: ApiKeyPermissionLevel;
  history?: ChangeRequestVO[];
  record?: RecordVO;
  getRecords?: BusabaseDashboardApiClient["getRecords"];
  previewRecordRevert?: BusabaseDashboardApiClient["previewRecordRevert"];
  createRevertRecordChangeRequest?: BusabaseDashboardApiClient["createRevertRecordChangeRequest"];
}) => {
  const record = options.record ?? makeRecord(options.viewerPermissionLevel);
  const client = {
    getRecords: vi.fn(
      options.getRecords ?? (async (ids: string[]) => ({ records: [], missingIds: ids })),
    ),
    listRecordChangeRequests: vi.fn(async () => options.history ?? [pending, merged]),
    previewRecordRevert: vi.fn(options.previewRecordRevert ?? (async () => preview)),
    createRevertRecordChangeRequest: vi.fn(
      options.createRevertRecordChangeRequest ??
        (async () =>
          ({ ...record, materialized: true }) as unknown as RecordUpdateChangeRequestResult),
    ),
  };
  const onReverted = vi.fn(async () => undefined);
  const location = memoryLocation({ path: `/base/deals/${RECORD_ID}` });
  const wrap = (children: ReactNode) =>
    options.workspaceLevel ? (
      <SubmitPermissionProvider permissionLevel={options.workspaceLevel}>
        {children}
      </SubmitPermissionProvider>
    ) : (
      children
    );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Router hook={location.hook} searchHook={location.searchHook}>
        <CoreI18nProvider locale="en">
          <DashboardVisitorProvider visitorKind="member">
            {wrap(
              <RecordDetailView
                basePermissionLevel={options.basePermissionLevel}
                baseSlug="deals"
                client={client as unknown as BusabaseDashboardApiClient}
                onDeleteChangeRequest={async () => undefined}
                onReverted={onReverted}
                record={record}
                records={[record]}
              />,
            )}
          </DashboardVisitorProvider>
        </CoreI18nProvider>
      </Router>
    </QueryClientProvider>,
  );
  return { client, onReverted, record };
};

/** History rows in render order, once the history query resolved. */
const historyRows = async (count: number) => {
  await waitFor(() => expect(screen.getAllByTestId("record-history-row")).toHaveLength(count));
  return screen.getAllByTestId("record-history-row");
};

const revertButtonIn = (row: HTMLElement) => within(row).queryByTestId("record-history-revert");

const openRevertDialog = async () => {
  const [, mergedRow] = await historyRows(2);
  const button = revertButtonIn(mergedRow);
  if (!button) throw new Error("Expected a revert action on the merged entry");
  fireEvent.click(button);
  return screen.findByTestId("record-revert-dialog");
};

afterEach(() => cleanup());

describe("History revert action visibility", () => {
  it.each(["write", "changeRequest"] as const)(
    "offers 'Revert to before this change' on a merged entry for a %s grant",
    async (level) => {
      renderDetail({ viewerPermissionLevel: level });
      const [pendingRow, mergedRow] = await historyRows(2);
      const button = revertButtonIn(mergedRow);
      expect(button?.textContent).toContain("Revert to before this change");
      // Never on an entry that has not landed.
      expect(revertButtonIn(pendingRow)).toBeNull();
    },
  );

  it("follows the open Base's read grant over a write workspace baseline", async () => {
    // A workspace member with only read on this Base: the record's embedded
    // Base carries no level, so only the open Base's level can tell.
    renderDetail({ basePermissionLevel: "read", workspaceLevel: "write" });
    await historyRows(2);
    expect(screen.queryByTestId("record-history-revert")).toBeNull();
  });

  it("hides it from a read grant, even inside a manage workspace", async () => {
    renderDetail({ viewerPermissionLevel: "read", workspaceLevel: "manage" });
    await historyRows(2);
    expect(screen.queryByTestId("record-history-revert")).toBeNull();
  });

  it("falls back to the workspace level when the Base carries no viewer level", async () => {
    renderDetail({ workspaceLevel: "read" });
    await historyRows(2);
    expect(screen.queryByTestId("record-history-revert")).toBeNull();
  });

  it("is not offered on a merged entry that only used this record as a source", async () => {
    renderDetail({ viewerPermissionLevel: "write", history: [duplicated, merged] });
    const [duplicateRow, mergedRow] = await historyRows(2);
    expect(revertButtonIn(duplicateRow)).toBeNull();
    expect(revertButtonIn(mergedRow)).not.toBeNull();
  });

  it("does not navigate to the change request when the action is clicked", async () => {
    renderDetail({ viewerPermissionLevel: "write" });
    const [, mergedRow] = await historyRows(2);
    const button = revertButtonIn(mergedRow);
    // The action sits beside the row's link, never inside it.
    expect(button?.closest("a")).toBeNull();
  });
});

describe("Revert dialog", () => {
  it("resolves relation names on both sides in one authorized batch and keeps unavailable targets unnamed", async () => {
    const currentId = "rec_current_customer";
    const previousId = "rec_previous_customer";
    const hiddenId = "rec_hidden_customer";
    const record = makeRecord("write");
    record.base.fields.push({ ...field("customer", "Customer", 2), type: "relation" });
    const response = deferred<{ records: RecordVO[]; missingIds: string[] }>();
    const { client } = renderDetail({
      record,
      getRecords: () => response.promise,
      previewRecordRevert: async () => ({
        ...preview,
        currentFields: { ...preview.currentFields, customer: [currentId] },
        fields: { customer: [previousId, hiddenId] },
        fieldChanges: [
          { slug: "customer", beforeValue: [currentId], afterValue: [previousId, hiddenId] },
        ],
      }),
    });
    const [, row] = await historyRows(2);
    fireEvent.click(within(row).getByTestId("record-history-revert"));
    const dialog = await screen.findByTestId("record-revert-dialog");
    await waitFor(() => expect(client.getRecords).toHaveBeenCalledTimes(1));
    expect(new Set(client.getRecords.mock.calls[0][0])).toEqual(
      new Set([currentId, previousId, hiddenId]),
    );
    expect(within(dialog).queryByText("Current customer")).toBeNull();
    const linked = (id: string, name: string): RecordVO => ({
      ...makeRecord(),
      id,
      headCommit: { ...makeRecord().headCommit, payload: { name } },
    });
    await act(async () =>
      response.resolve({
        records: [linked(currentId, "Current customer"), linked(previousId, "Previous customer")],
        missingIds: [hiddenId],
      }),
    );
    expect(await within(dialog).findByRole("link", { name: "Current customer" })).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Previous customer" })).toBeTruthy();
    expect(within(dialog).queryByRole("link", { name: /rec_hidden/ })).toBeNull();
    fireEvent.click(within(dialog).getByTestId("record-revert-confirm"));
    await waitFor(() =>
      expect(client.createRevertRecordChangeRequest).toHaveBeenCalledWith(RECORD_ID, {
        toBeforeChangeRequestId: merged.id,
        expectedPlanFingerprint: preview.planFingerprint,
      }),
    );
  });

  it("keeps per-change actions without a latest edit shortcut", async () => {
    renderDetail({ viewerPermissionLevel: "write" });
    const [, mergedRow] = await historyRows(2);
    expect(screen.queryByRole("button", { name: "Revert latest edit" })).toBeNull();
    expect(revertButtonIn(mergedRow)).toBeTruthy();
  });

  it("restores the initial record when creation is selected", async () => {
    const creation = changeRequest("crq_create", "merged", [
      operation("crq_create", { operation: "record_create" }),
    ]);
    const { client } = renderDetail({
      viewerPermissionLevel: "write",
      history: [creation],
      previewRecordRevert: async () => ({
        ...preview,
        toBeforeChangeRequestId: creation.id,
        action: "update",
        undoneChangeRequests: [
          { ...summary(creation.id, "Create record"), operations: ["record_create"] },
        ],
        fields: {},
        fieldChanges: [],
      }),
    });
    const [row] = await historyRows(1);
    const button = revertButtonIn(row);
    expect(button?.textContent).toContain("Restore initial record");
    if (!button) throw new Error("Expected creation action");
    fireEvent.click(button);
    const dialog = await screen.findByTestId("record-revert-dialog");
    const confirm = await within(dialog).findByRole("button", { name: "Revert" });
    expect(dialog.textContent).toContain("Restore the record to its initial state");
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(client.createRevertRecordChangeRequest).toHaveBeenCalledWith(RECORD_ID, {
        toBeforeChangeRequestId: creation.id,
        expectedPlanFingerprint: "fp_previewed",
      }),
    );
  });

  it("previews the target, lists the undone changes and the field diff, then submits once", async () => {
    const submission = deferred<RecordUpdateChangeRequestResult>();
    const { client, onReverted, record } = renderDetail({
      viewerPermissionLevel: "write",
      createRevertRecordChangeRequest: () => submission.promise,
    });
    const dialog = await openRevertDialog();
    expect(client.previewRecordRevert).toHaveBeenCalledWith(RECORD_ID, merged.id);

    const undone = await within(dialog).findByTestId("record-revert-undone");
    const undoneItems = within(undone).getAllByRole("listitem");
    expect(undoneItems.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Add a later note"),
      expect.stringContaining("Mark Acme won"),
    ]);
    // Only the change the user picked carries the "Selected change" marker.
    expect(undoneItems[0]?.textContent).not.toContain("Selected change");
    expect(undoneItems[1]?.textContent).toContain("Selected change");

    const result = within(dialog).getByTestId("record-revert-result");
    expect(result.textContent).toContain("Stage");
    expect(result.textContent).toContain("Won");
    expect(result.textContent).toContain("Lead");
    expect(result.textContent).not.toContain("Name");

    const confirm = within(dialog).getByTestId("record-revert-confirm");
    expect(confirm.textContent).toContain("Revert");
    // Two quick clicks before React re-renders (one act), then a third after.
    act(() => {
      confirm.click();
      confirm.click();
    });
    fireEvent.click(confirm);
    // React Query starts the mutation function on a later microtask.
    await waitFor(() => expect(client.createRevertRecordChangeRequest).toHaveBeenCalled());
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(true));
    expect(client.createRevertRecordChangeRequest).toHaveBeenCalledTimes(1);
    // The confirm carries the previewed plan's fingerprint, so a record that
    // moved in between is refused server-side instead of reverting more.
    expect(client.createRevertRecordChangeRequest).toHaveBeenCalledWith(RECORD_ID, {
      toBeforeChangeRequestId: merged.id,
      expectedPlanFingerprint: "fp_previewed",
    });

    const landed = { ...record, materialized: true } as unknown as RecordUpdateChangeRequestResult;
    await act(async () => {
      submission.resolve(landed);
    });
    await waitFor(() => expect(screen.queryByTestId("record-revert-dialog")).toBeNull());
    expect(onReverted).toHaveBeenCalledWith(landed);
    expect(client.createRevertRecordChangeRequest).toHaveBeenCalledTimes(1);
  });

  it("labels the confirm 'Submit for review' when the revert will not land on its own", async () => {
    renderDetail({
      viewerPermissionLevel: "changeRequest",
      previewRecordRevert: async () => ({ ...preview, willAutoMerge: false }),
    });
    const dialog = await openRevertDialog();
    const confirm = await within(dialog).findByTestId("record-revert-confirm");
    expect(confirm.textContent).toContain("Submit for review");
  });

  it("when the record changed after the preview, says so and shows the plan as it is now", async () => {
    const refreshed = {
      ...preview,
      planFingerprint: "fp_now",
      undoneChangeRequests: [
        summary("crq_newest", "A teammate's newer edit"),
        ...preview.undoneChangeRequests,
      ],
    };
    const previews = [preview, refreshed];
    const { client } = renderDetail({
      viewerPermissionLevel: "write",
      previewRecordRevert: async () => previews.shift() ?? refreshed,
      createRevertRecordChangeRequest: async () => {
        throw Object.assign(new Error("changed"), {
          code: "CONFLICT",
          data: { reason: "plan_changed", planFingerprint: "fp_now" },
        });
      },
    });
    const dialog = await openRevertDialog();
    fireEvent.click(await within(dialog).findByTestId("record-revert-confirm"));
    await within(dialog).findByText(
      "The record changed after this preview was made, so nothing was submitted. The preview has been refreshed — check it and confirm again.",
    );
    // The refreshed plan (with the newer edit it would now also undo) is shown.
    await within(dialog).findByText("A teammate's newer edit");
    expect(client.previewRecordRevert).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("record-revert-dialog")).toBeTruthy();
  });

  it("names the deleted field and offers no confirm when the preview is refused", async () => {
    const refusal = Object.assign(new Error('Field "stage" was deleted'), {
      code: "CONFLICT",
      status: 409,
      data: { reason: "field_deleted", fieldSlug: "stage" },
    });
    const { client } = renderDetail({
      viewerPermissionLevel: "write",
      previewRecordRevert: async () => {
        throw refusal;
      },
    });
    const dialog = await openRevertDialog();
    const error = await within(dialog).findByTestId("record-revert-error");
    expect(error.textContent).toContain("This change can't be reverted");
    expect(error.textContent).toContain(
      "The field “Stage” was deleted after these changes, so its earlier value can't be restored. Nothing was changed.",
    );
    expect(within(dialog).queryByTestId("record-revert-confirm")).toBeNull();
    expect(within(dialog).queryByTestId("record-revert-undone")).toBeNull();
    expect(client.createRevertRecordChangeRequest).not.toHaveBeenCalled();
  });

  it("falls back to the slug for a field no longer on the Base", async () => {
    renderDetail({
      viewerPermissionLevel: "write",
      previewRecordRevert: async () => {
        throw Object.assign(new Error("conflict"), {
          data: { reason: "field_deleted", fieldSlug: "region" },
        });
      },
    });
    const dialog = await openRevertDialog();
    const error = await within(dialog).findByTestId("record-revert-error");
    expect(error.textContent).toContain("The field “region” was deleted after these changes");
  });
});
