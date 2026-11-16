import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { recordFindMessages } from "../../../i18n/record-find";
import type { RecordFindControl } from "../hooks/use-record-find";

/** Shared result feedback; each view supplies the state of the queries it actually renders. */
export function RecordCollectionFeedback({
  pending,
  error,
  empty,
  emptyLabel,
  find,
  onRetry,
}: {
  pending?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyLabel?: string;
  find?: RecordFindControl;
  onRetry?: () => void;
}) {
  const messages = useCoreI18n();
  const findMessages = recordFindMessages[useCoreLocale()];
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-destructive text-sm">
        <span role="alert">{error}</span>
        {onRetry ? (
          <button
            className="rounded-md border border-border/70 px-2 py-1 text-xs hover:bg-accent disabled:opacity-60"
            disabled={pending}
            onClick={onRetry}
            type="button"
          >
            {messages.base.paginationRetry}
          </button>
        ) : null}
      </div>
    );
  }
  if (pending) {
    return (
      <div aria-live="polite" className="text-muted-foreground text-sm" role="status">
        {find ? findMessages.searching : messages.common.loading}
      </div>
    );
  }
  if (!empty) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm"
      data-testid={find?.hasQuery && !emptyLabel ? "base-record-find-empty" : undefined}
    >
      {emptyLabel ?? (find?.hasQuery ? findMessages.empty : messages.base.emptyRecords)}
      {find?.hasQuery && !emptyLabel ? (
        <button
          className="underline underline-offset-2 hover:text-foreground"
          onClick={find.clear}
          type="button"
        >
          {findMessages.clear}
        </button>
      ) : null}
    </div>
  );
}
