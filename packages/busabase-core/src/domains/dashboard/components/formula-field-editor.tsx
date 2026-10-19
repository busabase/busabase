import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";
import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import { AlertCircle, Check, Code2, Columns3, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale, useIString } from "../../../i18n";
import { assertValidFormulaField } from "../../base/field-rules";
import { collectFieldRefs } from "../../base/formula/ast";
import { FORMULA_CATALOG } from "../../base/formula/catalog";
import { formatFormulaValue, previewFormulaField } from "../../base/formula/field-preview";
import { parseFormula } from "../../base/formula/parser";
import { getRecordTitle } from "../helpers/change-request";
import { type FormulaFieldOptions, formulaDependentFields } from "../helpers/formula-field";

const formulaLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/\{[^}]*\}/)) return "variableName";
    if (stream.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/)) return "string";
    if (stream.match(/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return "number";
    if (stream.match(/[A-Za-z_][A-Za-z_0-9]*(?=\s*\()/)) return "function(variableName)";
    if (stream.match(/(?:TRUE|FALSE|BLANK)\b/i)) return "keyword";
    if (stream.match(/[+*/^%=!<>&|?-]+/)) return "operator";
    stream.next();
    return null;
  },
});

const inputClass =
  "h-8 min-w-0 rounded-md border border-border/70 bg-card px-2 text-sm outline-none focus:border-primary disabled:opacity-50";

export function FormulaFieldEditor({
  fields,
  slug,
  value,
  onChange,
  onValidityChange,
  records,
  isLoading = false,
  loadError,
  onRetry,
  disabled = false,
}: {
  fields: BaseFieldVO[];
  slug: string;
  value: FormulaFieldOptions;
  onChange: (value: FormulaFieldOptions) => void;
  onValidityChange: (valid: boolean) => void;
  records: RecordVO[];
  isLoading?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  disabled?: boolean;
}) {
  const messages = useCoreI18n();
  const copy = messages.formula;
  const locale = useCoreLocale();
  const resolveName = useIString();
  const editorId = useId();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const composing = useRef(false);
  const editable = useRef(new Compartment());
  const [catalogMode, setCatalogMode] = useState<"fields" | "functions">("fields");
  const [search, setSearch] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [sample, setSample] = useState<Record<string, unknown>>({});
  const [cursor, setCursor] = useState(value.expression.length);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [selectedFunction, setSelectedFunction] = useState<string | null>(null);
  const live = useRef({ value, onChange, disabled });
  live.current = { value, onChange, disabled };

  const validity = useMemo(() => {
    try {
      assertValidFormulaField("formula", slug || "__formula_draft__", { formula: value }, fields);
      return { valid: true, error: null };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, [fields, slug, value]);
  useEffect(() => onValidityChange(validity.valid), [onValidityChange, validity.valid]);

  const availableFields = fields.filter((field) => field.slug !== slug);
  const prefix = value.expression.slice(0, cursor);
  const fieldPrefix = prefix.match(/\{([^}]*)$/)?.[1];
  const functionPrefix = prefix.match(/([A-Za-z_][A-Za-z_0-9]*)$/)?.[1];
  const completions =
    fieldPrefix !== undefined
      ? availableFields
          .filter((field) =>
            `${resolveName(field.name)} ${field.slug}`
              .toLowerCase()
              .includes(fieldPrefix.toLowerCase()),
          )
          .slice(0, 6)
          .map((field) => ({
            label: resolveName(field.name),
            detail: field.slug,
            text: `{${field.slug}}`,
            from: cursor - fieldPrefix.length - 1,
            kind: "field",
          }))
      : functionPrefix || completionOpen
        ? FORMULA_CATALOG.filter((fn) => fn.name.startsWith((functionPrefix ?? "").toUpperCase()))
            .slice(0, 6)
            .map((fn) => ({
              label: fn.name,
              detail: fn.signature,
              text: `${fn.name}()`,
              from: cursor - (functionPrefix?.length ?? 0),
              kind: "function",
            }))
        : [];
  const completionState = useRef({ completions, completionIndex, completionOpen, cursor });
  completionState.current = { completions, completionIndex, completionOpen, cursor };
  const applyCompletion = useRef<(index: number) => void>(() => {});
  applyCompletion.current = (index) => {
    const state = completionState.current;
    const item = state.completions[index];
    const view = editor.current;
    if (!item || !view || live.current.disabled) return;
    const alreadyClosed =
      item.kind === "field" && view.state.doc.sliceString(state.cursor, state.cursor + 1) === "}";
    view.dispatch({
      changes: { from: item.from, to: state.cursor + (alreadyClosed ? 1 : 0), insert: item.text },
      selection: { anchor: item.from + item.text.length - (item.kind === "function" ? 1 : 0) },
    });
    view.focus();
    setCompletionOpen(false);
    if (item.kind === "function") setSelectedFunction(item.label);
  };

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: live.current.value.expression,
        extensions: [
          formulaLanguage,
          syntaxHighlighting(defaultHighlightStyle),
          bracketMatching(),
          history(),
          lineNumbers(),
          drawSelection(),
          placeholder("ROUND({price} * {quantity}, 2)"),
          EditorView.lineWrapping,
          EditorView.domEventHandlers({
            compositionstart: () => {
              composing.current = true;
              return false;
            },
            compositionend: () => {
              composing.current = false;
              return false;
            },
          }),
          editable.current.of([
            EditorState.readOnly.of(live.current.disabled),
            EditorView.editable.of(!live.current.disabled),
          ]),
          EditorView.contentAttributes.of({
            "aria-label": copy.expression,
            "aria-describedby": `${editorId}-validation`,
            "data-testid": "formula-expression",
          }),
          EditorView.theme({
            "&": { fontSize: "13px", backgroundColor: "var(--card)", color: "var(--foreground)" },
            ".cm-content": {
              minHeight: "112px",
              fontFamily: "var(--font-mono, monospace)",
              padding: "8px 0",
            },
            ".cm-scroller": { maxHeight: "256px", overflow: "auto" },
            ".cm-gutters": {
              backgroundColor: "var(--muted)",
              color: "var(--muted-foreground)",
              border: "none",
            },
            ".cm-cursor": { borderLeftColor: "var(--foreground)" },
            "&.cm-focused": { outline: "none" },
          }),
          keymap.of([
            {
              key: "Ctrl-Space",
              run: () => {
                if (composing.current) return false;
                setCompletionOpen(true);
                setCompletionIndex(0);
                return true;
              },
            },
            {
              key: "ArrowDown",
              run: () => {
                if (composing.current) return false;
                const state = completionState.current;
                if (!state.completionOpen || !state.completions.length) return false;
                setCompletionIndex((index) => (index + 1) % state.completions.length);
                return true;
              },
            },
            {
              key: "ArrowUp",
              run: () => {
                if (composing.current) return false;
                const state = completionState.current;
                if (!state.completionOpen || !state.completions.length) return false;
                setCompletionIndex(
                  (index) => (index - 1 + state.completions.length) % state.completions.length,
                );
                return true;
              },
            },
            {
              key: "Enter",
              run: () => {
                if (composing.current) return false;
                const state = completionState.current;
                if (!state.completionOpen || !state.completions.length) return false;
                applyCompletion.current(
                  Math.min(state.completionIndex, state.completions.length - 1),
                );
                return true;
              },
            },
            {
              key: "Escape",
              run: () => {
                if (composing.current) return false;
                if (!completionState.current.completionOpen) return false;
                setCompletionOpen(false);
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              live.current.onChange({
                ...live.current.value,
                expression: update.state.doc.toString(),
              });
              const before = update.state.doc.sliceString(0, update.state.selection.main.head);
              setCompletionOpen(/(?:\{[^}]*|[A-Za-z_][A-Za-z_0-9]*)$/.test(before));
              setCompletionIndex(0);
            }
            if (update.docChanged || update.selectionSet)
              setCursor(update.state.selection.main.head);
          }),
        ],
      }),
    });
    // Leave native IME candidate keys to the browser, including the first
    // composition key before CodeMirror marks the composition as active.
    // stopImmediatePropagation skips editor shortcuts without preventDefault,
    // which would also prevent the native candidate from being committed.
    const preserveCompositionKey = (event: KeyboardEvent) => {
      if (composing.current || event.isComposing || event.keyCode === 229) {
        event.stopImmediatePropagation();
      }
    };
    view.contentDOM.addEventListener("keydown", preserveCompositionKey, true);
    editor.current = view;
    return () => {
      view.contentDOM.removeEventListener("keydown", preserveCompositionKey, true);
      composing.current = false;
      editor.current = null;
      view.destroy();
    };
  }, [copy.expression, editorId]);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== value.expression)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value.expression } });
  }, [value.expression]);
  useEffect(() => {
    editor.current?.dispatch({
      effects: editable.current.reconfigure([
        EditorState.readOnly.of(disabled),
        EditorView.editable.of(!disabled),
      ]),
    });
  }, [disabled]);

  const insert = (text: string, functionName?: string) => {
    const view = editor.current;
    if (!view || disabled) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length - (functionName ? 1 : 0) },
    });
    view.focus();
    setCompletionOpen(false);
    if (functionName) setSelectedFunction(functionName);
  };
  const referencedSlugs = new Set<string>();
  const collectInputs = (expression: string) => {
    try {
      for (const ref of collectFieldRefs(parseFormula(expression))) {
        if (referencedSlugs.has(ref)) continue;
        referencedSlugs.add(ref);
        const field = fields.find((item) => item.slug === ref);
        if (field?.type === "formula") collectInputs(field.options.formula?.expression ?? "");
      }
    } catch {
      /* Invalid input is already shown above. */
    }
  };
  collectInputs(value.expression);
  const sampleFields = availableFields.filter(
    (field) => referencedSlugs.has(field.slug) && field.type !== "formula",
  );
  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? records[0];
  const result = validity.valid
    ? previewFormulaField({
        expression: value.expression,
        slug: slug || "__formula_draft__",
        fields,
        values: selectedRecord?.headCommit.payload ?? sample,
        recordId: selectedRecord?.id,
        createdAtIso: selectedRecord?.createdAt,
        updatedAtIso: selectedRecord?.updatedAt,
      })
    : null;
  const contextFunction = prefix.match(/([A-Za-z_][A-Za-z_0-9]*)\([^()]*$/)?.[1]?.toUpperCase();
  const help = FORMULA_CATALOG.find((fn) => fn.name === (contextFunction ?? selectedFunction));
  const dependencies = formulaDependentFields(fields, slug);
  const searchTerm = search.trim().toLowerCase();
  const filteredFields = availableFields.filter((field) =>
    `${resolveName(field.name)} ${field.slug}`.toLowerCase().includes(searchTerm),
  );
  const filteredFunctions = FORMULA_CATALOG.filter((fn) =>
    `${fn.name} ${fn.signature} ${fn.description}`.toLowerCase().includes(searchTerm),
  );

  return (
    <section
      className="mt-4 min-w-0 border-border/50 border-t pt-4"
      data-testid="formula-field-editor"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="font-medium text-sm" htmlFor={editorId}>
          {copy.expression}
        </label>
        <span className="text-muted-foreground text-xs">{copy.computed}</span>
      </div>
      <div
        className="min-w-0 rounded-md border border-border/70 focus-within:border-primary"
        id={editorId}
        ref={host}
      />
      {completionOpen && completions.length > 0 ? (
        <div
          aria-label={copy.suggestions}
          className="mt-1 max-h-32 overflow-auto rounded-md border border-border bg-popover p-1"
          role="listbox"
        >
          {completions.map((item, index) => (
            <button
              aria-selected={index === completionIndex}
              className={`flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left text-xs ${index === completionIndex ? "bg-accent" : "hover:bg-accent"}`}
              key={`${item.kind}:${item.label}`}
              onClick={() => applyCompletion.current(index)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              <span className="shrink-0 font-medium">{item.label}</span>
              <span className="truncate font-mono text-muted-foreground">{item.detail}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div
        aria-live="polite"
        className={`mt-2 flex items-start gap-1.5 break-words text-xs ${validity.error ? "text-rejected-strong" : "text-muted-foreground"}`}
        data-testid="formula-validation"
        id={`${editorId}-validation`}
        role={validity.error ? "alert" : "status"}
      >
        {validity.error ? (
          <AlertCircle className="mt-0.5 shrink-0" size={13} />
        ) : (
          <Check className="shrink-0" size={13} />
        )}
        <span>{validity.error ? `${copy.invalid}: ${validity.error}` : copy.valid}</span>
      </div>
      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div aria-label={copy.catalog} className="mb-2 flex items-center gap-1" role="tablist">
            <button
              aria-selected={catalogMode === "fields"}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${catalogMode === "fields" ? "bg-accent font-medium" : "text-muted-foreground"}`}
              onClick={() => setCatalogMode("fields")}
              role="tab"
              type="button"
            >
              <Columns3 size={12} />
              {messages.common.fields}
            </button>
            <button
              aria-selected={catalogMode === "functions"}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${catalogMode === "functions" ? "bg-accent font-medium" : "text-muted-foreground"}`}
              onClick={() => setCatalogMode("functions")}
              role="tab"
              type="button"
            >
              <Code2 size={12} />
              {copy.functions}
            </button>
          </div>
          <label className="relative mb-1 block">
            <Search className="absolute top-2 left-2 text-muted-foreground" size={13} />
            <input
              aria-label={copy.search}
              className={`${inputClass} w-full pl-7`}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy.search}
              value={search}
            />
          </label>
          <div className="h-28 overflow-y-auto" role="tabpanel">
            {catalogMode === "fields"
              ? filteredFields.map((field) => (
                  <button
                    className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
                    data-testid={`formula-insert-field-${field.slug}`}
                    disabled={disabled}
                    key={field.id}
                    onClick={() => insert(`{${field.slug}}`)}
                    title={`${resolveName(field.name)} {${field.slug}}`}
                    type="button"
                  >
                    <span className="min-w-0 flex-1 truncate">{resolveName(field.name)}</span>
                    <span className="max-w-28 truncate font-mono text-muted-foreground">
                      {field.slug}
                    </span>
                  </button>
                ))
              : filteredFunctions.map((fn) => (
                  <button
                    className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
                    disabled={disabled}
                    key={fn.name}
                    onClick={() => insert(`${fn.name}()`, fn.name)}
                    title={fn.signature}
                    type="button"
                  >
                    <span className="font-mono">{fn.name}</span>
                    <span className="min-w-0 truncate text-muted-foreground">{fn.signature}</span>
                  </button>
                ))}
          </div>
        </div>
        <div className="min-w-0 border-border/50 border-t pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3">
          <div className="mb-2 font-medium text-xs">{copy.preview}</div>
          {isLoading ? (
            <div className="text-muted-foreground text-xs">{messages.common.loading}</div>
          ) : loadError ? (
            <div className="text-rejected-strong text-xs" role="alert">
              {copy.previewUnavailable}
              <button className="ml-2 underline" onClick={onRetry} type="button">
                {copy.retry}
              </button>
            </div>
          ) : selectedRecord ? (
            <select
              aria-label={copy.sampleRecord}
              className={`${inputClass} mb-2 w-full`}
              data-testid="formula-sample-record"
              onChange={(event) => setSelectedRecordId(event.target.value)}
              value={selectedRecord.id}
            >
              {records.map((record, index) => (
                <option key={record.id} value={record.id}>
                  {getRecordTitle(record, messages) || fmt(copy.recordLabel, { index: index + 1 })}
                </option>
              ))}
            </select>
          ) : (
            <div className="mb-2 space-y-2">
              <div className="text-muted-foreground text-xs">{copy.temporaryValues}</div>
              {sampleFields.map((field) => (
                <label className="block text-xs" key={field.id}>
                  <span className="mb-1 block truncate">{resolveName(field.name)}</span>
                  <input
                    aria-label={`${copy.sampleValue}: ${resolveName(field.name)}`}
                    className={`${inputClass} w-full`}
                    onChange={(event) =>
                      setSample((current) => ({
                        ...current,
                        [field.slug]:
                          field.type === "number" && event.target.value !== ""
                            ? Number(event.target.value)
                            : field.type === "checkbox"
                              ? event.target.value === "true"
                              : event.target.value,
                      }))
                    }
                    type={field.type === "number" ? "number" : "text"}
                    value={String(sample[field.slug] ?? "")}
                  />
                </label>
              ))}
            </div>
          )}
          <output
            aria-label={copy.result}
            aria-live="polite"
            className={`block min-h-10 break-words rounded border border-border/50 bg-muted/20 p-2 font-mono text-sm ${result?.error ? "text-rejected-strong" : ""}`}
            data-testid="formula-preview-result"
          >
            {isLoading || loadError
              ? copy.unavailable
              : result?.error
                ? `${copy.computationError}: ${result.error}`
                : !validity.valid
                  ? copy.unavailable
                  : result?.value === null || result?.value === undefined || result?.value === ""
                    ? copy.empty
                    : formatFormulaValue(result.value, value, locale)}
          </output>
          {help ? (
            <div className="mt-2 break-words text-xs">
              <div className="font-mono font-medium">{help.signature}</div>
              <div className="mt-1 text-muted-foreground">{help.description}</div>
              <code className="mt-1 block break-all">{help.example}</code>
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3 border-border/50 border-t pt-3">
        <label className="min-w-32 flex-1 text-xs">
          <span className="mb-1 block text-muted-foreground">{messages.base.format}</span>
          <select
            aria-label={copy.resultFormat}
            className={`${inputClass} w-full`}
            data-testid="formula-format"
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, format: event.target.value as FormulaFieldOptions["format"] })
            }
            value={value.format ?? "auto"}
          >
            <option value="auto">{copy.auto}</option>
            <option value="number">{messages.base.plainNumber}</option>
            <option value="currency">{messages.base.currency}</option>
            <option value="percent">{copy.percent}</option>
            <option value="date">{messages.fieldTypes.date}</option>
          </select>
        </label>
        {["number", "currency", "percent"].includes(value.format ?? "") ? (
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">{copy.precision}</span>
            <input
              aria-label={copy.precision}
              className={`${inputClass} w-20`}
              data-testid="formula-precision"
              disabled={disabled}
              max={10}
              min={0}
              onChange={(event) =>
                onChange({
                  ...value,
                  precision: Math.min(10, Math.max(0, Number(event.target.value))),
                })
              }
              type="number"
              value={value.precision ?? 2}
            />
          </label>
        ) : null}
        {value.format === "currency" ? (
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">{messages.base.currency}</span>
            <select
              aria-label={copy.currencyCode}
              className={inputClass}
              data-testid="formula-currency"
              disabled={disabled}
              onChange={(event) => onChange({ ...value, currency: event.target.value })}
              value={value.currency ?? "USD"}
            >
              {["USD", "EUR", "GBP", "JPY", "CNY", "HKD", "AUD", "CAD", "SGD", "INR"].map(
                (currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ),
              )}
            </select>
          </label>
        ) : null}
      </div>
      {dependencies.length ? (
        <div className="mt-2 break-words text-muted-foreground text-xs">
          {fmt(copy.dependencies, {
            fields: dependencies.map((field) => resolveName(field.name)).join(", "),
          })}
        </div>
      ) : null}
    </section>
  );
}
