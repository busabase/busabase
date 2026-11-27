"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BusabaseDashboardApiClient,
  RecordUpdateChangeRequestResult,
} from "busabase-contract/api-client";
import type {
  ChangeRequestVO,
  OperationVO,
  RecordRevertPreviewVO,
  RecordVO,
} from "busabase-contract/types";
import { Button } from "kui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "kui/dialog";
import { AlertTriangle, Clock, Info, Undo2 } from "lucide-react";
import { iStringParse } from "openlib/i18n/i-string";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { recordRevertMessages } from "../../../i18n/record-revert";
import { isRecordCreation } from "../../base/utils/record-revert-plan";
import { getChangeRequestTitle } from "../helpers/change-request";
import { getRelationRecordIds } from "../helpers/field";
import { formatFullTime, formatUserRefLabel } from "../helpers/format";
import { invalidateRecordHistory } from "../helpers/record-history-query";
import { useLinkedRecords } from "../hooks/use-linked-records";
import { useDashboardOrpc } from "../orpc-context";
import { DialogContent } from "./localized-dialog-content";
import { OperationFieldChanges } from "./operation-diff";
import { StatusBadge } from "./primitives";
import { ShimmerSkeleton as Skeleton } from "./shimmer-skeleton";

/** `sourceMeta.subject` the server stamps on a revert change request. */
export const isRevertChangeRequest = (changeRequest: Pick<ChangeRequestVO, "sourceMeta">) =>
  changeRequest.sourceMeta?.subject === "record_revert";

/**
 * Only a change that landed can be reverted, and only one that changed this
 * record (an operation that merely names it as a source created another one).
 */
export const canRevertChangeRequest = (changeRequest: ChangeRequestVO, recordId: string) =>
  changeRequest.status === "merged" &&
  changeRequest.operations.some(
    (operation) => operation.targetRecordId === recordId || operation.mergedRecordId === recordId,
  );

/**
 * The revert's own before → after, shaped as a proposed `record_update` so
 * the review UI's `OperationFieldChanges` renders it exactly like any other
 * change: current values as the base, reverted values on top.
 */
export const toRevertPreviewOperation = (
  preview: RecordRevertPreviewVO,
  record: RecordVO,
): OperationVO => ({
  id: `revert-preview:${preview.toBeforeChangeRequestId}`,
  changeRequestId: preview.toBeforeChangeRequestId,
  baseId: record.baseId,
  targetType: "base",
  nodeId: null,
  operation: "record_update",
  status: "pending",
  targetRecordId: record.id,
  targetViewId: null,
  filePath: null,
  sourceRecordId: null,
  sourceCommitId: null,
  baseCommitId: record.headCommitId,
  headCommitId: record.headCommitId,
  deleteMode: "archive",
  mergedRecordId: null,
  mergedViewId: null,
  position: 0,
  createdAt: record.updatedAt,
  updatedAt: record.updatedAt,
  headCommit: { ...record.headCommit, payload: { ...preview.currentFields, ...preview.fields } },
  baseFields: preview.currentFields,
});

interface RevertErrorData {
  reason?: string;
  fieldSlug?: string;
  /** Sent for a field the Base no longer has, so its name cannot be looked up here. */
  fieldName?: string;
}

const errorData = (error: unknown): RevertErrorData => {
  const data = (error as { data?: unknown } | null)?.data;
  return data && typeof data === "object" ? (data as RevertErrorData) : {};
};

function useRevertErrorMessage(record: RecordVO) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const copy = recordRevertMessages[locale];
  return (error: unknown) => {
    const { reason, fieldSlug, fieldName: sentName } = errorData(error);
    const field = record.base.fields.find((candidate) => candidate.slug === fieldSlug);
    const fieldName = field ? iStringParse(field.name) : (sentName ?? fieldSlug ?? "");
    switch (reason) {
      case "field_deleted":
        return fmt(copy.reasonFieldDeleted, { field: fieldName });
      case "field_type_changed":
        return fmt(copy.reasonFieldTypeChanged, { field: fieldName });
      case "record_in_trash":
        return copy.reasonRecordInTrash;
      case "restore_then_edit":
        return copy.reasonRestoreThenEdit;
      case "nothing_to_revert":
        return copy.reasonNothing;
      case "target_not_merged":
        return copy.reasonNotMerged;
      case "plan_changed":
        return copy.reasonPlanChanged;
      default:
        return presentCoreError(messages, locale, error, copy.failed);
    }
  };
}

function ChangeRequestSummaryRow({
  summary,
  selected,
}: {
  summary: RecordRevertPreviewVO["undoneChangeRequests"][number];
  selected: boolean;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const copy = recordRevertMessages[locale];
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate font-medium text-sm">{summary.message || summary.id}</div>
        <div className="mt-0.5 text-muted-foreground text-xs">
          {formatUserRefLabel(summary.submittedByUser, summary.submittedBy, messages)}
          {" · "}
          {formatFullTime(summary.mergedAt ?? summary.createdAt, locale)}
        </div>
      </div>
      {selected ? (
        <span className="shrink-0 rounded-md border border-review/35 bg-review/17 px-2 py-0.5 font-medium text-[11px] text-review-strong dark:text-review-soft">
          {copy.selectedChange}
        </span>
      ) : null}
    </li>
  );
}

function RevertPreviewBody({
  client,
  preview,
  record,
  target,
}: {
  client: BusabaseDashboardApiClient;
  preview: RecordRevertPreviewVO;
  record: RecordVO;
  target: ChangeRequestVO;
}) {
  const locale = useCoreLocale();
  const copy = recordRevertMessages[locale];
  const relationSlugs = new Set(
    record.base.fields.filter((field) => field.type === "relation").map((field) => field.slug),
  );
  const relationIds = preview.fieldChanges.flatMap((change) =>
    relationSlugs.has(change.slug)
      ? [...getRelationRecordIds(change.beforeValue), ...getRelationRecordIds(change.afterValue)]
      : [],
  );
  const { records: relationRecords } = useLinkedRecords({ client, ids: relationIds });
  const resultNotice =
    preview.action === "restore"
      ? copy.restoreResult
      : preview.action === "delete"
        ? copy.deleteAfterRestoreResult
        : null;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section>
        <h3 className="font-medium text-sm">
          {fmt(copy.undoneTitle, { count: preview.undoneChangeRequests.length })}
        </h3>
        <p className="mt-1 text-muted-foreground text-xs">
          {isRecordCreation(target, record.id) ? copy.creationHint : copy.undoneHint}
        </p>
        <ol
          className="mt-2 divide-y divide-border/50 rounded-md border border-border/70"
          data-testid="record-revert-undone"
        >
          {preview.undoneChangeRequests.map((summary) => (
            <ChangeRequestSummaryRow
              key={summary.id}
              selected={summary.id === preview.toBeforeChangeRequestId}
              summary={summary}
            />
          ))}
        </ol>
      </section>
      <section data-testid="record-revert-result">
        <h3 className="font-medium text-sm">{copy.resultTitle}</h3>
        {resultNotice ? (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2.5 text-sm">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{resultNotice}</span>
          </div>
        ) : (
          <>
            <p className="mt-2 text-muted-foreground text-xs">{copy.valuesHint}</p>
            <OperationFieldChanges
              changeRequest={{ ...target, base: record.base }}
              fieldUsers={record.fieldUsers}
              records={relationRecords}
              operation={toRevertPreviewOperation(preview, record)}
            />
          </>
        )}
      </section>
      {preview.pendingChangeRequests.length > 0 ? (
        <section
          className="rounded-md border border-review/35 bg-review/10 px-3 py-2.5"
          data-testid="record-revert-pending"
        >
          <div className="flex items-center gap-2 font-medium text-sm">
            <AlertTriangle aria-hidden className="size-4 shrink-0 text-review-strong" />
            {fmt(copy.pendingTitle, { count: preview.pendingChangeRequests.length })}
          </div>
          <p className="mt-1 text-muted-foreground text-xs">{copy.pendingHint}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {preview.pendingChangeRequests.map((summary) => (
              <li className="flex items-center justify-between gap-2 text-xs" key={summary.id}>
                <span className="truncate">{summary.message || summary.id}</span>
                <StatusBadge status={summary.status} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="flex items-center gap-2 text-muted-foreground text-xs">
        <Clock aria-hidden className="size-3.5 shrink-0" />
        {preview.viewerCanRevert
          ? preview.willAutoMerge
            ? copy.landsNow
            : copy.needsReview
          : copy.noPermission}
      </p>
    </div>
  );
}

/**
 * Preview + confirm for rolling a record back to before one of its change
 * requests. The preview comes from the server (`records.revertPreview`), so
 * what the dialog shows is what `operation: "revert"` will submit.
 */
export function RecordRevertDialog({
  client,
  onOpenChange,
  onReverted,
  record,
  target,
}: {
  client: BusabaseDashboardApiClient;
  onOpenChange: (open: boolean) => void;
  /** After a revert was submitted (landed or queued for review). */
  onReverted?: (result: RecordUpdateChangeRequestResult) => Promise<void> | void;
  record: RecordVO;
  /** The change request to revert to before; null = closed. */
  target: ChangeRequestVO | null;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const copy = recordRevertMessages[locale];
  const queryClient = useQueryClient();
  const orpc = useDashboardOrpc();
  const presentError = useRevertErrorMessage(record);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const open = target !== null;
  const targetIsCreation = target ? isRecordCreation(target, record.id) : false;

  const previewQuery = useQuery({
    enabled: open,
    // Always computed fresh: the record may have moved since the dialog last opened.
    gcTime: 0,
    queryFn: () => client.previewRecordRevert(record.id, target?.id ?? ""),
    queryKey: ["busabase", "record-revert-preview", record.id, target?.id, record.headCommitId],
    retry: false,
  });
  const preview = previewQuery.data;

  // The button disables on the next render; this closes the gap a fast double
  // click lands in, so one confirm is one revert change request.
  const submitting = useRef(false);
  const revertMutation = useMutation({
    mutationFn: () =>
      client.createRevertRecordChangeRequest(record.id, {
        toBeforeChangeRequestId: target?.id ?? "",
        // Submit exactly what this dialog shows: the server refuses (409
        // `plan_changed`) if the record moved since the preview was built.
        ...(preview ? { expectedPlanFingerprint: preview.planFingerprint } : {}),
      }),
    onSettled: () => {
      submitting.current = false;
    },
    onError: (error) => {
      setSubmitError(presentError(error));
      // Show the plan as it is now, so the next confirm is an informed one.
      if (errorData(error).reason === "plan_changed") void previewQuery.refetch();
    },
    onSuccess: async (result) => {
      toast.success(result.materialized ? copy.done : copy.submitted);
      await Promise.all([
        invalidateRecordHistory(queryClient, orpc, [record.id]),
        onReverted?.(result),
      ]);
      onOpenChange(false);
    },
  });

  const close = (next: boolean) => {
    if (revertMutation.isPending) return;
    if (!next) {
      setSubmitError(null);
      revertMutation.reset();
    }
    onOpenChange(next);
  };

  const canConfirm = Boolean(preview?.viewerCanRevert) && !revertMutation.isPending;

  return (
    <Dialog onOpenChange={close} open={open}>
      <DialogContent
        className="flex max-h-[85vh] max-w-2xl flex-col"
        data-testid="record-revert-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 aria-hidden className="size-4" />
            {targetIsCreation ? copy.undoCreation : copy.title}
          </DialogTitle>
          <DialogDescription>
            {targetIsCreation
              ? copy.creationDescription
              : fmt(copy.description, {
                  // The change's own message ("Mark Acme lost — …") names it far
                  // better than the generic "Update record …" title, once known.
                  change:
                    preview?.undoneChangeRequests.at(-1)?.message ||
                    (target ? getChangeRequestTitle(target, messages) : ""),
                })}
          </DialogDescription>
        </DialogHeader>
        {/* Only the preview scrolls: the confirm stays in view however long it is. */}
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {previewQuery.isLoading ? (
            <div aria-busy className="space-y-3 py-2">
              <span className="sr-only">{copy.loading}</span>
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : previewQuery.error ? (
            <div
              className="rounded-md border border-rejected/35 bg-rejected/17 px-3 py-2.5 text-sm"
              data-testid="record-revert-error"
              role="alert"
            >
              <div className="font-medium text-rejected-strong dark:text-rejected-soft">
                {copy.failedTitle}
              </div>
              <div className="mt-1">{presentError(previewQuery.error)}</div>
            </div>
          ) : preview && target ? (
            <RevertPreviewBody client={client} preview={preview} record={record} target={target} />
          ) : null}
        </div>
        {/* Outside the scroll area, beside the buttons: after a refused confirm
            the preview below may have changed, and this says why. */}
        {submitError ? (
          <div
            className="rounded-md border border-rejected/35 bg-rejected/17 px-3 py-2 text-rejected-strong text-sm dark:text-rejected-soft"
            data-testid="record-revert-submit-error"
            role="alert"
          >
            {submitError}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            disabled={revertMutation.isPending}
            onClick={() => close(false)}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          {preview ? (
            <Button
              data-testid="record-revert-confirm"
              disabled={!canConfirm}
              onClick={() => {
                if (submitting.current) return;
                submitting.current = true;
                setSubmitError(null);
                revertMutation.mutate();
              }}
              type="button"
            >
              <Undo2 aria-hidden className="size-4" />
              {revertMutation.isPending
                ? copy.submitting
                : preview.action === "delete" && preview.willAutoMerge
                  ? copy.moveToTrash
                  : preview.willAutoMerge
                    ? copy.confirm
                    : copy.confirmReview}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
