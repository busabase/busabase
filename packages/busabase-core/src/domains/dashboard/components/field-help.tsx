"use client";

import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { Info } from "lucide-react";
import { useId, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";

export type FieldHelpValue = { description?: string; example?: string };

export const hasFieldHelp = (help?: FieldHelpValue) =>
  Boolean(help?.description?.trim() || help?.example?.trim());

/** Persistent plain-text guidance. Examples are never input defaults. */
export function FieldHelp({ help, id }: { help?: FieldHelpValue; id?: string }) {
  const messages = useCoreI18n();
  const [expanded, setExpanded] = useState(false);
  if (!hasFieldHelp(help)) return null;
  const description = help?.description?.trim();
  const example = help?.example?.trim();
  const long = Boolean(description && description.length > 240);
  return (
    <div
      className="mt-1.5 space-y-1 break-words text-muted-foreground text-xs leading-5"
      id={id}
      data-testid={id}
    >
      {description ? (
        <p className="whitespace-pre-wrap">
          {long && !expanded ? `${description.slice(0, 240)}…` : description}
        </p>
      ) : null}
      {long ? (
        <button
          className="text-primary underline underline-offset-2"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? messages.fieldHelp.less : messages.fieldHelp.more}
        </button>
      ) : null}
      {example ? (
        <p className="whitespace-pre-wrap">
          {messages.fieldHelp.example}: {example}
        </p>
      ) : null}
    </div>
  );
}

export function FieldHelpPopover({
  help,
  name,
  fieldId,
}: {
  help?: FieldHelpValue;
  name: string;
  fieldId: string;
}) {
  const messages = useCoreI18n();
  const [open, setOpen] = useState(false);
  if (!hasFieldHelp(help)) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`field-help-trigger-${fieldId}`}
          aria-label={fmt(messages.fieldHelp.view, { name })}
          onClick={(event) => {
            if (open) event.preventDefault();
          }}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") setOpen(true);
          }}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="max-h-80 w-72 overflow-auto"
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="font-medium text-sm">{name}</div>
        <FieldHelp help={help} />
      </PopoverContent>
    </Popover>
  );
}

export function FieldHelpSettings({
  help,
  onChange,
  disabled = false,
}: {
  help: FieldHelpValue;
  onChange: (help: FieldHelpValue) => void;
  disabled?: boolean;
}) {
  const messages = useCoreI18n();
  const id = useId();
  return (
    <fieldset disabled={disabled} className="space-y-3 sm:col-span-2">
      <label className="block" htmlFor={`${id}-description`}>
        <span className="text-muted-foreground text-xs">{messages.fieldHelp.description}</span>
        <textarea
          data-testid="field-help-description-input"
          id={`${id}-description`}
          maxLength={1000}
          rows={3}
          className="mt-1 w-full resize-y rounded-md border border-border/70 bg-card px-2.5 py-2 text-sm outline-none focus:border-primary"
          value={help.description ?? ""}
          onChange={(event) => onChange({ ...help, description: event.target.value })}
        />
      </label>
      <label className="block" htmlFor={`${id}-example`}>
        <span className="text-muted-foreground text-xs">{messages.fieldHelp.example}</span>
        <textarea
          data-testid="field-help-example-input"
          id={`${id}-example`}
          maxLength={200}
          rows={2}
          className="mt-1 w-full resize-y rounded-md border border-border/70 bg-card px-2.5 py-2 text-sm outline-none focus:border-primary"
          value={help.example ?? ""}
          onChange={(event) => onChange({ ...help, example: event.target.value })}
        />
      </label>
      <p className="text-muted-foreground text-xs">{messages.fieldHelp.publicHint}</p>
      {hasFieldHelp(help) ? (
        <div
          data-testid="field-help-preview"
          className="rounded-md border border-border/60 bg-muted/30 p-3"
        >
          <span className="font-medium text-xs">{messages.fieldHelp.preview}</span>
          <FieldHelp help={help} />
        </div>
      ) : null}
    </fieldset>
  );
}
