"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, UserRefVO } from "busabase-contract/types";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { getMemberIds } from "../../base/field-types";
import { formatMemberChipLabel, formatUserRefLabel } from "../helpers/format";
import { UserAvatar } from "./identity";

/**
 * The `member` field type's read display and its picker.
 *
 * Two independent sources answer "who is this id", and both are needed:
 *
 * - `RecordVO.fieldUsers` — resolved by the server for the people a RECORD
 *   names. It is the only source available on a public/Embed surface, where the
 *   host deliberately withholds the roster, and it is the only source that can
 *   name a FORMER member (they are no longer on the roster, but their id is
 *   still in the cell and "who did this work" must survive them leaving).
 * - `spaces.members` — the roster. Needed wherever a value exists without a
 *   record behind it: the picker's options, and a Change Request diff proposing
 *   a value for a record that may not exist yet.
 *
 * Neither is authoritative alone, so `memberUserMap` merges them, and every
 * unresolved id still renders as a labelled chip rather than as an empty cell.
 */

export const SPACE_MEMBERS_QUERY_KEY = ["busabase", "space-members"] as const;
// Hosts can share a QueryClient across spaces. The API method is recreated with
// its scoped transport, so its lifetime safely scopes this otherwise inputless call.
const rosterScopes = new WeakMap<BusabaseDashboardApiClient["listSpaceMembers"], string>();
let nextRosterScope = 0;
const rosterScope = (load: BusabaseDashboardApiClient["listSpaceMembers"]) => {
  let scope = rosterScopes.get(load);
  if (!scope) {
    // This is a cache namespace, not a credential. OSS also runs on LAN HTTP,
    // where Web Crypto's secure-context randomUUID method may be unavailable.
    scope =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++nextRosterScope}`;
    rosterScopes.set(load, scope);
  }
  return scope;
};

/**
 * The space's member roster. `enabled` is the caller's business (do not fetch it
 * for a Base with no member field).
 *
 * `retry: false` for the same reason the `@`-mention picker's agent-catalog
 * query uses it: an anonymous or Embed visitor is denied this procedure by
 * design (it is absent from the default-deny anonymous allowlist), and that
 * denial means "no roster", not an error worth retrying or showing.
 */
export function useSpaceMemberRoster(
  client: Pick<BusabaseDashboardApiClient, "listSpaceMembers">,
  options?: { enabled?: boolean },
) {
  return useQuery({
    enabled: options?.enabled ?? true,
    queryFn: () => client.listSpaceMembers(),
    queryKey: [...SPACE_MEMBERS_QUERY_KEY, rosterScope(client.listSpaceMembers)],
    retry: false,
    staleTime: 60_000,
  });
}

/** Whichever of the two carries a usable display name; `a` breaks a tie. */
const preferNamed = (a?: UserRefVO, b?: UserRefVO): UserRefVO | undefined => {
  if (a?.name?.trim()) return a;
  if (b?.name?.trim()) return b;
  return a ?? b;
};

/**
 * Merge the record-scoped resolution with the roster into one id → person map.
 * See the module doc for why both are needed.
 */
export const memberUserMap = (
  fieldUsers?: Record<string, UserRefVO>,
  roster?: readonly UserRefVO[],
): Record<string, UserRefVO> => {
  const merged: Record<string, UserRefVO> = {};
  for (const user of roster ?? []) {
    merged[user.id] = user;
  }
  for (const [id, user] of Object.entries(fieldUsers ?? {})) {
    const best = preferNamed(user, merged[id]);
    if (best) merged[id] = best;
  }
  return merged;
};

export function MemberChips({
  className = "",
  users,
  value,
}: {
  className?: string;
  users?: Record<string, UserRefVO>;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const ids = getMemberIds(value);
  if (ids.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}>
      {ids.map((id) => {
        const user = users?.[id];
        const label = formatMemberChipLabel(user, id, messages);
        return (
          <span
            className="inline-flex max-w-64 items-center gap-1.5 truncate rounded-full border bg-card py-0.5 pr-2 pl-0.5 text-xs"
            data-member-id={id}
            key={id}
            title={user?.email ? `${label} · ${user.email}` : label}
          >
            <UserAvatar className="size-5" fallbackId={id} user={user} />
            <span className="truncate">{label}</span>
          </span>
        );
      })}
    </div>
  );
}

/** A draft-only member picker. Search and roster failures never replace its controlled value. */
export function MemberFieldEditor({
  ariaDescribedBy,
  client,
  field,
  fieldName,
  inputId,
  onChange,
  users,
  value,
}: {
  ariaDescribedBy?: string;
  client: Pick<BusabaseDashboardApiClient, "listSpaceMembers">;
  field: BaseFieldVO;
  fieldName: string;
  inputId: string;
  onChange: (value: unknown) => void;
  /** The record's own resolution, so an already-set former member keeps its name. */
  users?: Record<string, UserRefVO>;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const rosterQuery = useSpaceMemberRoster(client);
  const selectedIds = getMemberIds(value);
  const isMulti = field.options.multiple !== false;
  const error = rosterQuery.error as { code?: string; status?: number } | null;
  const denied =
    error?.code === "FORBIDDEN" ||
    error?.code === "UNAUTHORIZED" ||
    error?.status === 403 ||
    error?.status === 401;
  // A failed refresh must not offer stale permissions as assignment candidates.
  const roster = rosterQuery.isError ? undefined : rosterQuery.data;
  const resolved = useMemo(
    () => memberUserMap(users, denied ? undefined : rosterQuery.data),
    [denied, rosterQuery.data, users],
  );
  const orderedRoster = useMemo(
    () =>
      [...(roster ?? [])].sort((a, b) => {
        const aName = a.name?.trim() || a.email || a.id;
        const bName = b.name?.trim() || b.email || b.id;
        return aName.localeCompare(bName) || a.id.localeCompare(b.id);
      }),
    [roster],
  );
  const search = query.trim().toLocaleLowerCase();
  const candidates = orderedRoster.filter(
    (user) =>
      !search || `${user.name ?? ""} ${user.email ?? ""}`.toLocaleLowerCase().includes(search),
  );
  const choices = [...(!isMulti ? [null] : []), ...candidates];
  const activeId = choices.length
    ? `${inputId}-option-${Math.min(activeIndex, choices.length - 1)}`
    : undefined;
  const update = (id: string | null) => {
    if (isMulti && id) {
      onChange(
        selectedIds.includes(id)
          ? selectedIds.filter((selected) => selected !== id)
          : [...selectedIds, id],
      );
    } else if (!isMulti) {
      onChange(id ?? "");
    }
    if (!isMulti) setOpen(false);
  };
  const navigate = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter can finish a Chinese/Japanese/Korean input composition; it must
    // not also assign the currently active person.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      // Enter belongs to the picker, never the surrounding record form.
      event.preventDefault();
      if (!rosterQuery.isError && !rosterQuery.isPending && choices.length)
        update(choices[Math.min(activeIndex, choices.length - 1)]?.id ?? null);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        Math.max(0, Math.min(choices.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))),
      );
    }
  };
  useEffect(() => {
    if (open && activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, open]);
  const visibleSelected = expanded ? selectedIds : selectedIds.slice(0, 4);

  return (
    <div
      className="min-w-0 rounded-md border border-border/70 bg-card p-1.5"
      data-member-field-editor={field.slug}
    >
      {visibleSelected.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {visibleSelected.map((id) => {
            const user = resolved[id];
            const label =
              user?.name?.trim() ||
              user?.email?.trim() ||
              formatMemberChipLabel(user, id, messages);
            const former = rosterQuery.isSuccess && !roster?.some((member) => member.id === id);
            return (
              <span
                className="inline-flex w-fit min-w-0 max-w-full items-center gap-1.5 rounded-full border bg-background py-0.5 pr-1 pl-0.5 text-xs"
                data-member-id={id}
                key={id}
                title={[label, user?.email, former ? messages.base.formerMember : null]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <UserAvatar className="size-5" fallbackId={id} user={user} />
                <span className="min-w-0 flex-1 truncate">
                  {label}
                  {former ? (
                    <span className="ml-1 text-muted-foreground">
                      ({messages.base.formerMember})
                    </span>
                  ) : null}
                </span>
                <button
                  aria-label={fmt(messages.base.removeMember, { name: label })}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-primary"
                  onClick={() => {
                    onChange(isMulti ? selectedIds.filter((selected) => selected !== id) : "");
                    document.getElementById(inputId)?.focus();
                  }}
                  type="button"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        {selectedIds.length > 4 ? (
          <button
            aria-expanded={expanded}
            className="rounded px-2 py-1 text-muted-foreground text-xs hover:bg-accent focus-visible:outline-primary"
            onClick={() => setExpanded(!expanded)}
            type="button"
          >
            {expanded
              ? messages.base.collapseMembers
              : fmt(messages.base.moreMembers, { count: selectedIds.length - 4 })}
          </button>
        ) : null}
        <Popover
          onOpenChange={(next) => {
            setOpen(next);
            if (next) {
              setQuery("");
              setActiveIndex(0);
            }
          }}
          open={open}
        >
          <PopoverTrigger asChild>
            <button
              aria-describedby={ariaDescribedBy}
              aria-label={fieldName}
              className="inline-flex min-h-7 items-center gap-1.5 rounded px-2 text-muted-foreground text-sm hover:bg-accent focus-visible:outline-primary"
              id={inputId}
              type="button"
            >
              <Plus aria-hidden className="size-4" />
              {selectedIds.length ? messages.base.addMember : messages.base.selectMembers}
              <ChevronDown aria-hidden className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            aria-label={fieldName}
            className="flex max-h-[var(--radix-popover-content-available-height)] w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
            collisionPadding={16}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              searchInput.current?.focus();
            }}
          >
            <div className="flex shrink-0 items-center gap-2 border-b px-3">
              <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <input
                aria-activedescendant={
                  rosterQuery.isError || rosterQuery.isPending ? undefined : activeId
                }
                aria-autocomplete="list"
                aria-describedby={ariaDescribedBy}
                aria-controls={`${inputId}-listbox`}
                aria-expanded="true"
                aria-label={`${messages.base.searchMembers} — ${fieldName}`}
                className="h-10 w-full min-w-0 bg-transparent text-sm outline-none"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={navigate}
                placeholder={messages.base.searchMembers}
                ref={searchInput}
                role="combobox"
                type="search"
                value={query}
              />
            </div>
            {rosterQuery.isError ? (
              <div className="p-3 text-muted-foreground text-sm" role="alert">
                {denied ? messages.base.membersAccessDenied : messages.base.membersLoadFailed}
                {!denied ? (
                  <button
                    className="ml-2 rounded px-1 underline focus-visible:outline-primary"
                    onClick={() => void rosterQuery.refetch()}
                    type="button"
                  >
                    {messages.base.paginationRetry}
                  </button>
                ) : null}
              </div>
            ) : rosterQuery.isPending ? (
              <div className="p-3 text-muted-foreground text-sm" role="status">
                {messages.common.loading}
              </div>
            ) : null}
            <div
              aria-busy={rosterQuery.isFetching}
              aria-label={fieldName}
              aria-multiselectable={isMulti}
              className="min-h-0 max-h-72 overflow-y-auto p-1"
              id={`${inputId}-listbox`}
              ref={list}
              role="listbox"
            >
              {!rosterQuery.isError && !rosterQuery.isPending
                ? choices.map((user, index) => {
                    const label = user
                      ? formatUserRefLabel(user, user.id, messages)
                      : messages.base.unassignedMember;
                    const checked = user ? selectedIds.includes(user.id) : selectedIds.length === 0;
                    return (
                      <div
                        aria-label={
                          user?.email && user.email !== label ? `${label} · ${user.email}` : label
                        }
                        aria-selected={checked}
                        className={`flex min-h-12 cursor-pointer items-center gap-2.5 rounded px-2.5 py-2 text-sm ${index === Math.min(activeIndex, choices.length - 1) ? "bg-accent" : "hover:bg-accent/60"}`}
                        id={`${inputId}-option-${index}`}
                        key={user?.id ?? "unassigned"}
                        onClick={() => {
                          setActiveIndex(index);
                          update(user?.id ?? null);
                          searchInput.current?.focus();
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                        role="option"
                        tabIndex={-1}
                      >
                        {user ? (
                          <UserAvatar className="size-8" fallbackId={user.id} user={user} />
                        ) : (
                          <span aria-hidden className="size-8" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium" title={label}>
                            {label}
                          </span>
                          {user?.email && user.email !== label ? (
                            <span
                              className="block truncate text-muted-foreground text-xs"
                              title={user.email}
                            >
                              {user.email}
                            </span>
                          ) : null}
                        </span>
                        <span
                          aria-hidden
                          className={`grid size-4 shrink-0 place-items-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                        >
                          {checked ? <Check className="size-3" /> : null}
                        </span>
                      </div>
                    );
                  })
                : null}
            </div>
            {!rosterQuery.isError && !rosterQuery.isPending && candidates.length === 0 ? (
              <div className="px-3 py-4 text-center text-muted-foreground text-sm" role="status">
                {search ? messages.search.noMatchesTitle : messages.base.noMembersAvailable}
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
