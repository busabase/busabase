import { Dialog, DialogTitle } from "kui/dialog";
import { Maximize2, Pencil } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import type { ComponentProps } from "react";
import { useSearch } from "wouter";
import { useCoreI18n } from "../../../i18n";
import { getRecordTitle } from "../helpers/change-request";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { useIsAnonymousVisitor } from "../visitor-context";
import { DialogContent } from "./localized-dialog-content";
import { NodeAgentPromptsButton } from "./node-agent-prompts-button";
import { RecordDetailView } from "./record-views";

export function RecordDetailDialog({
  onClose,
  returnFocusTo,
  error,
  ...detailProps
}: ComponentProps<typeof RecordDetailView> & {
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
  error?: string | null;
}) {
  const messages = useCoreI18n();
  const currentSearch = useSearch();
  const isAnon = useIsAnonymousVisitor();
  const { record, baseSlug } = detailProps;
  const recordHref = record
    ? mergeSearchIntoHref(`/base/${baseSlug}/${record.id}`, currentSearch)
    : null;

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[90dvh] w-[calc(100vw-2rem)] max-w-[1280px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1280px]"
        data-testid="record-detail-dialog"
        onCloseAutoFocus={(event) => {
          if (returnFocusTo?.isConnected) {
            event.preventDefault();
            returnFocusTo.focus({ preventScroll: true });
          }
        }}
      >
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-border/60 border-b px-4 py-3 pr-12 sm:flex-nowrap sm:gap-3 sm:px-6 sm:py-0 sm:pr-12">
          <DialogTitle className="w-full min-w-0 truncate text-sm sm:w-auto sm:flex-1">
            {record ? getRecordTitle(record, messages) : messages.common.record}
          </DialogTitle>
          {recordHref ? (
            <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
              {/* Same record-scoped entry point the full record page has in its
                  toolbar (`RecordTopbarActions`); it hides itself for
                  anonymous visitors. The Base's identity comes off the record. */}
              {record ? (
                <NodeAgentPromptsButton
                  orpc={null}
                  nodeId={record.base.nodeId}
                  nodeName={record.base.name}
                  nodeType="base"
                  scope={{
                    kind: "record",
                    recordId: record.id,
                    recordTitle: getRecordTitle(record, messages),
                  }}
                />
              ) : null}
              {!isAnon ? (
                <Link
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 font-medium text-muted-foreground text-xs hover:bg-muted/60 hover:text-foreground"
                  href={mergeSearchIntoHref(`/base/${baseSlug}/${record?.id}/edit`, currentSearch)}
                >
                  <Pencil aria-hidden="true" size={14} />
                  {messages.recordView.edit}
                </Link>
              ) : null}
              <Link
                aria-label={messages.recordView.openFullPage}
                className="inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium text-muted-foreground text-xs hover:bg-muted/60 hover:text-foreground"
                href={recordHref}
                title={messages.recordView.openFullPage}
              >
                <Maximize2 aria-hidden="true" size={16} />
                {messages.recordView.openFullPage}
              </Link>
            </div>
          ) : null}
        </header>
        {error ? (
          <div className="p-6 text-rejected-strong text-sm" role="alert">
            {error}
          </div>
        ) : (
          <RecordDetailView {...detailProps} />
        )}
      </DialogContent>
    </Dialog>
  );
}
