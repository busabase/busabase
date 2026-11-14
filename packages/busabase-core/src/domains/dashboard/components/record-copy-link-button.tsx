"use client";

import { Check, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCoreI18n } from "../../../i18n";
import { dashboardNodeShareUrl } from "../utils/share-url";
import { useIsAnonymousVisitor } from "../visitor-context";

/**
 * One-click copy of the record's own page address — the same link the Share
 * dialog shows — from the record dialog header and the full record toolbar.
 * A quiet icon (named by its tooltip) so it does not crowd those toolbars.
 * Members only: a public visitor's address is the share URL already in the bar.
 */
export function RecordCopyLinkButton({
  baseNodeId,
  recordId,
}: {
  baseNodeId: string;
  recordId: string;
}) {
  const messages = useCoreI18n();
  const isAnon = useIsAnonymousVisitor();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (isAnon) return null;

  const copy = async () => {
    const url = dashboardNodeShareUrl({
      currentHref: window.location.href,
      nodeType: "base",
      nodeSlug: baseNodeId,
      extraSegments: [recordId],
    });
    if (!url) {
      toast.error(messages.share.failed);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(messages.share.linkCopied);
    } catch {
      toast.error(messages.share.failed);
    }
  };

  const Icon = copied ? Check : Link2;
  return (
    <button
      aria-label={messages.share.copyLink}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      data-testid="record-copy-link"
      onClick={() => void copy()}
      title={messages.share.copyLink}
      type="button"
    >
      <Icon aria-hidden="true" size={14} />
    </button>
  );
}
