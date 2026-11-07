"use client";

import { workflowHookPath } from "busabase-contract/domains/workflow/run";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useCoreI18n } from "../../../i18n";

interface Props {
  workflowNodeId: string;
  token: string;
  /** Whether the workflow is in Event mode; the URL answers 404 otherwise. */
  armed: boolean;
  onRegenerate: () => void;
}

/** The URL a "When a request comes in" trigger listens on, to copy into another service. */
export function WorkflowHookUrl({ workflowNodeId, token, armed, onRegenerate }: Props) {
  const messages = useCoreI18n();
  // The page's own origin: the URL must be one the caller can reach, and this
  // is the host the person is using right now.
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}${workflowHookPath(workflowNodeId, token)}`;

  return (
    <div className="grid gap-1.5 text-muted-foreground text-xs" data-workflow-hook="">
      {messages.richNodes.hookUrl}
      <div className="flex items-center gap-1.5">
        <Input
          aria-label={messages.richNodes.hookUrl}
          className="min-w-0 flex-1 font-mono text-[11px]"
          data-workflow-hook-url=""
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={url}
        />
        <Button
          aria-label={messages.richNodes.copyStepReference}
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => setCopied(true));
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Copy className="size-3.5" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button
          className="justify-self-start"
          data-workflow-hook-regenerate=""
          onClick={() => {
            setCopied(false);
            onRegenerate();
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw className="size-3.5" />
          {messages.richNodes.regenerateHookUrl}
        </Button>
        {copied ? (
          <span data-workflow-hook-copied="">{messages.richNodes.hookUrlCopied}</span>
        ) : null}
      </div>
      <span className="text-[11px] leading-snug text-muted-foreground/80">
        {messages.richNodes.hookUrlHint}
      </span>
      {armed ? null : (
        <span className="text-[11px] leading-snug text-warning" data-workflow-hook-unarmed="">
          {messages.richNodes.hookNeedsEvent}
        </span>
      )}
    </div>
  );
}
