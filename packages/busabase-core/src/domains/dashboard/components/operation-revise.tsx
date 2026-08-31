import { useMutation } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { ChangeRequestVO, OperationVO } from "busabase-contract/types";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { type CoreI18nMessages, useCoreI18n } from "../../../i18n";
import { getOperationFieldLabel, isLongTextValue } from "./operation-diff";

/**
 * Statuses whose operations `operations.revise` will accept. Mirrors the guard in
 * `logic/cr-lifecycle.ts` → `reviseOperation`; `conflict` is included on purpose,
 * because re-authoring is the documented escape hatch out of a 3-way merge
 * conflict (the revise re-baselines the op so the next merge is clean).
 */
export const REVISABLE_CHANGE_REQUEST_STATUSES = [
  "in_review",
  "changes_requested",
  "conflict",
] as const;

export const isChangeRequestRevisable = (changeRequest: ChangeRequestVO) =>
  (REVISABLE_CHANGE_REQUEST_STATUSES as readonly string[]).includes(changeRequest.status);

/**
 * Which control a payload value gets. Deliberately keyed on the *value's* runtime
 * shape rather than on `operation.operation`: commit payloads are `z.record` by
 * design (see `commitSchema`) and carry no per-kind guarantee, so there are 40+
 * operation kinds but only a handful of value shapes. Structured Base field types
 * (relation/attachment/select) therefore land in `json` for now — see the
 * follow-up note in the changelog.
 */
export type PayloadEditorKind = "boolean" | "json" | "longText" | "number" | "text";

export const payloadEditorKindFor = (value: unknown): PayloadEditorKind => {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return isLongTextValue(value) ? "longText" : "text";
  return "json";
};

/** Value → the raw string the editor holds. Inverse of {@link parsePayloadDraftValue}. */
export const payloadValueToDraft = (value: unknown, kind: PayloadEditorKind): string => {
  if (kind === "boolean") return value === true ? "true" : "false";
  if (kind === "number") return typeof value === "number" ? String(value) : "";
  if (kind === "text" || kind === "longText") return typeof value === "string" ? value : "";
  return JSON.stringify(value ?? null, null, 2);
};

export interface PayloadDraftParseResult {
  error: "invalidJson" | "invalidNumber" | null;
  value: unknown;
}

export const parsePayloadDraftValue = (
  raw: string,
  kind: PayloadEditorKind,
): PayloadDraftParseResult => {
  if (kind === "boolean") return { error: null, value: raw === "true" };
  if (kind === "text" || kind === "longText") return { error: null, value: raw };
  if (kind === "number") {
    const parsed = Number(raw);
    if (raw.trim() === "" || Number.isNaN(parsed)) return { error: "invalidNumber", value: null };
    return { error: null, value: parsed };
  }
  try {
    return { error: null, value: JSON.parse(raw) };
  } catch {
    return { error: "invalidJson", value: null };
  }
};

export interface PayloadDraftEntry {
  kind: PayloadEditorKind;
  label: string;
  raw: string;
  slug: string;
}

/**
 * Seed the editor from the operation's CURRENT head payload — every key, not just
 * the ones the diff highlights as changed.
 *
 * This is load-bearing: `reviseOperation` replaces the commit payload wholesale
 * with what it is handed, so seeding from the diff (which filters out unchanged
 * fields) would silently drop them from the operation on the first save.
 */
export const buildPayloadDraft = (
  changeRequest: ChangeRequestVO,
  operation: OperationVO,
  messages: CoreI18nMessages,
): PayloadDraftEntry[] =>
  Object.entries(operation.headCommit.payload)
    .filter(([, value]) => value !== undefined)
    .map(([slug, value]) => {
      const kind = payloadEditorKindFor(value);
      return {
        kind,
        label: getOperationFieldLabel(changeRequest, operation, slug, messages),
        raw: payloadValueToDraft(value, kind),
        slug,
      };
    });

export interface PayloadDraftResolution {
  errors: Record<string, "invalidJson" | "invalidNumber">;
  fields: Record<string, unknown>;
}

export const resolvePayloadDraft = (entries: PayloadDraftEntry[]): PayloadDraftResolution => {
  const errors: Record<string, "invalidJson" | "invalidNumber"> = {};
  const fields: Record<string, unknown> = {};
  for (const entry of entries) {
    const { error, value } = parsePayloadDraftValue(entry.raw, entry.kind);
    if (error) {
      errors[entry.slug] = error;
      continue;
    }
    fields[entry.slug] = value;
  }
  return { errors, fields };
};

function PayloadFieldEditor({
  entry,
  error,
  onChange,
}: {
  entry: PayloadDraftEntry;
  error: "invalidJson" | "invalidNumber" | undefined;
  onChange: (raw: string) => void;
}) {
  const messages = useCoreI18n();
  const inputId = `revise-field-${entry.slug}`;
  const inputClassName =
    "w-full rounded-md border border-border/70 bg-card px-2.5 py-2 text-sm leading-6 outline-none transition-colors focus:border-primary";

  return (
    <div className="grid gap-2 border-border/40 border-b px-2 py-2.5 text-sm md:grid-cols-[180px_minmax(0,1fr)]">
      <div className="min-w-0">
        <label className="block truncate font-medium" htmlFor={inputId}>
          {entry.label}
        </label>
        <div className="mt-1 font-mono text-[11px] text-muted-foreground">{entry.slug}</div>
      </div>
      <div className="min-w-0">
        {entry.kind === "boolean" ? (
          <select
            className={inputClassName}
            id={inputId}
            onChange={(event) => onChange(event.target.value)}
            value={entry.raw}
          >
            <option value="true">{messages.operationRevise.booleanTrue}</option>
            <option value="false">{messages.operationRevise.booleanFalse}</option>
          </select>
        ) : entry.kind === "longText" || entry.kind === "json" ? (
          <textarea
            className={`${inputClassName} min-h-24 resize-y ${entry.kind === "json" ? "font-mono text-xs" : ""}`}
            id={inputId}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={entry.kind !== "json"}
            value={entry.raw}
          />
        ) : (
          <input
            className={inputClassName}
            id={inputId}
            inputMode={entry.kind === "number" ? "decimal" : undefined}
            onChange={(event) => onChange(event.target.value)}
            type="text"
            value={entry.raw}
          />
        )}
        {error ? (
          <div className="mt-1 text-rejected-strong text-xs dark:text-rejected-soft">
            {error === "invalidJson"
              ? messages.operationRevise.invalidJson
              : messages.operationRevise.invalidNumber}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function OperationReviseForm({
  changeRequest,
  client,
  onCancel,
  onRevised,
  operation,
}: {
  changeRequest: ChangeRequestVO;
  client: BusabaseDashboardApiClient;
  onCancel: () => void;
  onRevised?: () => void | Promise<void>;
  operation: OperationVO;
}) {
  const messages = useCoreI18n();
  const [entries, setEntries] = useState<PayloadDraftEntry[]>(() =>
    buildPayloadDraft(changeRequest, operation, messages),
  );
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const { errors, fields } = useMemo(() => resolvePayloadDraft(entries), [entries]);
  const hasErrors = Object.keys(errors).length > 0;

  const reviseMutation = useMutation({
    mutationFn: async () => {
      const trimmed = message.trim();
      return client.reviseOperation(operation.id, {
        fields,
        ...(trimmed ? { message: trimmed } : {}),
      });
    },
    onError: (error: unknown) => {
      setFailure(error instanceof Error ? error.message : messages.operationRevise.failed);
    },
    onSuccess: async () => {
      setFailure(null);
      await onRevised?.();
      onCancel();
    },
  });

  const updateEntry = (slug: string, raw: string) => {
    setEntries((current) =>
      current.map((entry) => (entry.slug === slug ? { ...entry, raw } : entry)),
    );
  };

  return (
    <div className="mt-3 rounded-lg border border-primary/40 bg-primary/[0.03] p-3">
      <div className="font-medium text-sm">{messages.operationRevise.title}</div>
      <p className="mt-1 text-muted-foreground text-xs leading-5">
        {messages.operationRevise.hint}
      </p>

      {entries.length > 0 ? (
        <div className="mt-3 divide-y divide-border/50">
          {entries.map((entry) => (
            <PayloadFieldEditor
              entry={entry}
              error={errors[entry.slug]}
              key={entry.slug}
              onChange={(raw) => updateEntry(entry.slug, raw)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-md bg-muted/25 px-3 py-3 text-muted-foreground text-sm">
          {messages.operationRevise.emptyPayload}
        </div>
      )}

      <div className="mt-3">
        <label className="block font-medium text-xs" htmlFor="revise-message">
          {messages.operationRevise.messageLabel}
        </label>
        <input
          className="mt-1 w-full rounded-md border border-border/70 bg-card px-2.5 py-2 text-sm outline-none transition-colors focus:border-primary"
          id="revise-message"
          onChange={(event) => setMessage(event.target.value)}
          placeholder={messages.operationRevise.messagePlaceholder}
          type="text"
          value={message}
        />
      </div>

      {failure ? (
        <div className="mt-2 rounded-md border border-rejected/35 bg-rejected/17 px-3 py-2 text-rejected-strong text-sm">
          {failure}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          className="rounded-md border px-3 py-1.5 font-medium text-xs transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={reviseMutation.isPending}
          onClick={onCancel}
          type="button"
        >
          {messages.common.cancel}
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 font-medium text-background text-xs transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={hasErrors || entries.length === 0 || reviseMutation.isPending}
          onClick={() => reviseMutation.mutate()}
          type="button"
        >
          {reviseMutation.isPending ? <Loader2 className="animate-spin" size={13} /> : null}
          {messages.operationRevise.save}
        </button>
      </div>
    </div>
  );
}
