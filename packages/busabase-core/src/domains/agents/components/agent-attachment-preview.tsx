"use client";

import type { AcpComposerAttachment, AcpComposerProps } from "@acp-ui/web/composer";
import type { ReactNode } from "react";
import { useCoreI18n } from "../../../i18n";
import { AttachmentValuePreview } from "../../dashboard/components/attachment-value-preview";

/** Local object URLs stay owned by the composer and disappear with their staged chip. */
function AgentAttachmentPreview({
  attachment,
  children,
}: {
  attachment: AcpComposerAttachment;
  children: ReactNode;
}) {
  const messages = useCoreI18n();
  const name = attachment.filename || messages.nodeDetail.file;

  return (
    <AttachmentValuePreview
      className="h-full"
      minimalChrome
      value={[
        {
          id: attachment.id,
          fileName: name,
          mimeType: attachment.mediaType,
          url: attachment.url,
        },
      ]}
      // This is KUI's locally created object URL, not a persisted field URL.
      resolveUrl={(item) => item.url}
      renderTrigger={(_item, onOpen) => (
        <button
          aria-label={`${messages.nodeDetail.filePreviewTitle}: ${name}`}
          aria-haspopup="dialog"
          className="-mx-2 flex h-full min-w-0 items-center gap-1 rounded-sm px-2 text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onOpen}
          type="button"
        >
          {children}
        </button>
      )}
    />
  );
}

export const renderAgentAttachment: NonNullable<AcpComposerProps["renderAttachment"]> = (
  attachment,
  content,
) => <AgentAttachmentPreview attachment={attachment}>{content}</AgentAttachmentPreview>;
