import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { AuditEventVO, ChangeRequestVO, OperationVO, ReviewVO } from "busabase-contract/types";
import { Check, ChevronRight, GitMerge, Loader2, PencilLine, Sparkles, X } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { Fragment, useEffect, useMemo, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import {
  changeRequestStatusLabel,
  getChangeRequestBrief,
  getChangeRequestMessage,
  getChangeRequestReviewMessage,
  getChangeRequestRiskHints,
  getChangeRequestScopeHref,
  getChangeRequestScopeName,
  getChangeRequestTitle,
  getOperationImpact,
  getOperationLabel,
  getOperationMessage,
  getOperationTargetHref,
  getOperationTargetLabel,
  getOperationTitle,
  operationMeta,
  statusTone,
} from "../helpers/change-request";
import { formatDetailTime } from "../helpers/format";
import { resolveSubmissionIdentity } from "../helpers/source-attribution";
import { useIsAnonymousVisitor } from "../visitor-context";
import { SubjectCommentThread } from "./comments";
import { UserRefButton } from "./identity";
import { OperationFieldChanges } from "./operation-diff";
import { isChangeRequestRevisable, OperationReviseForm } from "./operation-revise";
import {
  BackLink,
  BusabaseSidePanel,
  EmptyState,
  RailToggleButton,
  SidebarPanel,
  SidebarRow,
} from "./primitives";
import { SourceAttributionInline } from "./source-attribution";

export function ReviewConflictPanel({ message }: { message: string }) {
  const messages = useCoreI18n();

  return (
    <div className="border-rejected/35 border-b bg-rejected/17 px-4 py-3 text-rejected-strong dark:text-rejected-soft">
      <div className="mx-auto flex max-w-6xl flex-col gap-1.5 text-sm">
        <div className="font-semibold">{messages.review.mergeNeedsReview}</div>
        <div className="leading-6">{fmt(messages.review.mergeNeedsReviewBody, { message })}</div>
      </div>
    </div>
  );
}

/** Conflict detail persisted to `mergeSummary.conflict` when a merge hits a 3-way conflict. */
export interface ChangeRequestConflict {
  recordId: string | null;
  fields: string[];
  detectedAt?: string;
}

export const getChangeRequestConflict = (
  changeRequest: ChangeRequestVO,
): ChangeRequestConflict | null => {
  const summary = changeRequest.mergeSummary as
    | { conflict?: { recordId?: string | null; fields?: unknown; detectedAt?: string } }
    | undefined;
  const conflict = summary?.conflict;
  if (!conflict) {
    return null;
  }
  const fields = Array.isArray(conflict.fields)
    ? conflict.fields.filter((field): field is string => typeof field === "string")
    : [];
  return { recordId: conflict.recordId ?? null, fields, detectedAt: conflict.detectedAt };
};

/**
 * Conflict diff banner shown on a `conflict` CR. Names the colliding fields
 * (from `mergeSummary.conflict`) and points to the two exits: revise the
 * operation to re-baseline + resolve, or close to abandon.
 */
export function ConflictDiffPanel({ changeRequest }: { changeRequest: ChangeRequestVO }) {
  const messages = useCoreI18n();
  const conflict = getChangeRequestConflict(changeRequest);
  if (changeRequest.status !== "conflict") {
    return null;
  }
  return (
    <section className="mt-5 max-w-4xl rounded-lg border border-rejected/35 bg-rejected/17 px-4 py-3 text-rejected-strong dark:text-rejected-soft">
      <div className="flex items-center gap-2 font-semibold text-sm">
        <X size={15} />
        {messages.review.mergeConflictTitle}
      </div>
      {conflict && conflict.fields.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-rejected-strong/80 dark:text-rejected-soft/80">
            {messages.review.conflictingFields}
          </span>
          {conflict.fields.map((field) => (
            <span
              className="rounded-md border border-rejected/35 bg-rejected/17 px-2 py-0.5 font-medium"
              key={field}
            >
              {field}
            </span>
          ))}
        </div>
      ) : null}
      <p className="mt-2 text-xs leading-5">{messages.review.conflictResolveHint}</p>
    </section>
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
  onRevised,
  operation,
  readOnly = false,
}: {
  changeRequest: ChangeRequestVO;
  client: BusabaseDashboardApiClient;
  defaultOpen: boolean;
  onRevised?: () => void | Promise<void>;
  operation: OperationVO;
  readOnly?: boolean;
}) {
  const messages = useCoreI18n();
  const isAnonymous = useIsAnonymousVisitor();
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const meta = operationMeta[operation.operation];
  const changedSinceReview = operationChangedSinceReview(changeRequest, operation);
  const targetHref = getOperationTargetHref(changeRequest, operation);
  // An anonymous visitor may hold `submit` on a public share (enough to OPEN a
  // change request) but never enough to re-author someone else's operation.
  const canRevise = !readOnly && !isAnonymous && isChangeRequestRevisable(changeRequest);

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
          <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs ${meta.tone}`}>
            {operation.position + 1}. {getOperationLabel(operation, messages)}
          </span>
          <span className="min-w-0 truncate font-medium text-sm">
            {getOperationTitle(operation, changeRequest.base, messages)}
          </span>
        </button>
        {changedSinceReview ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-review/17 px-2 py-0.5 font-medium text-[11px] text-review-strong dark:text-review-soft">
            <Sparkles size={11} />
            {messages.review.changedSinceReview}
          </span>
        ) : targetHref ? (
          <Link
            className="inline-flex shrink-0 items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground hover:underline"
            href={targetHref}
          >
            {getOperationTargetLabel(operation, messages)}
            <ChevronRight size={13} />
          </Link>
        ) : (
          <span className="hidden shrink-0 truncate text-muted-foreground text-xs sm:block">
            {getOperationImpact(operation, messages)}
          </span>
        )}
        {canRevise && !editing ? (
          <button
            className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 font-medium text-xs transition-colors hover:bg-accent/40"
            onClick={() => {
              setOpen(true);
              setEditing(true);
            }}
            type="button"
          >
            <PencilLine size={12} />
            {messages.operationRevise.edit}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="px-4 pb-4">
          {changeRequest.operationCount > 1 && getOperationMessage(operation) ? (
            <p className="mb-3 border-primary/30 border-l-2 pl-3 text-sm leading-6">
              {getOperationMessage(operation)}
            </p>
          ) : null}
          {editing ? (
            <OperationReviseForm
              changeRequest={changeRequest}
              client={client}
              key={operation.headCommitId}
              onCancel={() => setEditing(false)}
              onRevised={onRevised}
              operation={operation}
            />
          ) : (
            <OperationFieldChanges changeRequest={changeRequest} operation={operation} />
          )}
          {!isAnonymous ? (
            <div className="mt-4">
              <div className="font-medium text-foreground text-xs">
                {messages.review.commentsOnThisChange}
              </div>
              <div className="mt-2">
                <SubjectCommentThread
                  client={client}
                  emptyLabel={messages.comments.noCommentsOperation}
                  placeholder={messages.comments.placeholderOperation}
                  readOnly={readOnly}
                  subjectId={operation.id}
                  subjectType="operation"
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function OperationReviewList({
  changeRequest,
  client,
  focusOperationId,
  onRevised,
  readOnly = false,
}: {
  changeRequest: ChangeRequestVO;
  client: BusabaseDashboardApiClient;
  focusOperationId: string | null;
  onRevised?: () => void | Promise<void>;
  readOnly?: boolean;
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
          onRevised={onRevised}
          operation={operation}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

export function ReviewTimelineEntry({ review }: { review: ReviewVO }) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const approved = review.verdict === "approved";
  return (
    <div className="flex items-start gap-2.5 rounded-lg border bg-background/40 px-3 py-2.5">
      <span
        className={`mt-0.5 shrink-0 ${
          approved
            ? "text-merged-strong dark:text-merged-soft"
            : "text-rejected-strong dark:text-rejected-soft"
        }`}
      >
        {approved ? <Check size={16} /> : <X size={16} />}
      </span>
      <div className="min-w-0">
        <div className="text-sm">
          <UserRefButton
            fallbackId={review.reviewerId}
            user={review.reviewer}
            title={messages.identity.reviewerDetail}
          />{" "}
          {approved ? messages.review.approvedChangeRequest : messages.review.requestedChanges}
          <span className="ml-2 text-muted-foreground text-xs">
            {formatDetailTime(review.createdAt, locale)}
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
  const messages = useCoreI18n();
  const locale = useCoreLocale();

  return (
    <div className="flex items-start gap-2.5 rounded-lg border bg-background/40 px-3 py-2.5">
      <span className="mt-0.5 shrink-0 text-merged-strong dark:text-merged-soft">
        <GitMerge size={16} />
      </span>
      <div className="min-w-0">
        <div className="text-sm">
          <UserRefButton
            fallbackId={event.actorId}
            user={event.actor}
            title={messages.identity.mergerDetail}
          />{" "}
          {messages.review.mergedThisChangeRequest}
          <span className="ml-2 text-muted-foreground text-xs">
            {formatDetailTime(event.createdAt, locale)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function RevisionTimelineEntry({ event }: { event: AuditEventVO }) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();

  return (
    <div className="flex items-start gap-2.5 rounded-lg border bg-background/40 px-3 py-2.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground">
        <PencilLine size={16} />
      </span>
      <div className="min-w-0">
        <div className="text-sm">
          <UserRefButton
            fallbackId={event.actorId}
            user={event.actor}
            title={messages.identity.reviewerDetail}
          />{" "}
          {messages.review.revisedThisChangeRequest}
          <span className="ml-2 text-muted-foreground text-xs">
            {formatDetailTime(event.createdAt, locale)}
          </span>
        </div>
      </div>
    </div>
  );
}

export type DiscussionTimelineItem =
  | { review: ReviewVO; timestamp: string; type: "review" }
  | { event: AuditEventVO; timestamp: string; type: "merge" }
  | { event: AuditEventVO; timestamp: string; type: "revision" };

export const getChangeRequestMergeEvents = (
  auditEvents: AuditEventVO[],
  changeRequestId: string,
): AuditEventVO[] =>
  auditEvents.filter(
    (event) =>
      event.changeRequestId === changeRequestId && event.action === "change_request.merged",
  );

/**
 * `change_request.updated` is written by several paths; only `reviseOperation`
 * tags it `revision: true` (see `logic/cr-lifecycle.ts`), so the timeline shows
 * re-authoring without also surfacing unrelated lifecycle bookkeeping.
 */
export const getChangeRequestRevisionEvents = (
  auditEvents: AuditEventVO[],
  changeRequestId: string,
): AuditEventVO[] =>
  auditEvents.filter(
    (event) =>
      event.changeRequestId === changeRequestId &&
      event.action === "change_request.updated" &&
      event.metadata.revision === true,
  );

export function ChangeRequestDiscussion({
  auditEvents,
  changeRequest,
  client,
  readOnly = false,
}: {
  auditEvents: AuditEventVO[];
  changeRequest: ChangeRequestVO;
  client: BusabaseDashboardApiClient;
  readOnly?: boolean;
}) {
  const messages = useCoreI18n();
  const isAnonymous = useIsAnonymousVisitor();
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
    const revisionItems = getChangeRequestRevisionEvents(auditEvents, changeRequest.id).map(
      (event) => ({
        event,
        timestamp: event.createdAt,
        type: "revision" as const,
      }),
    );

    return [...reviewItems, ...mergeItems, ...revisionItems].sort((first, second) =>
      first.timestamp.localeCompare(second.timestamp),
    );
  }, [auditEvents, changeRequest.id, changeRequest.reviews]);

  /**
   * The people this Change Request already names, offered to the `@` picker
   * alongside the thread's own comment authors. Not a member query: this package
   * has no space-member endpoint by design, so the mentionable set is whoever
   * the VOs on screen already identify.
   */
  const mentionCandidates = useMemo(
    () => [
      { id: changeRequest.submittedBy, user: changeRequest.submittedByUser },
      ...changeRequest.reviews.map((review) => ({ id: review.reviewerId, user: review.reviewer })),
    ],
    [changeRequest.reviews, changeRequest.submittedBy, changeRequest.submittedByUser],
  );

  return (
    <section className="mt-8 max-w-4xl">
      <div className="font-semibold text-base">{messages.review.discussion}</div>
      {timeline.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {timeline.map((item) => (
            <Fragment key={item.type === "review" ? item.review.id : item.event.id}>
              {item.type === "review" ? (
                <ReviewTimelineEntry review={item.review} />
              ) : item.type === "merge" ? (
                <MergeTimelineEntry event={item.event} />
              ) : (
                <RevisionTimelineEntry event={item.event} />
              )}
            </Fragment>
          ))}
        </div>
      ) : null}
      {!isAnonymous ? (
        <div className="mt-3">
          <SubjectCommentThread
            client={client}
            emptyLabel={messages.comments.noCommentsDiscussion}
            extraMentionCandidates={mentionCandidates}
            placeholder={messages.comments.placeholderDiscussion}
            readOnly={readOnly}
            subjectId={changeRequest.id}
            subjectType="change_request"
          />
        </div>
      ) : null}
    </section>
  );
}

export type ReviewAction = "approve" | "reject" | "merge" | "close";

export function FinishReviewComposer({
  changeRequest,
  pendingAction,
  onApprove,
  onClose,
  onMerge,
  onReject,
}: {
  changeRequest: ChangeRequestVO;
  pendingAction: ReviewAction | null;
  onApprove: (changeRequestId: string, reason?: string) => void;
  onClose: (changeRequestId: string, reason?: string) => void;
  onMerge: (changeRequestId: string) => void;
  onReject: (changeRequestId: string, reason?: string) => void;
}) {
  const messages = useCoreI18n();
  const [verdict, setVerdict] = useState<"approve" | "reject" | null>(
    changeRequest.status === "changes_requested" ? null : "approve",
  );
  const [summary, setSummary] = useState("");
  const isPending = pendingAction !== null;

  useEffect(() => {
    setVerdict(changeRequest.status === "changes_requested" ? null : "approve");
    setSummary("");
  }, [changeRequest.status]);

  if (changeRequest.status === "approved") {
    return (
      <div className="flex flex-col gap-2">
        <button
          aria-busy={pendingAction === "merge"}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 font-semibold text-primary-foreground text-sm disabled:opacity-60"
          disabled={isPending}
          onClick={() => onMerge(changeRequest.id)}
          type="button"
        >
          {pendingAction === "merge" ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <GitMerge size={16} />
          )}
          {messages.review.mergeIntoBase}
        </button>
        <button
          className="text-muted-foreground text-xs transition-colors hover:text-foreground"
          disabled={isPending}
          onClick={() => onClose(changeRequest.id)}
          type="button"
        >
          {messages.review.closeChangeRequest}
        </button>
      </div>
    );
  }

  // Conflict: no approve/merge path until revised. Offer the abandon (close) exit
  // here; resolving is done by revising the proposed change (the operation editor).
  if (changeRequest.status === "conflict") {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-md border border-rejected/35 bg-rejected/17 px-3 py-2 text-rejected-strong text-xs leading-5 dark:text-rejected-soft">
          {messages.review.conflictComposerHint}
        </div>
        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 font-semibold text-sm transition-colors hover:bg-muted disabled:opacity-60"
          disabled={isPending}
          onClick={() => onClose(changeRequest.id)}
          type="button"
        >
          <X size={16} />
          {messages.review.closeChangeRequest}
        </button>
      </div>
    );
  }

  // Reviewable: open (in_review) or awaiting-re-review (changes_requested).
  if (changeRequest.status !== "in_review" && changeRequest.status !== "changes_requested") {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <GitMerge size={16} />
        {getChangeRequestReviewMessage(changeRequest, messages)}
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
        <div className="rounded-md border border-rejected/35 bg-rejected/17 px-3 py-2 text-rejected-strong text-xs leading-5 dark:text-rejected-soft">
          {messages.review.changesRequestedHint}
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            checked={verdict === "approve"}
            disabled={isPending}
            name="cr-verdict"
            onChange={() => setVerdict("approve")}
            type="radio"
          />
          <Check className="text-merged-strong dark:text-merged-soft" size={15} />
          {messages.review.approve}
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            checked={verdict === "reject"}
            disabled={isPending}
            name="cr-verdict"
            onChange={() => setVerdict("reject")}
            type="radio"
          />
          <X className="text-rejected-strong dark:text-rejected-soft" size={15} />
          {messages.review.requestChanges}
        </label>
      </div>
      <textarea
        aria-label={messages.review.reviewSummary}
        className="min-h-20 w-full resize-y rounded-md border border-border/70 bg-card px-2.5 py-2 text-sm leading-6 outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        onChange={(event) => setSummary(event.target.value)}
        placeholder={
          verdict === "reject"
            ? messages.review.requestChangesPlaceholder
            : messages.review.approveNotePlaceholder
        }
        value={summary}
      />
      <button
        aria-busy={pendingAction === "approve" || pendingAction === "reject"}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 font-semibold text-primary-foreground text-sm disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending || rejectNeedsReason || verdictRequired}
        onClick={submit}
        type="button"
      >
        {pendingAction === "approve" || pendingAction === "reject" ? (
          <Loader2 className="animate-spin" size={16} />
        ) : null}
        {verdict === "reject" ? messages.review.requestChanges : messages.review.approve}
      </button>
      <button
        className="text-muted-foreground text-xs transition-colors hover:text-foreground"
        disabled={isPending}
        onClick={() => onClose(changeRequest.id)}
        type="button"
      >
        {messages.review.closeChangeRequest}
      </button>
    </div>
  );
}

export function ChangeRequestDetailPage({
  auditEvents,
  changeRequest,
  client,
  focusOperationId,
  pendingAction,
  onApprove,
  onClose,
  onMerge,
  onReject,
  onRevised,
  readOnly = false,
}: {
  auditEvents: AuditEventVO[];
  changeRequest: ChangeRequestVO | null;
  client: BusabaseDashboardApiClient;
  focusOperationId: string | null;
  pendingAction: ReviewAction | null;
  onApprove: (changeRequestId: string, reason?: string) => void;
  onClose: (changeRequestId: string, reason?: string) => void;
  onMerge: (changeRequestId: string) => void;
  onReject: (changeRequestId: string, reason?: string) => void;
  onRevised?: () => void | Promise<void>;
  readOnly?: boolean;
}) {
  const messages = useCoreI18n();

  if (!changeRequest) {
    return (
      <div className="flex-1 p-4">
        <section className="mx-auto max-w-4xl">
          <BackLink href="/inbox" label={messages.nav.inbox} />
          <EmptyState title={messages.review.notFoundTitle} body={messages.review.notFoundBody} />
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
          pendingAction={pendingAction}
          onApprove={onApprove}
          onClose={onClose}
          onMerge={onMerge}
          onReject={onReject}
          onRevised={onRevised}
          readOnly={readOnly}
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
  pendingAction,
  onApprove,
  onClose,
  onMerge,
  onReject,
  onRevised,
  readOnly = false,
}: {
  auditEvents: AuditEventVO[];
  changeRequest: ChangeRequestVO;
  client: BusabaseDashboardApiClient;
  focusOperationId: string | null;
  pendingAction: ReviewAction | null;
  onApprove: (changeRequestId: string, reason?: string) => void;
  onClose: (changeRequestId: string, reason?: string) => void;
  onMerge: (changeRequestId: string) => void;
  onReject: (changeRequestId: string, reason?: string) => void;
  onRevised?: () => void | Promise<void>;
  readOnly?: boolean;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
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
  const submissionIdentity = resolveSubmissionIdentity(
    changeRequest.submittedByUser,
    changeRequest.submittedBy,
    changeRequest.sourceAttribution,
    messages,
  );

  useEffect(() => {
    if (!focusOperationId) {
      return;
    }
    const element = document.getElementById(`op-${focusOperationId}`);
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusOperationId]);

  return (
    <div
      className="mx-auto max-w-6xl px-6 py-5"
      data-change-request-read-only={readOnly ? "true" : undefined}
    >
      <div className="mb-2 flex items-center justify-end">
        <RailToggleButton onToggle={() => setPanelOpen((current) => !current)} open={panelOpen} />
      </div>
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_auto]">
        <main className="min-w-0">
          <h1 className="max-w-3xl font-semibold text-2xl leading-tight">
            {getChangeRequestTitle(changeRequest, messages)}
          </h1>
          <div className="mt-2.5 flex flex-wrap gap-2 text-muted-foreground text-xs">
            <SourceAttributionInline
              channelLabel={submissionIdentity.channelLabel}
              credentialLabel={submissionIdentity.credentialLabel}
              owner={
                changeRequest.submittedByUser ? (
                  <UserRefButton
                    fallbackId={changeRequest.submittedBy}
                    label={submissionIdentity.ownerLabel}
                    labelClassName="font-medium text-muted-foreground"
                    title={messages.identity.submitterDetail}
                    user={changeRequest.submittedByUser}
                  />
                ) : (
                  <span className="font-medium">{submissionIdentity.ownerLabel}</span>
                )
              }
            />
            {submissionIdentity.identityUnavailable ? (
              <>
                <span>·</span>
                <span>{messages.identity.sourceUnavailable}</span>
              </>
            ) : null}
            <span>·</span>
            {getChangeRequestScopeHref(changeRequest) ? (
              <Link
                className="text-primary transition-colors hover:underline"
                href={getChangeRequestScopeHref(changeRequest) ?? "#"}
              >
                {getChangeRequestScopeName(changeRequest, messages)}
              </Link>
            ) : (
              <span>{getChangeRequestScopeName(changeRequest, messages)}</span>
            )}
            <span>·</span>
            <span>{formatDetailTime(changeRequest.createdAt, locale)}</span>
          </div>
          <div className="mt-5 max-w-4xl rounded-lg border bg-background/60 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md border px-2 py-0.5 font-medium text-xs ${statusTone(changeRequest.status)}`}
              >
                {changeRequestStatusLabel(changeRequest.status, messages)}
              </span>
              {getChangeRequestRiskHints(changeRequest, messages).map((risk) => (
                <span
                  className="rounded-md border border-review/35 bg-review/17 px-2 py-0.5 font-medium text-[11px] text-review-strong dark:text-review-soft"
                  key={risk}
                >
                  {risk}
                </span>
              ))}
            </div>
            {getChangeRequestMessage(changeRequest) ? (
              <p className="mt-2 border-primary/30 border-l-2 pl-3 text-sm leading-6">
                {getChangeRequestMessage(changeRequest)}
              </p>
            ) : null}
            <p className="mt-2 text-muted-foreground text-sm leading-6">
              {getChangeRequestBrief(changeRequest, messages)}
            </p>
          </div>

          <ConflictDiffPanel changeRequest={changeRequest} />

          <section className="mt-6 max-w-4xl">
            <div className="font-semibold text-base">{messages.review.whatWillChange}</div>
            <OperationReviewList
              changeRequest={changeRequest}
              client={client}
              focusOperationId={focusOperationId}
              onRevised={onRevised}
              readOnly={readOnly}
            />
          </section>

          <ChangeRequestDiscussion
            auditEvents={auditEvents}
            changeRequest={changeRequest}
            client={client}
            readOnly={readOnly}
          />
        </main>

        <BusabaseSidePanel open={panelOpen}>
          {readOnly ? null : (
            <SidebarPanel title={messages.review.finishReview}>
              <FinishReviewComposer
                changeRequest={changeRequest}
                pendingAction={pendingAction}
                onApprove={onApprove}
                onClose={onClose}
                onMerge={onMerge}
                onReject={onReject}
              />
            </SidebarPanel>
          )}

          <SidebarPanel quiet title={messages.common.description}>
            <div className="mb-3 text-sm">
              {getChangeRequestReviewMessage(changeRequest, messages)}
            </div>
            {approvedReview ? (
              <SidebarRow
                label={messages.review.approvedBy}
                value={
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <UserRefButton
                      fallbackId={approvedReview.reviewerId}
                      labelClassName="font-medium"
                      title={messages.identity.reviewerDetail}
                      user={approvedReview.reviewer}
                    />
                    <span className="shrink-0">·</span>
                    <span className="shrink-0">
                      {formatDetailTime(approvedReview.createdAt, locale)}
                    </span>
                  </span>
                }
              />
            ) : null}
            {mergeEvent ? (
              <SidebarRow
                label={messages.review.mergedBy}
                value={
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <UserRefButton
                      fallbackId={mergeEvent.actorId}
                      labelClassName="font-medium"
                      title={messages.identity.mergerDetail}
                      user={mergeEvent.actor}
                    />
                    <span className="shrink-0">·</span>
                    <span className="shrink-0">
                      {formatDetailTime(mergeEvent.createdAt, locale)}
                    </span>
                  </span>
                }
              />
            ) : null}
            <SidebarRow
              label={messages.common.created}
              value={formatDetailTime(changeRequest.createdAt, locale)}
            />
            <SidebarRow
              label={messages.common.updated}
              value={formatDetailTime(changeRequest.updatedAt, locale)}
            />
          </SidebarPanel>
        </BusabaseSidePanel>
      </div>
    </div>
  );
}
