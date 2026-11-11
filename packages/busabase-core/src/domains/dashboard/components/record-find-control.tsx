import { getRecordFindFieldSupport } from "busabase-contract/domains/base/contract/record-find";
import type { BaseFieldVO } from "busabase-contract/types";
import { LoaderCircle, Search, X } from "lucide-react";
import { useId, useRef } from "react";
import { useCoreLocale, useIString } from "../../../i18n";
import { recordFindMessages } from "../../../i18n/record-find";
import { RECORD_FIND_QUERY_LIMIT } from "../helpers/record-find-url";
import type { RecordFindControl } from "../hooks/use-record-find";

export function RecordFind({
  control,
  fields,
  visibleSlugs,
}: {
  control: RecordFindControl;
  fields: BaseFieldVO[];
  visibleSlugs: string[];
}) {
  const messages = recordFindMessages[useCoreLocale()];
  const resolveIString = useIString();
  const hintId = useId();
  const fieldHintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const loading = control.isPending || control.isFetching;
  const missing = control.fieldId && !fields.some((field) => field.id === control.fieldId);
  const visible = new Set(visibleSlugs);
  const fieldsBySlug = new Map(fields.map((field) => [field.slug, field]));
  const orderedFields = [
    ...[...visible].flatMap((slug) => {
      const field = fieldsBySlug.get(slug);
      return field ? [field] : [];
    }),
    ...fields.filter((field) => !visible.has(field.slug)),
  ];
  return (
    <div
      aria-label={messages.label}
      className="@container/record-find ml-auto flex h-7 min-w-0 max-w-64 flex-1 items-center rounded-md border border-border/70 bg-card focus-within:ring-1 focus-within:ring-ring @min-[640px]/view-controls:w-64 @min-[640px]/view-controls:max-w-[60%] @min-[640px]/view-controls:flex-none [@media(pointer:coarse)]:h-11"
      data-testid="base-record-find"
      role="search"
    >
      <select
        aria-describedby={fieldHintId}
        aria-label={messages.field}
        className="h-full min-w-0 w-28 max-w-[46%] rounded-l-md border-border/60 border-r bg-transparent px-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring [@media(pointer:coarse)]:text-base"
        data-testid="base-record-find-field"
        onChange={(event) => control.setFieldId(event.currentTarget.value)}
        title={messages.hiddenHint}
        value={control.fieldId}
      >
        <option value="">{messages.common}</option>
        {missing ? <option value={control.fieldId}>{messages.removed}</option> : null}
        {orderedFields.map((field) => {
          const support = getRecordFindFieldSupport(field);
          const reason = support.reason ? messages[support.reason] : "";
          const hidden = !visible.has(field.slug) ? ` (${messages.hidden})` : "";
          return (
            <option disabled={!support.supported} key={field.id} value={field.id}>
              {resolveIString(field.name)}
              {hidden}
              {reason ? ` — ${reason}` : ""}
            </option>
          );
        })}
      </select>
      <span className="sr-only" id={fieldHintId}>
        {messages.hiddenHint}
      </span>
      {loading ? (
        <LoaderCircle
          aria-hidden
          className="ml-2 hidden size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none @min-[160px]/record-find:block"
        />
      ) : (
        <Search
          aria-hidden
          className="ml-2 hidden size-3 shrink-0 text-muted-foreground @min-[160px]/record-find:block"
        />
      )}
      <input
        aria-describedby={hintId}
        aria-label={messages.label}
        className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground [@media(pointer:coarse)]:text-base [&::-webkit-search-cancel-button]:appearance-none"
        data-testid="base-record-find-input"
        maxLength={RECORD_FIND_QUERY_LIMIT}
        onChange={(event) => control.setQuery(event.currentTarget.value)}
        onCompositionEnd={(event) => control.endComposition(event.currentTarget.value)}
        onCompositionStart={control.startComposition}
        placeholder={messages.placeholder}
        ref={inputRef}
        type="search"
        value={control.query}
      />
      {control.query ? (
        <button
          aria-label={messages.clear}
          className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [@media(pointer:coarse)]:mr-0"
          data-testid="base-record-find-clear"
          onClick={() => {
            control.clear();
            inputRef.current?.focus();
          }}
          type="button"
        >
          <X aria-hidden size={12} />
        </button>
      ) : null}
      <span aria-live="polite" className="sr-only" id={hintId}>
        {loading ? messages.searching : ""}
      </span>
    </div>
  );
}
