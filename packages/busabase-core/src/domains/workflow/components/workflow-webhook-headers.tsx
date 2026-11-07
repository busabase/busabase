"use client";

import type { WorkflowWebhookHeader } from "busabase-contract/domains/rich-node/types";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Plus, X } from "lucide-react";
import { useCoreI18n } from "../../../i18n";

interface Props {
  value: WorkflowWebhookHeader[];
  onChange: (headers: WorkflowWebhookHeader[]) => void;
}

const MAX_HEADERS = 20;

/** The extra request headers of a Webhook step, such as `Authorization`. */
export function WorkflowWebhookHeaders({ value, onChange }: Props) {
  const messages = useCoreI18n();
  const set = (index: number, patch: Partial<WorkflowWebhookHeader>) =>
    onChange(value.map((header, at) => (at === index ? { ...header, ...patch } : header)));

  return (
    <div className="grid gap-1.5 text-muted-foreground text-xs" data-workflow-webhook-headers="">
      {messages.richNodes.webhookHeaders}
      {value.map((header, index) => (
        // Rows have no identity of their own; the position is the identity.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <div className="flex items-center gap-1.5" key={index}>
          <Input
            aria-label={messages.richNodes.webhookHeaderName}
            className="w-2/5"
            data-workflow-webhook-header-name=""
            onChange={(event) => set(index, { name: event.target.value })}
            placeholder="Authorization"
            value={header.name}
          />
          <Input
            aria-label={messages.richNodes.webhookHeaderValue}
            className="flex-1"
            data-workflow-webhook-header-value=""
            onChange={(event) => set(index, { value: event.target.value })}
            placeholder="Bearer …"
            value={header.value}
          />
          <Button
            aria-label={messages.richNodes.removeWebhookHeader}
            onClick={() => onChange(value.filter((_, at) => at !== index))}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      {value.length < MAX_HEADERS ? (
        <Button
          className="justify-self-start"
          data-workflow-webhook-header-add=""
          onClick={() => onChange([...value, { name: "", value: "" }])}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus className="size-3.5" />
          {messages.richNodes.addWebhookHeader}
        </Button>
      ) : null}
      <span className="text-[11px] leading-snug text-muted-foreground/80">
        {messages.richNodes.webhookHeadersHint}
      </span>
    </div>
  );
}
