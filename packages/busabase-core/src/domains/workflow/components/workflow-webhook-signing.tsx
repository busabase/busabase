"use client";

import { Button } from "kui/button";
import { Input } from "kui/input";
import { Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { newWorkflowSigningSecret } from "../utils/webhook-signature";

interface Props {
  /** The step's signing secret; empty means the step does not sign. */
  value: string;
  onChange: (secret: string) => void;
}

/**
 * "Sign requests" on a Webhook step: a switch that makes a secret, shows it to
 * copy into the receiver, and lets the author change it. Switching it off
 * removes the secret, so the old one stops meaning anything.
 */
export function WorkflowWebhookSigning({ value, onChange }: Props) {
  const messages = useCoreI18n();
  const copy = messages.richNodes;
  const [copied, setCopied] = useState(false);
  const on = value !== "";
  return (
    <div className="grid gap-1.5 text-muted-foreground text-xs" data-workflow-webhook-signing="">
      <label className="flex items-start gap-2 text-foreground" htmlFor="rich-node-webhook-sign">
        <input
          checked={on}
          className="mt-0.5"
          data-workflow-webhook-sign=""
          id="rich-node-webhook-sign"
          onChange={(event) => {
            setCopied(false);
            onChange(event.target.checked ? newWorkflowSigningSecret() : "");
          }}
          type="checkbox"
        />
        <span>{copy.webhookSign}</span>
      </label>
      {on ? (
        <>
          <div className="flex items-center gap-1.5">
            <Input
              aria-label={copy.webhookSigningSecret}
              className="min-w-0 flex-1 font-mono text-[11px]"
              data-workflow-webhook-secret=""
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              value={value}
            />
            <Button
              aria-label={copy.copyStepReference}
              data-workflow-webhook-secret-copy=""
              onClick={() => {
                void navigator.clipboard?.writeText(value).then(() => setCopied(true));
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
              data-workflow-webhook-secret-regenerate=""
              onClick={() => {
                setCopied(false);
                onChange(newWorkflowSigningSecret());
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw className="size-3.5" />
              {copy.webhookSigningRegenerate}
            </Button>
            {copied ? (
              <span data-workflow-webhook-secret-copied="">{copy.hookUrlCopied}</span>
            ) : null}
          </div>
        </>
      ) : null}
      <span className="text-[11px] leading-snug text-muted-foreground/80">
        {on ? copy.webhookSigningHint : copy.webhookSignOffHint}
      </span>
    </div>
  );
}
