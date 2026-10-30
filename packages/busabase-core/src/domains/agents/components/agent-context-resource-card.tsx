"use client";

import type { AcpAttachment } from "@acp-ui/core/reduce";
import { AcpMessageView, type AcpMessageViewProps } from "@acp-ui/web/transcript";
import { NODE_TYPES } from "busabase-contract/domains";
import { NodeIconSchema } from "busabase-contract/types";
import { Dialog, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "kui/dialog";
import { File, FileText } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Link } from "wouter";
import { z } from "zod";
import { useCoreI18n } from "../../../i18n";
import { DialogContent } from "../../dashboard/components/localized-dialog-content";
import { NodeAvatar } from "../../dashboard/helpers/node-icons";

const ContextNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(NODE_TYPES),
  name: z.string(),
  slug: z.string().min(1),
  icon: NodeIconSchema.nullable().optional(),
  truncated: z.boolean(),
});

/** Metadata is a display hint; only a validated node route becomes a link. */
export function contextNodeOf(attachment: AcpAttachment) {
  const parsed = ContextNodeSchema.safeParse(attachment.resource?._meta?.["busabase.node"]);
  return parsed.success ? parsed.data : null;
}

export function AgentContextResourceCard({ attachment }: { attachment: AcpAttachment }) {
  const messages = useCoreI18n();
  const node = contextNodeOf(attachment);
  const resource = attachment.resource?.resource;
  if (!resource || !("text" in resource)) return null;
  const promptContext = z
    .object({ id: z.string(), name: z.string().min(1).max(1027) })
    .safeParse(attachment.resource?._meta?.["acp-ui.resourceContext"]);
  const label =
    (promptContext.success ? promptContext.data.name : undefined) ||
    node?.name ||
    attachment.filename ||
    resource.text.trim() ||
    messages.formula.empty;

  return (
    <ContextTextChip
      label={label}
      icon={node ? <NodeAvatar node={node} /> : <FileText className="size-4" />}
      text={resource.text}
    >
      {node && (
        <Link
          className="inline-block max-w-full break-words text-xs underline underline-offset-4"
          href={`/${node.type}/${encodeURIComponent(node.id)}`}
        >
          {messages.common.open} {node.name}
        </Link>
      )}
      {node?.truncated && (
        <p className="text-muted-foreground text-xs">{messages.agents.contextTruncated}</p>
      )}
    </ContextTextChip>
  );
}

const chipClassName =
  "inline-flex w-fit min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-left text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function ContextTextChip({
  label,
  icon,
  text,
  children,
}: {
  label: string;
  icon: ReactNode;
  text: string;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const messages = useCoreI18n();

  return (
    <div className="min-w-0 max-w-full" data-testid="agent-context-resource">
      <button
        type="button"
        className={chipClassName}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((previous) => !previous)}
      >
        <span aria-hidden="true" className="flex size-4 shrink-0 items-center overflow-hidden">
          {icon}
        </span>
        <span className="min-w-0 truncate">{label}</span>
      </button>
      <div id={contentId} hidden={!expanded} className="mt-2 min-w-0 space-y-2">
        {children}
        <pre
          role="region"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable snapshots need a keyboard focus target.
          tabIndex={0}
          aria-label={messages.agents.contextSnapshot}
          className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs focus-visible:outline-2 focus-visible:outline-ring"
        >
          {text || messages.formula.empty}
        </pre>
      </div>
    </div>
  );
}

function safeFileUrl(uri: string | undefined) {
  if (!uri) return undefined;
  try {
    const url = new URL(uri);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function ContextFileChip({ attachment }: { attachment: AcpAttachment }) {
  const [open, setOpen] = useState(false);
  const messages = useCoreI18n();
  const resource = attachment.resource?.resource;
  const name = attachment.filename || contextNodeOf(attachment)?.name || messages.nodeDetail.file;
  const url = safeFileUrl(resource?.uri);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={chipClassName}>
          <File aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{name}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="break-words pr-6">{name}</DialogTitle>
          <DialogDescription className="break-all">{attachment.mimeType}</DialogDescription>
        </DialogHeader>
        {resource?.uri && <p className="break-all text-sm">{resource.uri}</p>}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline underline-offset-4"
          >
            {messages.common.open}
          </a>
        )}
        {open && (
          <a
            href={`data:application/octet-stream;base64,${resource && "blob" in resource ? resource.blob : attachment.data}`}
            download={name}
            className="text-sm underline underline-offset-4"
          >
            {messages.nodeDetail.downloadFile}
          </a>
        )}
      </DialogContent>
    </Dialog>
  );
}

function renderContextAttachment(attachment: AcpAttachment) {
  if (attachment.kind !== "file") return undefined;
  if (!attachment.resource && /^(image|audio)\//.test(attachment.mimeType)) return undefined;
  const resource = attachment.resource?.resource;
  return resource && "text" in resource ? (
    <AgentContextResourceCard attachment={attachment} />
  ) : (
    <ContextFileChip attachment={attachment} />
  );
}

/** Keep images, audio, message text, and reasoning on the shared renderer. */
export function BusabaseAgentMessageView(props: AcpMessageViewProps) {
  return <AcpMessageView {...props} renderAttachment={renderContextAttachment} />;
}
