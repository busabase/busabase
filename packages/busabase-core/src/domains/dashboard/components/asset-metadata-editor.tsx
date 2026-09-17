"use client";

import { useMutation } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "kui/dialog";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n } from "../../../i18n";
import { localizeCoreErrorMessage } from "../../../i18n/localize-error";
import { ConfirmActionDialog } from "./primitives";

export type AssetMetadata = Record<string, unknown> | null | undefined;

/**
 * How a top-level metadata value is edited.
 *
 * Scalars get a typed control that puts the SAME JS type back on the wire — a
 * number stays a number, a boolean stays a boolean — because these values are
 * the schema hints an agent reads back. Anything structural (object, array,
 * null) is `nested`: rendered read-only and carried through untouched, so a
 * human correcting a summary cannot silently flatten an agent-authored list
 * into a string. Restructuring is still possible, just deliberately: JSON mode.
 */
export type MetadataValueKind = "string" | "number" | "boolean" | "nested";

export interface MetadataDraftRow {
  id: string;
  key: string;
  kind: MetadataValueKind;
  /** Editable text for `string` / `number` rows. */
  text: string;
  /** Editable flag for `boolean` rows. */
  bool: boolean;
  /** The untouched original value for `nested` rows. */
  nested: unknown;
}

export type MetadataDraftError =
  | { kind: "emptyKey" }
  | { kind: "duplicateKey"; key: string }
  | { kind: "invalidNumber"; key: string };

export const metadataValueKind = (value: unknown): MetadataValueKind => {
  if (typeof value === "string") return "string";
  // Non-finite numbers have no JSON representation, so they are not editable
  // as numbers; they fall through to `nested` and are carried through as-is.
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "boolean") return "boolean";
  return "nested";
};

export function metadataToDraftRows(metadata: AssetMetadata): MetadataDraftRow[] {
  return Object.entries(metadata ?? {}).map(([key, value], index) => {
    const kind = metadataValueKind(value);
    return {
      id: `meta_${index}_${key}`,
      key,
      kind,
      text: kind === "string" ? (value as string) : kind === "number" ? String(value) : "",
      bool: kind === "boolean" ? (value as boolean) : false,
      nested: value,
    };
  });
}

export const emptyDraftRow = (seed: number): MetadataDraftRow => ({
  id: `meta_new_${seed}`,
  key: "",
  kind: "string",
  text: "",
  bool: false,
  nested: null,
});

/**
 * Fold the row editor back into a plain object, preserving each value's
 * original JS type. Returns the first validation problem instead of guessing.
 */
export function draftRowsToMetadata(
  rows: MetadataDraftRow[],
): { metadata: Record<string, unknown> } | { error: MetadataDraftError } {
  const metadata: Record<string, unknown> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) return { error: { kind: "emptyKey" } };
    if (Object.hasOwn(metadata, key)) return { error: { kind: "duplicateKey", key } };
    if (row.kind === "number") {
      const raw = row.text.trim();
      const parsed = Number(raw);
      if (raw === "" || !Number.isFinite(parsed)) {
        return { error: { kind: "invalidNumber", key } };
      }
      metadata[key] = parsed;
    } else if (row.kind === "boolean") {
      metadata[key] = row.bool;
    } else if (row.kind === "nested") {
      metadata[key] = row.nested;
    } else {
      metadata[key] = row.text;
    }
  }
  return { metadata };
}

/**
 * Drop rows the user never filled in.
 *
 * The empty state opens with one ready row, and "Add field" leaves one behind
 * if the user changes their mind — neither should turn Save into "Every field
 * needs a key". A row with a value but no key is a real mistake and survives
 * this filter so the validator can say so.
 */
export const pruneBlankRows = (rows: MetadataDraftRow[]): MetadataDraftRow[] =>
  rows.filter((row) => row.key.trim() !== "" || row.kind !== "string" || row.text !== "");

export function parseMetadataJson(
  text: string,
): { metadata: Record<string, unknown> } | { error: "invalidJson" | "notAnObject" } {
  const trimmed = text.trim();
  if (!trimmed) return { metadata: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: "invalidJson" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: "notAnObject" };
  }
  return { metadata: parsed as Record<string, unknown> };
}

const sameValue = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

export interface MetadataWritePayload {
  mode: "merge" | "replace";
  metadata: Record<string, unknown>;
}

/**
 * Choose the write mode deliberately.
 *
 * Edits and additions go out as `merge` carrying ONLY what changed, so a key an
 * agent wrote while this dialog was open survives. A removal cannot be
 * expressed by merging, so it takes `replace` — last-write-wins over the whole
 * object — which is exactly why the caller puts a confirm in front of it.
 * Returns `null` when there is nothing to write.
 */
export function metadataWritePayload(
  original: AssetMetadata,
  next: Record<string, unknown>,
): MetadataWritePayload | null {
  const base = original ?? {};
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (!Object.hasOwn(base, key) || !sameValue(base[key], value)) changed[key] = value;
  }
  const removed = Object.keys(base).filter((key) => !Object.hasOwn(next, key));
  if (removed.length > 0) return { mode: "replace", metadata: next };
  if (Object.keys(changed).length === 0) return null;
  return { mode: "merge", metadata: changed };
}

export const removedMetadataKeys = (
  original: AssetMetadata,
  next: Record<string, unknown>,
): string[] => Object.keys(original ?? {}).filter((key) => !Object.hasOwn(next, key));

const nestedPreview = (value: unknown): string => {
  const serialized = value === undefined ? "undefined" : JSON.stringify(value);
  if (!serialized) return "";
  return serialized.length > 120 ? `${serialized.slice(0, 117)}…` : serialized;
};

const cardButtonClass =
  "rounded-md border bg-card px-2.5 py-1.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground";

type EditorMode = "fields" | "json";

export function AssetMetadataEditorDialog({
  assetId,
  metadata,
  onOpenChange,
  onPersisted,
  open,
  orpc,
  sessionKey,
  startWithBlankRow = false,
}: {
  assetId: string;
  metadata: AssetMetadata;
  onOpenChange: (open: boolean) => void;
  onPersisted: () => Promise<void>;
  open: boolean;
  orpc: BusabaseQueryUtils;
  /**
   * Bumped by the caller on every FRESH open (the Edit / Add field buttons).
   * The draft resets on this, not on `open`, because the removal confirmation
   * deliberately closes the dialog and reopens it on cancel — the draft has to
   * survive that round trip. `0` means "never opened".
   */
  sessionKey: number;
  /** Opened from the empty state's "Add field" — start with one ready row. */
  startWithBlankRow?: boolean;
}) {
  const messages = useCoreI18n();
  const [mode, setMode] = useState<EditorMode>("fields");
  const [rows, setRows] = useState<MetadataDraftRow[]>([]);
  const [jsonText, setJsonText] = useState("");
  const [seed, setSeed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingReplace, setPendingReplace] = useState<{
    payload: MetadataWritePayload;
    removed: string[];
  } | null>(null);
  const updateMutation = useMutation(orpc.assets.updateMetadata.mutationOptions());
  const isBusy = updateMutation.isPending;

  // Read through a ref so a background refetch of `assets.get` cannot wipe a
  // half-typed draft; the draft is re-seeded only when a new session starts.
  const draftSourceRef = useRef({ metadata, startWithBlankRow });
  draftSourceRef.current = { metadata, startWithBlankRow };

  // Re-seed from the server value on every fresh open, so a second edit never
  // resurrects a stale draft (or hides a key an agent added in the meantime).
  useEffect(() => {
    if (sessionKey === 0) return;
    const { metadata: source, startWithBlankRow: blankRow } = draftSourceRef.current;
    const initialRows = metadataToDraftRows(source);
    setRows(
      initialRows.length === 0 || blankRow ? [...initialRows, emptyDraftRow(0)] : initialRows,
    );
    setJsonText(JSON.stringify(source ?? {}, null, 2));
    setSeed(1);
    setMode("fields");
    setError(null);
    setPendingReplace(null);
  }, [sessionKey]);

  const updateRow = (id: string, patch: Partial<MetadataDraftRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setError(null);
  };

  const removeRow = (id: string) => {
    setRows((current) => current.filter((row) => row.id !== id));
    setError(null);
  };

  const addRow = () => {
    setRows((current) => [...current, emptyDraftRow(seed)]);
    setSeed((current) => current + 1);
    setError(null);
  };

  const describeDraftError = (draftError: MetadataDraftError): string => {
    if (draftError.kind === "emptyKey") return messages.assets.metadataEmptyKey;
    if (draftError.kind === "duplicateKey") {
      return fmt(messages.assets.metadataDuplicateKey, { key: draftError.key });
    }
    return fmt(messages.assets.metadataInvalidNumber, { key: draftError.key });
  };

  /** The draft as a plain object, or `null` after reporting why it isn't one. */
  const readDraft = (): Record<string, unknown> | null => {
    if (mode === "json") {
      const parsed = parseMetadataJson(jsonText);
      if ("error" in parsed) {
        setError(
          parsed.error === "invalidJson"
            ? messages.assets.metadataInvalidJson
            : messages.assets.metadataNotAnObject,
        );
        return null;
      }
      return parsed.metadata;
    }
    const folded = draftRowsToMetadata(pruneBlankRows(rows));
    if ("error" in folded) {
      setError(describeDraftError(folded.error));
      return null;
    }
    return folded.metadata;
  };

  const describeWriteError = (writeError: unknown): string => {
    const raw = writeError instanceof Error ? writeError.message : "";
    if (!raw) return messages.assets.metadataSaveFailed;
    // `assertAssetPermission` answers a missing write grant with the same
    // existence-oracle-safe "Asset not found" it uses for a real miss. On a page
    // that is currently rendering this very asset that reads as nonsense, so
    // say what actually happened.
    if (raw === `Asset not found: ${assetId}`) return messages.assets.metadataNoPermission;
    return localizeCoreErrorMessage(messages, raw);
  };

  const executeWrite = async (payload: MetadataWritePayload) => {
    setError(null);
    try {
      await updateMutation.mutateAsync({
        assetId,
        metadata: payload.metadata,
        mode: payload.mode,
      });
      await onPersisted();
      toast.success(messages.assets.metadataSaved);
      setPendingReplace(null);
      onOpenChange(false);
    } catch (writeError) {
      setError(describeWriteError(writeError));
      // Reopen the editor when the failure happened behind the removal
      // confirmation, so the draft is still there to retry or amend.
      setPendingReplace(null);
      onOpenChange(true);
    }
  };

  const submit = () => {
    const next = readDraft();
    if (!next) return;
    const payload = metadataWritePayload(metadata, next);
    if (!payload) {
      onOpenChange(false);
      return;
    }
    if (payload.mode === "replace") {
      const removed = removedMetadataKeys(metadata, next);
      // Do not stack the confirmation beside the KUI dialog: its focus trap
      // makes sibling overlays inaccessible (same reason as the searchable-text
      // panel). Close this one, keep the draft, reopen it on cancel.
      onOpenChange(false);
      setPendingReplace({ payload, removed });
      return;
    }
    void executeWrite(payload);
  };

  const switchMode = (nextMode: EditorMode) => {
    setError(null);
    if (nextMode === mode) return;
    if (nextMode === "json") {
      const folded = draftRowsToMetadata(pruneBlankRows(rows));
      if ("error" in folded) {
        setError(describeDraftError(folded.error));
        return;
      }
      setJsonText(JSON.stringify(folded.metadata, null, 2));
      setMode("json");
      return;
    }
    const parsed = parseMetadataJson(jsonText);
    if ("error" in parsed) {
      setError(
        parsed.error === "invalidJson"
          ? messages.assets.metadataInvalidJson
          : messages.assets.metadataNotAnObject,
      );
      return;
    }
    setRows(metadataToDraftRows(parsed.metadata));
    setMode("fields");
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (isBusy) return;
          onOpenChange(nextOpen);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{messages.assets.metadataEditTitle}</DialogTitle>
            <DialogDescription>{messages.assets.metadataEditDescription}</DialogDescription>
          </DialogHeader>

          <div className="flex rounded-md border bg-muted p-1" role="tablist">
            {(["fields", "json"] as const).map((editorMode) => (
              <button
                aria-selected={mode === editorMode}
                className={`flex-1 rounded-sm px-3 py-1.5 font-medium text-sm ${
                  mode === editorMode ? "bg-card text-foreground" : "text-muted-foreground"
                }`}
                disabled={isBusy}
                key={editorMode}
                onClick={() => switchMode(editorMode)}
                role="tab"
                type="button"
              >
                {editorMode === "fields"
                  ? messages.assets.metadataFieldsMode
                  : messages.assets.metadataJsonMode}
              </button>
            ))}
          </div>

          {mode === "fields" ? (
            <div className="max-h-[50vh] space-y-3 overflow-y-auto">
              {rows.length === 0 ? (
                <p className="rounded-md border border-dashed bg-muted/20 px-3 py-6 text-center text-muted-foreground text-sm">
                  {messages.assets.metadataEmpty}
                </p>
              ) : null}
              {rows.map((row) => (
                <div className="rounded-md border bg-card p-3" key={row.id}>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_2.5rem]">
                    <div className="space-y-1.5">
                      <Label htmlFor={`asset-metadata-key-${row.id}`}>
                        {messages.assets.metadataKeyLabel}
                      </Label>
                      <Input
                        disabled={isBusy}
                        id={`asset-metadata-key-${row.id}`}
                        onChange={(event) => updateRow(row.id, { key: event.target.value })}
                        placeholder="summary"
                        value={row.key}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`asset-metadata-value-${row.id}`}>
                        {messages.assets.metadataValueLabel}
                      </Label>
                      {row.kind === "nested" ? (
                        <div
                          className="flex min-h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5"
                          id={`asset-metadata-value-${row.id}`}
                        >
                          <span className="rounded-md border border-muted-foreground/30 bg-muted px-2 py-0.5 font-medium text-[11px] text-muted-foreground">
                            {messages.assets.metadataNested}
                          </span>
                          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                            {nestedPreview(row.nested)}
                          </span>
                        </div>
                      ) : row.kind === "boolean" ? (
                        <select
                          className="h-9 w-full rounded-md border bg-background px-3 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                          disabled={isBusy}
                          id={`asset-metadata-value-${row.id}`}
                          onChange={(event) =>
                            updateRow(row.id, { bool: event.target.value === "true" })
                          }
                          value={row.bool ? "true" : "false"}
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <Input
                          disabled={isBusy}
                          id={`asset-metadata-value-${row.id}`}
                          inputMode={row.kind === "number" ? "decimal" : undefined}
                          onChange={(event) => updateRow(row.id, { text: event.target.value })}
                          value={row.text}
                        />
                      )}
                    </div>
                    <button
                      aria-label={messages.assets.metadataRemoveField}
                      className="self-end rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isBusy}
                      onClick={() => removeRow(row.id)}
                      title={messages.assets.metadataRemoveField}
                      type="button"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  {row.kind === "nested" ? (
                    <p className="mt-2 text-muted-foreground text-xs">
                      {messages.assets.metadataNestedHint}
                    </p>
                  ) : null}
                </div>
              ))}
              <button
                className={`inline-flex items-center gap-1.5 ${cardButtonClass}`}
                disabled={isBusy}
                onClick={addRow}
                type="button"
              >
                <Plus className="size-3.5" />
                {messages.assets.metadataAddField}
              </button>
            </div>
          ) : (
            <div>
              <label className="font-medium text-sm" htmlFor="asset-metadata-json">
                {messages.assets.metadataJsonMode}
              </label>
              <textarea
                className="mt-2 min-h-56 w-full resize-y rounded-md border bg-card px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                disabled={isBusy}
                id="asset-metadata-json"
                onChange={(event) => {
                  setJsonText(event.target.value);
                  setError(null);
                }}
                spellCheck={false}
                value={jsonText}
              />
            </div>
          )}

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
              {error}
            </div>
          ) : null}
          {isBusy ? (
            <p aria-live="polite" className="text-muted-foreground text-sm">
              {messages.assets.metadataSaving}
            </p>
          ) : null}

          <DialogFooter>
            <button
              className="rounded-md border bg-card px-3 py-1.5 font-medium text-sm hover:bg-muted"
              disabled={isBusy}
              onClick={() => onOpenChange(false)}
              type="button"
            >
              {messages.common.cancel}
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 font-medium text-background text-sm hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isBusy}
              onClick={submit}
              type="button"
            >
              {isBusy ? messages.common.working : messages.assets.metadataSave}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        body={messages.assets.metadataRemoveConfirmBody}
        confirmLabel={messages.assets.metadataRemoveConfirm}
        destructive={false}
        onCancel={() => {
          setPendingReplace(null);
          onOpenChange(true);
        }}
        onConfirm={() => {
          if (pendingReplace) void executeWrite(pendingReplace.payload);
        }}
        open={pendingReplace !== null}
        pending={isBusy}
        title={fmt(messages.assets.metadataRemoveConfirmTitle, {
          count: pendingReplace?.removed.length ?? 0,
          plural: pendingReplace?.removed.length === 1 ? "" : "s",
        })}
      />
    </>
  );
}
