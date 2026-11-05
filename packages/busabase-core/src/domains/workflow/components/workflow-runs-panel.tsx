"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  type DecideWorkflowRunInput,
  WORKFLOW_RUN_RETENTION_DAYS,
  type WorkflowRun,
  type WorkflowRunStatus,
} from "busabase-contract/domains/workflow/run";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "kui/alert-dialog";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Textarea } from "kui/textarea";
import { Ban, Check, FastForward, Play, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { type CoreI18nMessages, fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { formatListDateTime } from "../../dashboard/helpers/format";
import {
  formatWorkflowRunJson,
  isWorkflowRunCancellable,
  mergeWorkflowRunPages,
  orderedWorkflowRunSteps,
  parseWorkflowRunLink,
  parseWorkflowRunPayload,
  upsertWorkflowRun,
  type WorkflowRunStepState,
  workflowRunStatusLabelKey,
  workflowRunStepLabel,
  workflowRunStepStates,
  workflowRunsPollInterval,
} from "../utils/run-view";

const RUN_LIST_LIMIT = 20;

/** Locales with a published `/docs/workflows` guide; every other UI language links the English one. */
const WORKFLOW_DOC_LOCALES: readonly string[] = ["zh-CN", "ja"];

const workflowGuideUrl = (locale: string) =>
  WORKFLOW_DOC_LOCALES.includes(locale)
    ? `https://busabase.com/${locale}/docs/workflows`
    : "https://busabase.com/docs/workflows";

interface WorkflowRunStepName {
  id: string;
  label: string;
}

interface WorkflowRunsPanelProps {
  orpc: BusabaseQueryUtils;
  /** The workflow node whose runs this panel starts and lists. */
  workflowNodeId: string;
  /** Steps of the saved workflow, to name each step of a run. */
  steps: readonly WorkflowRunStepName[];
  /** Runs execute the last saved graph, so starting one is blocked until the canvas is saved. */
  hasUnsavedChanges: boolean;
  /**
   * Receives the selected run's per-step state for the canvas highlight, and
   * `null` when the panel goes away. Must be stable (a state setter is ideal).
   */
  onHighlightChange?: (states: ReadonlyMap<string, WorkflowRunStepState> | null) => void;
}

const STATUS_BADGE_CLASS: Record<WorkflowRunStatus, string> = {
  queued: "border-border bg-muted text-muted-foreground",
  running: "border-primary/40 bg-primary/10 text-primary",
  waiting: "border-primary/40 bg-background text-foreground",
  waiting_approval: "border-primary/40 bg-background text-foreground",
  completed: "border-primary/30 bg-primary/10 text-primary",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  cancelled: "border-border bg-muted text-muted-foreground",
};

const STEP_KINDS = new Set<string>([
  "trigger",
  "webhook",
  "function",
  "condition",
  "wait",
  "approval",
  "action",
  "end",
]);

const stepKindLabel = (kind: string, messages: CoreI18nMessages) =>
  STEP_KINDS.has(kind) ? messages.richNodes[kind as keyof CoreI18nMessages["richNodes"]] : kind;

const formatRunTime = (value: string, locale: string) =>
  Number.isNaN(Date.parse(value)) ? value : formatListDateTime(value, locale);

const formatStepTime = (value: string, locale: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

function RunStatusBadge({ status }: { status: WorkflowRunStatus }) {
  const messages = useCoreI18n();
  return (
    <span
      className={`inline-flex shrink-0 items-center border px-1.5 py-0.5 font-medium text-[10px] leading-none ${STATUS_BADGE_CLASS[status]}`}
      data-workflow-run-status={status}
    >
      {messages.workflowRuns[workflowRunStatusLabelKey(status)]}
    </span>
  );
}

interface ConfirmCancelProps {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  triggerLabel: string;
  triggerMarker: Record<string, string>;
  onConfirm: () => void;
}

/** Cancelling cannot be undone, so it always asks once, with what will and won't stop. */
function ConfirmCancel({
  title,
  body,
  confirmLabel,
  busy,
  triggerLabel,
  triggerMarker,
  onConfirm,
}: ConfirmCancelProps) {
  const copy = useCoreI18n().workflowRuns;
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        {...triggerMarker}
        disabled={busy}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Ban className="size-3.5" />
        {triggerLabel}
      </Button>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">{title}</AlertDialogTitle>
            <AlertDialogDescription className="leading-6">{body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel>{copy.keepRun}</AlertDialogCancel>
            <AlertDialogAction data-workflow-run-cancel-confirm="" onClick={onConfirm}>
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface WorkflowRunDetailsProps {
  run: WorkflowRun;
  /** Display names by user id; an unknown id shows as itself. */
  actorNames: Readonly<Record<string, string>>;
  steps: readonly WorkflowRunStepName[];
  actionError: string | null;
  busy: boolean;
  /** Whether the viewer may continue a Wait early (write on the workflow). */
  canContinue: boolean;
  /** Whether the viewer may decide this run's approval step (see `decidableRunIds`). */
  canDecide: boolean;
  /** Whether the viewer may stop this run (write on the workflow). */
  canCancel: boolean;
  onCancel: () => void;
  onContinue: () => void;
  onDecide: (decision: DecideWorkflowRunInput["decision"]) => void;
}

function WorkflowRunDetails({
  run,
  actorNames,
  steps,
  actionError,
  busy,
  canContinue,
  canDecide,
  canCancel,
  onCancel,
  onContinue,
  onDecide,
}: WorkflowRunDetailsProps) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const copy = messages.workflowRuns;
  const orderedSteps = useMemo(() => orderedWorkflowRunSteps(run.outputs), [run.outputs]);
  const pause = run.pause;

  return (
    <section
      aria-label={copy.runDetails}
      className="grid gap-3 border-border/60 border-t pt-4"
      data-run-id={run.id}
      data-workflow-run-details=""
    >
      <div className="flex items-center gap-2">
        <h3 className="font-medium text-foreground text-xs">{copy.runDetails}</h3>
        <RunStatusBadge status={run.status} />
      </div>
      {run.recordId ? (
        <p className="break-all text-muted-foreground text-xs">
          {fmt(copy.recordLabel, { id: run.recordId })}
        </p>
      ) : null}
      <p className="break-words text-muted-foreground text-xs" data-workflow-run-started-by="">
        {run.startedVia
          ? fmt(copy.startedByVia, {
              name: actorNames[run.startedBy] ?? run.startedBy,
              via: run.startedVia.apiKeyName ?? run.startedVia.channel ?? copy.viaAgent,
            })
          : fmt(copy.startedBy, { name: actorNames[run.startedBy] ?? run.startedBy })}
      </p>

      {run.status === "waiting" && pause?.kind === "wait" ? (
        <div
          className="grid gap-2 border border-primary/40 bg-primary/5 px-2 py-2 text-xs"
          data-workflow-run-pause="wait"
        >
          <p className="text-foreground leading-snug">
            {pause.resumeAt
              ? fmt(copy.waitingUntil, { time: formatRunTime(pause.resumeAt, locale) })
              : copy.statusWaiting}
          </p>
          {canContinue ? (
            <Button
              data-workflow-run-continue=""
              disabled={busy}
              onClick={onContinue}
              size="sm"
              type="button"
              variant="outline"
            >
              <FastForward className="size-3.5" />
              {copy.continueNow}
            </Button>
          ) : null}
        </div>
      ) : null}

      {run.status === "waiting_approval" && pause?.kind === "approval" ? (
        <div
          className="grid gap-2 border border-primary/40 bg-primary/5 px-2 py-2 text-xs"
          data-workflow-run-pause="approval"
        >
          <p className="text-foreground leading-snug">
            {fmt(copy.approvalPending, { step: workflowRunStepLabel(pause.nodeId, steps) })}
          </p>
          {canDecide ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                data-workflow-run-approve=""
                disabled={busy}
                onClick={() => onDecide("approved")}
                size="sm"
                type="button"
              >
                <Check className="size-3.5" />
                {copy.approve}
              </Button>
              <Button
                data-workflow-run-reject=""
                disabled={busy}
                onClick={() => onDecide("rejected")}
                size="sm"
                type="button"
                variant="outline"
              >
                <X className="size-3.5" />
                {copy.reject}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground leading-snug" data-workflow-run-cannot-decide="">
              {copy.cannotDecide}
            </p>
          )}
        </div>
      ) : null}

      {run.status === "queued" ? (
        <p
          className="border border-border bg-muted/40 px-2 py-1.5 text-muted-foreground text-xs leading-snug"
          data-workflow-run-queued=""
        >
          {copy.queuedNote}
        </p>
      ) : null}

      {run.status === "cancelled" ? (
        <p
          className="break-words border border-border bg-muted/40 px-2 py-1.5 text-muted-foreground text-xs leading-snug"
          data-workflow-run-cancelled=""
        >
          {fmt(copy.cancelledBy, {
            name: run.cancelledBy ? (actorNames[run.cancelledBy] ?? run.cancelledBy) : "",
          })}
        </p>
      ) : null}

      {canCancel && isWorkflowRunCancellable(run.status) ? (
        <ConfirmCancel
          body={copy.cancelRunBody}
          busy={busy}
          confirmLabel={copy.cancelRun}
          onConfirm={onCancel}
          title={copy.cancelRunTitle}
          triggerLabel={copy.cancelRun}
          triggerMarker={{ "data-workflow-run-cancel": "" }}
        />
      ) : null}

      {run.status === "failed" && run.error ? (
        <p
          className="break-words border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-destructive text-xs leading-snug"
          data-workflow-run-failure=""
        >
          <span className="font-medium">{copy.errorLabel}: </span>
          {run.error}
        </p>
      ) : null}

      {actionError ? (
        <p
          className="break-words text-destructive text-xs leading-snug"
          data-workflow-run-error=""
          role="alert"
        >
          {actionError}
        </p>
      ) : null}

      <div className="grid gap-1.5">
        <h4 className="font-medium text-foreground text-xs">{copy.steps}</h4>
        {orderedSteps.length === 0 ? (
          <p className="text-muted-foreground text-xs">{copy.noSteps}</p>
        ) : (
          <ol className="grid gap-1.5">
            {orderedSteps.map((step, index) => (
              <li
                className="border border-border bg-card"
                data-step-id={step.id}
                data-step-kind={step.output.kind}
                data-workflow-run-step=""
                key={step.id}
              >
                <details>
                  <summary className="grid cursor-pointer gap-0.5 px-2 py-1.5 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {index + 1}.
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                        {workflowRunStepLabel(step.id, steps)}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span>{stepKindLabel(step.output.kind, messages)}</span>
                      <time dateTime={step.output.capturedAt}>
                        {formatStepTime(step.output.capturedAt, locale)}
                      </time>
                    </span>
                  </summary>
                  <div className="grid gap-2 border-border/60 border-t px-2 py-2">
                    <div className="grid gap-1">
                      <span className="text-[10px] text-muted-foreground">{copy.stepData}</span>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all bg-muted/40 p-2 font-mono text-[11px] text-foreground leading-snug">
                        {formatWorkflowRunJson(step.output.data)}
                      </pre>
                    </div>
                    {step.output.record ? (
                      <div className="grid gap-1">
                        <span className="text-[10px] text-muted-foreground">
                          {copy.recordFields}
                        </span>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all bg-muted/40 p-2 font-mono text-[11px] text-foreground leading-snug">
                          {formatWorkflowRunJson(step.output.record.fields)}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/**
 * Start, watch and continue runs of one workflow. Runs execute on the server
 * against the last saved graph; this panel only drives the workflow runtime
 * (`orpc.workflows.*`) and reports the selected run's step states upwards so
 * the canvas can highlight them.
 */
export function WorkflowRunsPanel({
  orpc,
  workflowNodeId,
  steps,
  hasUnsavedChanges,
  onHighlightChange,
}: WorkflowRunsPanelProps) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const copy = messages.workflowRuns;
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [recordId, setRecordId] = useState("");
  const [payloadText, setPayloadText] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  // The run a notification link asked for. It may be older than the first page.
  const [linkedRunId, setLinkedRunId] = useState<string | null>(null);
  // Pages loaded with "Load older runs". They are not polled.
  const [olderRuns, setOlderRuns] = useState<WorkflowRun[]>([]);
  const [olderDecidable, setOlderDecidable] = useState<string[]>([]);
  const [olderNames, setOlderNames] = useState<Record<string, string>>({});
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    const follow = () => {
      const { runId } = parseWorkflowRunLink(window.location.hash);
      if (!runId) return;
      setLinkedRunId(runId);
      setSelectedRunId(runId);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  const listOptions = orpc.workflows.list.queryOptions({
    input: { nodeId: workflowNodeId, limit: RUN_LIST_LIMIT },
  });
  const listQuery = useQuery({
    ...listOptions,
    refetchInterval: (query) => workflowRunsPollInterval(query.state.data?.runs),
  });
  const firstPage = listQuery.data?.runs ?? [];
  const linkedOptions = orpc.workflows.list.queryOptions({
    input: { nodeId: workflowNodeId, runId: linkedRunId ?? "" },
  });
  const linkedQuery = useQuery({
    ...linkedOptions,
    // A link to a run already on screen needs no second request.
    enabled:
      linkedRunId !== null &&
      listQuery.isSuccess &&
      !firstPage.some((run) => run.id === linkedRunId) &&
      !olderRuns.some((run) => run.id === linkedRunId),
  });
  const runs = mergeWorkflowRunPages(firstPage, olderRuns, linkedQuery.data?.runs ?? []);
  // Unknown until the list answers: show no actions rather than flash them to a viewer.
  const canRun = listQuery.data?.canRun === true;
  const decidableRunIds = [
    ...(listQuery.data?.decidableRunIds ?? []),
    ...olderDecidable,
    ...(linkedQuery.data?.decidableRunIds ?? []),
  ];
  const actorNames = {
    ...linkedQuery.data?.actorNames,
    ...olderNames,
    ...listQuery.data?.actorNames,
  };
  const nextCursor = olderCursor === undefined ? (listQuery.data?.nextCursor ?? null) : olderCursor;
  const queuedCount = listQuery.data?.queuedCount ?? 0;
  // Nothing picked yet (or the pick fell off the list): show the newest run.
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

  // A mutation returns the run as it stands now; show that at once, then let
  // the refetch bring the rest of the list up to date.
  const applyRun = (run: WorkflowRun) => {
    const stillDecidable = (id: string) => id !== run.id || run.status === "waiting_approval";
    if (olderRuns.some((item) => item.id === run.id)) {
      setOlderRuns((current) => upsertWorkflowRun(current, run));
      setOlderDecidable((current) => current.filter(stillDecidable));
    }
    queryClient.setQueryData(listOptions.queryKey, (current) => ({
      // A run from an older page stays there rather than jumping to the top.
      runs: olderRuns.some((item) => item.id === run.id)
        ? (current?.runs ?? [])
        : upsertWorkflowRun(current?.runs ?? [], run),
      // Only a caller allowed to act gets here, so keep what the server said.
      canRun: current?.canRun ?? true,
      // A decided run leaves the list of runs waiting for this caller's decision.
      decidableRunIds: (current?.decidableRunIds ?? []).filter(stillDecidable),
      nextCursor: current?.nextCursor ?? null,
      queuedCount: current?.queuedCount ?? 0,
      actorNames: current?.actorNames ?? {},
    }));
  };
  // Not awaited: the buttons should come back as soon as the server answers.
  const refreshRuns = () => {
    void queryClient.invalidateQueries({ queryKey: listOptions.queryKey });
    void queryClient.invalidateQueries({ queryKey: linkedOptions.queryKey });
  };

  const loadOlderRuns = async () => {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await queryClient.fetchQuery(
        orpc.workflows.list.queryOptions({
          input: { nodeId: workflowNodeId, limit: RUN_LIST_LIMIT, cursor: nextCursor },
        }),
      );
      setOlderRuns((current) => mergeWorkflowRunPages(current, page.runs));
      setOlderDecidable((current) => [...current, ...page.decidableRunIds]);
      setOlderNames((current) => ({ ...current, ...page.actorNames }));
      setOlderCursor(page.nextCursor);
    } finally {
      setLoadingOlder(false);
    }
  };

  const startMutation = useMutation({
    ...orpc.workflows.start.mutationOptions(),
    onSuccess: (run) => {
      applyRun(run);
      setSelectedRunId(run.id);
    },
    onSettled: refreshRuns,
  });
  const resumeMutation = useMutation({
    ...orpc.workflows.resume.mutationOptions(),
    onSuccess: applyRun,
    onSettled: refreshRuns,
  });
  const decideMutation = useMutation({
    ...orpc.workflows.decide.mutationOptions(),
    onSuccess: applyRun,
    onSettled: refreshRuns,
  });

  const cancelMutation = useMutation({
    ...orpc.workflows.cancel.mutationOptions(),
    onSuccess: applyRun,
    onSettled: refreshRuns,
  });
  const cancelQueuedMutation = useMutation({
    ...orpc.workflows.cancelQueued.mutationOptions(),
    onSuccess: () => {
      // Queued runs on older pages just changed; those pages load again on demand.
      setOlderRuns([]);
      setOlderDecidable([]);
      setOlderCursor(undefined);
    },
    onSettled: refreshRuns,
  });

  const stepStates = useMemo(() => workflowRunStepStates(selectedRun), [selectedRun]);
  useEffect(() => {
    onHighlightChange?.(stepStates);
  }, [onHighlightChange, stepStates]);
  useEffect(() => () => onHighlightChange?.(null), [onHighlightChange]);

  const parsedPayload = parseWorkflowRunPayload(payloadText);
  const canStart = !hasUnsavedChanges && parsedPayload.ok && !startMutation.isPending;

  const start = () => {
    if (!canStart || !parsedPayload.ok) return;
    const trimmedRecordId = recordId.trim();
    startMutation.mutate({
      nodeId: workflowNodeId,
      ...(trimmedRecordId ? { recordId: trimmedRecordId } : {}),
      ...(parsedPayload.payload ? { payload: parsedPayload.payload } : {}),
    });
  };

  const selectRun = (runId: string) => {
    setSelectedRunId(runId);
    resumeMutation.reset();
    decideMutation.reset();
    cancelMutation.reset();
  };

  const runActionError = resumeMutation.error ?? decideMutation.error ?? cancelMutation.error;

  return (
    <div className="grid gap-4" data-workflow-runs-panel="">
      {listQuery.data && !canRun ? (
        <p
          className="text-[11px] text-muted-foreground leading-snug"
          data-workflow-run-readonly=""
          role="note"
        >
          {copy.readOnlyNote}
        </p>
      ) : null}
      {canRun ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            start();
          }}
        >
          <div className="grid gap-1">
            <h2 className="font-medium text-foreground text-xs">{copy.startTitle}</h2>
            <p className="text-[11px] text-muted-foreground/80 leading-snug">{copy.startHint}</p>
          </div>
          <label
            className="grid gap-1.5 text-muted-foreground text-xs"
            htmlFor={`${fieldId}-record`}
          >
            {copy.recordId}
            <Input
              aria-describedby={`${fieldId}-record-hint`}
              autoComplete="off"
              data-workflow-run-record-id=""
              id={`${fieldId}-record`}
              onChange={(event) => setRecordId(event.target.value)}
              spellCheck={false}
              value={recordId}
            />
            <span
              className="text-[11px] text-muted-foreground/80 leading-snug"
              id={`${fieldId}-record-hint`}
            >
              {copy.recordIdHint}
            </span>
          </label>
          <label
            className="grid gap-1.5 text-muted-foreground text-xs"
            htmlFor={`${fieldId}-payload`}
          >
            {copy.payload}
            <Textarea
              aria-describedby={`${fieldId}-payload-hint`}
              aria-invalid={!parsedPayload.ok}
              className="font-mono text-xs"
              data-workflow-run-payload=""
              id={`${fieldId}-payload`}
              onChange={(event) => setPayloadText(event.target.value)}
              placeholder='{"score": 80}'
              rows={3}
              spellCheck={false}
              value={payloadText}
            />
            {parsedPayload.ok ? (
              <span
                className="text-[11px] text-muted-foreground/80 leading-snug"
                id={`${fieldId}-payload-hint`}
              >
                {copy.payloadHint}
              </span>
            ) : (
              <span
                className="text-[11px] text-destructive leading-snug"
                data-workflow-run-payload-error=""
                id={`${fieldId}-payload-hint`}
                role="alert"
              >
                {copy.payloadInvalid}
              </span>
            )}
          </label>
          {hasUnsavedChanges ? (
            <p
              className="text-[11px] text-muted-foreground leading-snug"
              data-workflow-run-unsaved=""
              role="note"
            >
              {copy.unsavedBlocked}
            </p>
          ) : null}
          <Button
            className="w-full"
            data-workflow-run-start=""
            disabled={!canStart}
            size="sm"
            type="submit"
          >
            <Play className="size-3.5" />
            {startMutation.isPending ? copy.starting : copy.start}
          </Button>
          {startMutation.error ? (
            <p
              className="break-words text-destructive text-xs leading-snug"
              data-workflow-run-error=""
              role="alert"
            >
              {presentCoreError(messages, locale, startMutation.error, copy.actionFailed)}
            </p>
          ) : null}
        </form>
      ) : null}

      <section className="grid gap-2 border-border/60 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-foreground text-xs">{copy.recentRuns}</h3>
          {canRun && queuedCount >= 2 ? (
            <ConfirmCancel
              body={copy.cancelAllBody}
              busy={cancelQueuedMutation.isPending}
              confirmLabel={fmt(copy.cancelAllQueued, { count: queuedCount })}
              onConfirm={() => cancelQueuedMutation.mutate({ nodeId: workflowNodeId })}
              title={fmt(copy.cancelAllTitle, { count: queuedCount })}
              triggerLabel={fmt(copy.cancelAllQueued, { count: queuedCount })}
              triggerMarker={{ "data-workflow-run-cancel-queued": "" }}
            />
          ) : null}
        </div>
        {cancelQueuedMutation.error ? (
          <p className="break-words text-destructive text-xs leading-snug" role="alert">
            {presentCoreError(messages, locale, cancelQueuedMutation.error, copy.actionFailed)}
          </p>
        ) : null}
        {listQuery.isPending ? (
          <p className="text-muted-foreground text-xs">{messages.common.loading}</p>
        ) : listQuery.isError ? (
          <p className="break-words text-destructive text-xs" role="alert">
            {presentCoreError(messages, locale, listQuery.error, copy.loadFailed)}
          </p>
        ) : runs.length === 0 ? (
          <p className="text-muted-foreground text-xs">{copy.empty}</p>
        ) : (
          // Scrolls on its own, so the details below stay in reach of a long list.
          <ul className="grid max-h-72 gap-1 overflow-y-auto" data-workflow-run-list="">
            {runs.map((run) => {
              const selected = run.id === selectedRun?.id;
              return (
                <li key={run.id}>
                  <button
                    aria-pressed={selected}
                    className={`grid w-full gap-1 border px-2 py-1.5 text-left text-xs transition-colors ${
                      selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                    }`}
                    data-run-id={run.id}
                    data-status={run.status}
                    data-workflow-run-item=""
                    onClick={() => selectRun(run.id)}
                    type="button"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <RunStatusBadge status={run.status} />
                      <span className="truncate text-muted-foreground">
                        {run.trigger === "event" ? copy.triggerEvent : copy.triggerManual}
                      </span>
                      <time
                        className="ml-auto shrink-0 text-[10px] text-muted-foreground"
                        dateTime={run.startedAt}
                      >
                        {formatRunTime(run.startedAt, locale)}
                      </time>
                    </span>
                    {run.status === "failed" && run.error ? (
                      <span className="line-clamp-2 break-words text-destructive">{run.error}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {nextCursor ? (
          <Button
            data-workflow-run-load-older=""
            disabled={loadingOlder}
            onClick={() => void loadOlderRuns()}
            size="sm"
            type="button"
            variant="ghost"
          >
            {loadingOlder ? messages.common.loading : copy.loadOlder}
          </Button>
        ) : null}
        {runs.length > 0 ? (
          <p className="text-[11px] text-muted-foreground/80 leading-snug">
            {fmt(copy.keptNote, { days: WORKFLOW_RUN_RETENTION_DAYS })}
          </p>
        ) : null}
        <a
          className="text-[11px] text-primary leading-snug hover:underline"
          data-workflow-run-guide=""
          href={workflowGuideUrl(locale)}
          rel="noreferrer"
          target="_blank"
        >
          {copy.guideLink}
        </a>
      </section>

      {selectedRun ? (
        <WorkflowRunDetails
          actionError={
            runActionError
              ? presentCoreError(messages, locale, runActionError, copy.actionFailed)
              : null
          }
          actorNames={actorNames}
          busy={resumeMutation.isPending || decideMutation.isPending || cancelMutation.isPending}
          canCancel={canRun}
          canContinue={canRun}
          canDecide={decidableRunIds.includes(selectedRun.id)}
          onCancel={() => cancelMutation.mutate({ runId: selectedRun.id })}
          onContinue={() => resumeMutation.mutate({ runId: selectedRun.id, force: true })}
          onDecide={(decision) => decideMutation.mutate({ runId: selectedRun.id, decision })}
          run={selectedRun}
          steps={steps}
        />
      ) : null}
    </div>
  );
}
