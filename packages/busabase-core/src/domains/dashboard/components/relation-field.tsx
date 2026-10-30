import { useQuery } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { getPrimaryField } from "../../base/utils/primary-field";
import { getRecordTitle } from "../helpers/change-request";
import { useLinkedRecords } from "../hooks/use-linked-records";

// Client instances are scoped to their host/workspace, unlike bare Base IDs.
const clientScopes = new WeakMap<BusabaseDashboardApiClient, number>();
let nextClientScope = 0;
function clientScope(client: BusabaseDashboardApiClient) {
  let scope = clientScopes.get(client);
  if (scope === undefined) {
    scope = ++nextClientScope;
    clientScopes.set(client, scope);
  }
  return scope;
}

export function RelationFieldEditor({
  ariaDescribedBy,
  client,
  field,
  inputId,
  fieldName,
  loadedRecords,
  onChange,
  value,
}: {
  ariaDescribedBy?: string;
  client: BusabaseDashboardApiClient;
  field: BaseFieldVO;
  inputId: string;
  fieldName: string;
  loadedRecords: RecordVO[];
  onChange: (value: unknown) => void;
  value: string[];
}) {
  const messages = useCoreI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const knownRecords = useRef(new Map<string, RecordVO>());
  const targetBaseId = field.options.targetBaseId;
  const scope = clientScope(client);
  const previousScope = useRef(`${scope}:${targetBaseId}`);
  if (previousScope.current !== `${scope}:${targetBaseId}`) {
    knownRecords.current.clear();
    previousScope.current = `${scope}:${targetBaseId}`;
  }
  for (const record of loadedRecords) knownRecords.current.set(record.id, record);

  useEffect(() => {
    if (query.trim() === search) return;
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, search]);
  useEffect(() => {
    if (!open) return;
    searchInput.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  // Only the target Base, for its title field. This used to load every Base in
  // the space each time a relation picker opened. The key stays under
  // "relation-bases" so the dashboard's refresh still invalidates it.
  const targetBaseQuery = useQuery({
    enabled: open && Boolean(targetBaseId),
    queryFn: () => client.getBase(targetBaseId as string),
    queryKey: ["busabase", "relation-bases", scope, targetBaseId],
    staleTime: 60_000,
  });
  const targetBase = targetBaseQuery.data;
  const primarySlug = getPrimaryField(targetBase)?.slug;
  const optionsQuery = useQuery({
    enabled: open && Boolean(targetBase) && (!search || Boolean(primarySlug)),
    queryFn: () =>
      client.listRecordsPage({
        baseId: targetBaseId as string,
        page,
        pageSize: 50,
        ...(search && primarySlug
          ? {
              filters: [
                {
                  fieldSlug: primarySlug,
                  fieldType: "text",
                  operator: "contains" as const,
                  value: search,
                },
              ],
            }
          : {}),
      }),
    queryKey: [
      "busabase",
      "relation-options",
      scope,
      targetBaseId,
      primarySlug ?? "",
      search,
      page,
    ],
  });
  for (const record of optionsQuery.data?.records ?? [])
    knownRecords.current.set(record.id, record);
  // Selected links not already on screen resolve in one batched read. A link
  // that stays unresolved (hidden, removed, or the read failed) keeps its id
  // and renders as unavailable rather than being dropped from the value.
  const selected = useLinkedRecords({
    client,
    ids: value.filter((id) => !knownRecords.current.has(id)),
  });
  for (const record of selected.records) knownRecords.current.set(record.id, record);
  const multiple = field.options.multiple !== false;
  const update = (id: string) => {
    if (value.includes(id)) onChange(multiple ? value.filter((item) => item !== id) : "");
    else onChange(multiple ? [...value, id] : id);
    if (!multiple) {
      setOpen(false);
      trigger.current?.focus();
    }
  };
  const failed = optionsQuery.isError || targetBaseQuery.isError;
  const pendingSearch = query.trim() !== search;

  return (
    <div className="relative min-w-0" ref={root}>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border/70 bg-card p-1.5">
        {value.map((id) => {
          const record = knownRecords.current.get(id);
          const title = record
            ? getRecordTitle(record, messages)
            : selected.isPending
              ? messages.common.loading
              : messages.base.relationUnavailable;
          return (
            <span
              className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-2 py-1 text-sm"
              key={id}
            >
              <span className="truncate" title={title}>
                {title}
              </span>
              <button
                aria-label={fmt(messages.base.removeRelation, { name: title })}
                className="shrink-0 rounded p-0.5 hover:bg-accent focus-visible:outline-primary"
                onClick={() => onChange(multiple ? value.filter((item) => item !== id) : "")}
                title={fmt(messages.base.removeRelation, { name: title })}
                type="button"
              >
                <X className="size-3.5" />
              </button>
            </span>
          );
        })}
        <button
          aria-controls={`${inputId}-picker`}
          aria-expanded={open}
          aria-label={fieldName}
          aria-describedby={ariaDescribedBy}
          className="inline-flex min-h-7 items-center gap-1 rounded px-2 text-muted-foreground text-sm hover:bg-accent focus-visible:outline-primary disabled:opacity-50"
          disabled={!targetBaseId}
          id={inputId}
          onClick={() => setOpen(!open)}
          ref={trigger}
          title={messages.base.addRelation}
          type="button"
        >
          <Plus className="size-4" />
          {value.length === 0 ? messages.base.addRelation : null}
        </button>
      </div>
      {open ? (
        <div
          aria-label={fieldName}
          role="group"
          className="absolute top-full z-40 mt-1 w-full min-w-0 rounded-md border border-border bg-popover p-2 shadow-md"
          id={`${inputId}-picker`}
        >
          <input
            aria-label={`${messages.base.searchRecordsToLink} - ${fieldName}`}
            ref={searchInput}
            className="h-9 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none focus:border-primary"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={messages.base.searchRecordsToLink}
            type="search"
            value={query}
          />
          <div
            aria-busy={optionsQuery.isFetching || pendingSearch}
            className="mt-1 max-h-60 overflow-y-auto"
          >
            {failed ? (
              <div className="p-2 text-sm" role="alert">
                {messages.base.relationLoadFailed}
                <button
                  className="ml-2 underline"
                  onClick={() => {
                    void targetBaseQuery.refetch();
                    void optionsQuery.refetch();
                  }}
                  type="button"
                >
                  {messages.base.paginationRetry}
                </button>
              </div>
            ) : optionsQuery.isPending || pendingSearch ? (
              <div className="p-2 text-muted-foreground text-sm" role="status">
                {messages.common.loading}
              </div>
            ) : optionsQuery.data?.records.length === 0 ? (
              <div className="p-2 text-muted-foreground text-sm" role="status">
                {messages.search.noMatchesTitle}
              </div>
            ) : (
              optionsQuery.data?.records.map((record) => (
                <label
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-accent"
                  key={record.id}
                >
                  <input
                    checked={value.includes(record.id)}
                    onChange={() => update(record.id)}
                    type={multiple ? "checkbox" : "radio"}
                    name={inputId}
                  />
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={getRecordTitle(record, messages)}
                  >
                    {getRecordTitle(record, messages)}
                  </span>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {record.id.slice(-6)}
                  </span>
                </label>
              ))
            )}
          </div>
          {(optionsQuery.data?.totalPages ?? 0) > 1 ? (
            <nav
              aria-label={messages.base.paginationLabel}
              className="mt-1 flex items-center justify-between border-border border-t pt-2 text-xs"
            >
              <button
                aria-label={messages.base.paginationPreviousPage}
                disabled={page === 1 || optionsQuery.isFetching || pendingSearch}
                onClick={() => setPage(page - 1)}
                title={messages.base.paginationPreviousPage}
                type="button"
                className="rounded p-1 hover:bg-accent disabled:opacity-40"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span>
                {page} / {optionsQuery.data?.totalPages}
              </span>
              <button
                aria-label={messages.base.paginationNextPage}
                disabled={
                  page >= (optionsQuery.data?.totalPages ?? 1) ||
                  optionsQuery.isFetching ||
                  pendingSearch
                }
                onClick={() => setPage(page + 1)}
                title={messages.base.paginationNextPage}
                type="button"
                className="rounded p-1 hover:bg-accent disabled:opacity-40"
              >
                <ChevronRight className="size-4" />
              </button>
            </nav>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
