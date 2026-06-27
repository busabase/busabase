import { Check, ChevronRight, GitMerge, Sparkles, X } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { BusabaseDashboardApiClient } from "../../../api-client";
import type { AuditEventVO, ChangeRequestVO, OperationVO, ReviewVO } from "../../../types";
import {
  changeRequestStatusLabel,
  getChangeRequestBrief,
  getChangeRequestReviewMessage,
  getChangeRequestRiskHints,
  getChangeRequestScopeHref,
  getChangeRequestScopeName,
  getChangeRequestTitle,
  getOperationImpact,
  getOperationTargetHref,
  getOperationTargetLabel,
  getOperationTitle,
  operationMeta,
  statusTone,
} from "../helpers/change-request";
import { formatActorLabel, formatDetailTime } from "../helpers/format";
import { SubjectCommentThread } from "./comments";
import { OperationFieldChanges } from "./operation-diff";
import {
  BackLink,
  BusabaseSidePanel,
  EmptyState,
  RailToggleButton,
  SidebarPanel,
  SidebarRow,
} from "./primitives";

export function ReviewConflictPanel({ message }: { message: string }) {
  return (
    <div className="border-amber-200 border-b bg-amber-50 px-4 py-3 text-amber-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-1.5 text-sm">
        <div className="font-semibold">Merge needs review</div>
        <div className="leading-6">
          {message} The change request is still safe here; request a revision or close it after
          review.
        </div>
      </div>
    </div>
  );
}

export const getLatestReview = (changeRequest: ChangeRequestVO): ReviewVO | null =>
  changeRequest.reviews.length > 0
    ? changeRequest.reviews.reduce((latest, review) =>
        review.createdAt > latest.createdAt ? review : latest,
      )
    : null;

export const operationChangedSinceReview = (
  changeRequest: ChangeRequestVO,
  operation: OperationVO,
) => {
  const latest = getLatestReview(changeRequest);
  if (!latest) {
    return false;
  }
  const reviewedHead = latest.visibleOperationHeads[operation.id];
  return Boolean(reviewedHead) && reviewedHead !== operation.headCommitId;
};

export function OperationReviewSection({
  changeRequest,
  client,
  defaultOpen,
  operation,
}: {
  changeRequest: ChangeRequestVO;
  client: BusabaseDashboardApiClient;
  defaultOpen: boolean;
  operation: OperationVO;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = operationMeta[operation.operation];
  const changedSinceReview = operationChangedSinceReview(changeRequest, operation);
  const targetHref = getOperationTargetHref(changeRequest, operation);

  return (
    <div className="scroll-mt-20 border-b last:border-b-0" id={`op-${operation.id}`}>
      <div className="flex items-center gap-2.5 px-4 py-3 transition-colors hover:bg-accent/20">
        <button
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <ChevronRight
            className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
            size={16}
          />
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${meta.tone}`}>
            {operation.position + 1}. {meta.label}
          </span>
          <span className="min-w-0 truncate font-medium text-sm">
            {getOperationTitle(operation)}
          </span>
        </button>
        {changedSinceReview ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <Sparkles size={11} />
            changed since review
          </span>
        ) : targetHref ? (
          <Link
            className="inline-flex shrink-0 items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground hover:underline"
            href={targetHref}
          >
            {getOperationTargetLabel(operation)}
            <ChevronRight size={13} />
          </Link>
        ) : (
          <span className="hidden shrink-0 truncate text-muted-foreground text-xs sm:block">
            {getOperationImpact(operation)}
          </span>
        )}
      </div>
      {open ? (
        <div className="px-4 pb-4">
          <OperationFieldChanges changeRequest={changeRequest} operation={operation} />
          <div className="mt-4">
            <div className="font-medium text-muted-foreground text-xs">Comments on this change</div>
            <div className="mt-2">
              <SubjectCommentThread
                client={client}
                emptyLabel="No comments on this change yet."
                placeholder="Comment on this change… mention @ai to request a revision"
                subjectId={operation.id}
                subjectType="operation"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function OperationReviewList({
  changeRequest,
  client,
  focusOperationId,
}: {
  changeRequest: ChangeRequestVO;
  client: BusabaseDashboardApiClient;
  focusOperationId: string | null;
}) {
  const operations = changeRequest.operations
    .slice()
    .sort((first, second) => first.position - second.position);

  return (
    <div className="mt-3 overflow-hidden rounded-lg border bg-background/40">
      {operations.map((operation) => (
        <OperationReviewSection
          changeRequest={changeRequest}
          client={client}
          defaultOpen={
            focusOperationId ? operation.id === focusOperationId : operations.length === 1
          }
          key={operation.id}
          operation={operation}
        />
      ))}
    </div>
  );
}

export function ReviewTimelineEntry({ review }: { review: ReviewVO }) {
  const approved = review.verdict === "approved";
  return (
    <div className="flex items-start gap-2.5 rounded-lg border bg-background/40 px-3 py-2.5">
      <span className={`mt-0.5 shrink-0 ${approved ? "text-emerald-600" : "text-amber-600"}`}>
        {approved ? <Check size={16} /> : <X size={16} />}
      </span>
      <div className="min-w-0">
        <div className="text-sm">
          <span className="font-medium">{formatActorLabel(review.reviewerId)}</span>{" "}
          {approved ? "approved this change request" : "requested changes"}
          <span className="ml-2 text-muted-foreground text-xs">
            {formatDetailTime(review.createdAt)}
          </span>
        </div>
        {review.reason ? (
          <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
            {review.reason}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MergeTimelineEntry({ event }: { event: AuditEventVO }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border bg-background/40 px-3 py-2.5">
      <span className="mt-0.5 shrink-0 text-sky-600">
        <GitMerge size={16} />
      </span>
      <div className="min-w-0">
        <div className="text-sm">
          <span className="font-medium">{formatActorLabel(event.actorId)}</span> merged this change
          request
          <span className="ml-2 text-muted-foreground text-xs">
            {formatDetailTime(event.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

export type DiscussionTimelineItem =
  | { review: ReviewVO; timestamp: string; type: "review" }
  | { event: AuditEventVO; timestamp: string; type: "merge" };

export const getChangeRequestMergeEvents = (
  auditEvents: AuditEventVO[],
  changeRequestId: string,
): AuditEventVO[] =>
  auditEvents.filter(
    (event) =>
      event.changeRequestId === changeRequestId && event.action === "change_request.merged",
  );

export function ChangeRequestDiscussion({
  auditEvents,
  changeRequest,
  client,
}: {
  auditEvents: AuditEventVO[];
  changeRequest: ChangeRequestVO;
  client: BusabaseDashboardApiClient;
}) {
  const timeline = useMemo<DiscussionTimelineItem[]>(() => {
    const reviewItems = changeRequest.reviews.map((review) => ({
      review,
      timestamp: review.createdAt,
      type: "review" as const,
    }));
    const mergeItems = getChangeRequestMergeEvents(auditEvents, changeRequest.id).map((event) => ({
      event,
      timestamp: event.createdAt,
      type: "merge" as const,
    }));

    return [...reviewItems, ...mergeItems].sort((first, second) =>
      first.timestamp.localeCompare(second.timestamp),
    );
  }, [auditEvents, changeRequest.id, changeRequest.reviews]);

  return (
    <section className="mt-8 max-w-4xl">
      <div className="font-semibold text-base">Discussion</div>
      {timeline.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {timeline.map((item) => (
            <Fragment key={item.type === "review" ? item.review.id : item.event.id}>
              {item.type === "review" ? (
                <ReviewTimelineEntry review={item.review} />
              ) : (
                <MergeTimelineEntry event={item.event} />
              )}
            </Fragment>
          ))}
        </div>
      ) : null}
      <div className="mt-3">
        <SubjectCommentThread
          client={client}
          emptyLabel="No comments yet. Leave feedback for the author or @ai."
          placeholder="Leave a comment for the author… mention @ai to request a revision"
          subjectId={changeRequest.id}
          subjectType="change_request"
        />
      </div>
    </section>
  );
}

export function FinishReviewComposer({
  changeRequest,
  isPending,
  onApprove,
  onClose,
  onMerge,
  onReject,
}: {
  changeRequest: ChangeRequestVO;
  isPending: boolean;
  onApprove: (changeRequestId: string, reason?: string) => void;
  onClose: (changeRequestId: string, reason?: string) => void;
  onMerge: (changeRequestId: string) => void;
  onReject: (changeRequestId: string, reason?: string) => void;
}) {
  const [verdict, setVerdict] = useState<"approve" | "reject" | null>(
    changeRequest.status === "changes_requested" ? null : "approve",
  );
  const [summary, setSummary] = useState("");

  useEffect(() => {
    setVerdict(changeRequest.status === "changes_requested" ? null : "approve");
    setSummary("");
  }, [changeRequest.status]);

  if (changeRequest.status === "approved") {
    return (
      <div className="flex flex-col gap-2">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 font-semibold text-primary-foreground text-sm disabled:opacity-60"
          disabled={isPending}
          onClick={() => onMerge(changeRequest.id)}
          type="button"
        >
          <GitMerge size={16} />
          Merge into Base
        </button>
        <button
          className="text-muted-foreground text-xs transition-colors hover:text-foreground"
          disabled={isPending}
          onClick={() => onClose(changeRequest.id)}
          type="button"
        >
          Close change request
        </button>
      </div>
    );
  }

  // Reviewable: open (in_review) or awaiting-re-review (changes_requested).
  if (changeRequest.status !== "in_review" && changeRequest.status !== "changes_requested") {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <GitMerge size={16} />
        {getChangeRequestReviewMessage(changeRequest)}
      </div>
    );
  }

  const rejectNeedsReason = verdict === "reject" && summary.trim().length === 0;
  const verdictRequired = verdict === null;
  const submit = () => {
    if (!verdict) {
      return;
    }
    const note = summary.trim();
    if (verdict === "reject") {
      if (!note) {
        return;
      }
      onReject(changeRequest.id, note);
    } else {
      onApprove(changeRequest.id, note || undefined);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {changeRequest.status === "changes_requested" ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-xs leading-5 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Changes were requested. Keep this open while the author or agent revises; approve only
          after the proposal returns ready for review.
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            checked={verdict === "approve"}
            name="cr-verdict"
            onChange={() => setVerdict("approve")}
            type="radio"
          />
          <Check className="text-emerald-600" size={15} />
          Approve
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            checked={verdict === "reject"}
            name="cr-verdict"
            onChange={() => setVerdict("reject")}
            type="radio"
          />
          <X className="text-amber-600" size={15} />
          Request changes
        </label>
      </div>
      <textarea
        aria-label="Review summary"
        className="min-h-20 w-full resize-y rounded-md border border-border/70 bg-background px-2.5 py-2 text-sm leading-6 outline-none transition-colors focus:border-primary"
        onChange={(event) => setSummary(event.target.value)}
        placeholder={
          verdict === "reject"
            ? "What needs to change? (required — mention @ai to ask the agent)"
            : "Add an optional note…"
        }
        value={summary}
      />
      <button
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 font-semibold text-primary-foreground text-sm disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending || rejectNeedsReason || verdictRequired}
        onClick={submit}
        type="button"
      >
        {verdict === "reject" ? "Request changes" : "Approve"}
      </button>
      <button
        className="text-muted-foreground text-xs transition-colors hover:text-foreground"
        disabled={isPending}
        onClick={() => onClose(changeRequest.id)}
        type="button"
      >
        Close change request
      </button>
    </div>
  );
}

export function ChangeRequestDetailPage({
  auditEvents,
  changeRequest,
  client,
  focusOperationId,
  isPending,
  onApprove,
  onClose,
  onMerge,
  onReject,
}: {
  auditEvents: AuditEventVO[];
  changeRequest: ChangeRequestVO | null;
  client: BusabaseDashboardApiClient;
  focusOperationId: string | null;
  isPending: boolean;
  onApprove: (changeRequestId: string, reason?: string) => void;
  onClose: (changeRequestId: string, reason?: string) => void;
  onMerge: (changeRequestId: string) => void;
  onReject: (changeRequestId: string, reason?: string) => void;
}) {
  if (!changeRequest) {
    return (
      <div className="flex-1 p-4">
        <section className="mx-auto max-w-4xl">
          <BackLink href="/inbox" label="Inbox" />
          <EmptyState
            title="Change Request not found"
            body="The selected change request is no longer in the inbox."
          />
        </section>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <section className="min-h-0 flex-1 overflow-auto">
        <ChangeRequestReviewLayout
          auditEvents={auditEvents}
          changeRequest={changeRequest}
          client={client}
          focusOperationId={focusOperationId}
          isPending={isPending}
          onApprove={onApprove}
          onClose={onClose}
          onMerge={onMerge}
          onReject={onReject}
        />
      </section>
    </div>
  );
}

export function ChangeRequestReviewLayout({
  auditEvents,
  changeRequest,
  client,
  focusOperationId,
  isPending,
  onApprove,
  onClose,
  onMerge,
  onReject,
}: {
  auditEvents: AuditEventVO[];
  changeRequest: ChangeRequestVO;
  client: BusabaseDashboardApiClient;
  focusOperationId: string | null;
  isPending: boolean;
  onApprove: (changeRequestId: string, reason?: string) => void;
  onClose: (changeRequestId: string, reason?: string) => void;
  onMerge: (changeRequestId: string) => void;
  onReject: (changeRequestId: string, reason?: string) => void;
}) {
  const approvedReview = useMemo(
    () =>
      changeRequest.reviews
        .filter((review) => review.verdict === "approved")
        .sort((first, second) => second.createdAt.localeCompare(first.createdAt))[0] ?? null,
    [changeRequest.reviews],
  );
  const mergeEvent = useMemo(
    () =>
      getChangeRequestMergeEvents(auditEvents, changeRequest.id).sort((first, second) =>
        second.createdAt.localeCompare(first.createdAt),
      )[0] ?? null,
    [auditEvents, changeRequest.id],
  );
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    if (!focusOperationId) {
      return;
    }
    const element = document.getElementById(`op-${focusOperationId}`);
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusOperationId]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-5">
      <div className="mb-2 flex items-center justify-end">
        <RailToggleButton onToggle={() => setPanelOpen((current) => !current)} open={panelOpen} />
      </div>
      <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_auto]">
        <main className="min-w-0">
          <h1 className="max-w-3xl font-semibold text-2xl leading-tight">
            {getChangeRequestTitle(changeRequest)}
          </h1>
          <div className="mt-2.5 flex flex-wrap gap-2 text-muted-foreground text-xs">
            <span>{formatActorLabel(changeRequest.submittedBy)}</span>
            <span>·</span>
            {getChangeRequestScopeHref(changeRequest) ? (
              <Link
                className="text-primary transition-colors hover:underline"
                href={getChangeRequestScopeHref(changeRequest) ?? "#"}
              >
                {getChangeRequestScopeName(changeRequest)}
              </Link>
            ) : (
              <span>{getChangeRequestScopeName(changeRequest)}</span>
            )}
            <span>·</span>
            <span>{formatDetailTime(changeRequest.createdAt)}</span>
          </div>
          <div className="mt-5 max-w-4xl rounded-lg border bg-background/60 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 font-medium text-xs ${statusTone(changeRequest.status)}`}
              >
                {changeRequestStatusLabel(changeRequest.status)}
              </span>
              {getChangeRequestRiskHints(changeRequest).map((risk) => (
                <span
                  className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-[11px] text-amber-800"
                  key={risk}
                >
                  {risk}
                </span>
              ))}
            </div>
            <p className="mt-2 text-sm leading-6">{getChangeRequestBrief(changeRequest)}</p>
          </div>

          <section className="mt-6 max-w-4xl">
            <div className="font-semibold text-base">What will change</div>
            <OperationReviewList
              changeRequest={changeRequest}
              client={client}
              focusOperationId={focusOperationId}
            />
          </section>

          <ChangeRequestDiscussion
            auditEvents={auditEvents}
            changeRequest={changeRequest}
            client={client}
          />
        </main>

        <BusabaseSidePanel open={panelOpen}>
          <SidebarPanel title="Finish review">
            <FinishReviewComposer
              changeRequest={changeRequest}
              isPending={isPending}
              onApprove={onApprove}
              onClose={onClose}
              onMerge={onMerge}
              onReject={onReject}
            />
          </SidebarPanel>

          <SidebarPanel quiet title="Details">
            <div className="mb-3 text-sm">{getChangeRequestReviewMessage(changeRequest)}</div>
            {approvedReview ? (
              <SidebarRow
                label="Approved by"
                value={`${formatActorLabel(approvedReview.reviewerId)} · ${formatDetailTime(approvedReview.createdAt)}`}
              />
            ) : null}
            {mergeEvent ? (
              <SidebarRow
                label="Merged by"
                value={`${formatActorLabel(mergeEvent.actorId)} · ${formatDetailTime(mergeEvent.createdAt)}`}
              />
            ) : null}
            <SidebarRow label="Created" value={formatDetailTime(changeRequest.createdAt)} />
            <SidebarRow label="Updated" value={formatDetailTime(changeRequest.updatedAt)} />
          </SidebarPanel>
        </BusabaseSidePanel>
      </div>
    </div>
  );
}
