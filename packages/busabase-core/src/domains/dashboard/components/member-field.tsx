"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, UserRefVO } from "busabase-contract/types";
import { useEffect, useMemo, useState } from "react";
import { useCoreI18n } from "../../../i18n";
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
    queryKey: SPACE_MEMBERS_QUERY_KEY,
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

/**
 * The `member` field's editor: a filterable `<select>` over the roster.
 *
 * Deliberately the same control shape as `RelationFieldEditor` (search input +
 * native multi/single select) rather than a bespoke popover — it is the shape
 * this package's record editor already uses for "pick ids from a list", it is
 * keyboard- and screen-reader-accessible for free, and the e2e specs can drive
 * it.
 */
export function MemberFieldEditor({
  client,
  field,
  fieldName,
  inputId,
  onChange,
  users,
  value,
}: {
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
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const rosterQuery = useSpaceMemberRoster(client);
  const selectedIds = getMemberIds(value);
  const isMulti = field.options.multiple !== false;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const resolved = useMemo(() => memberUserMap(users, rosterQuery.data), [rosterQuery.data, users]);

  const options = useMemo(() => {
    const roster = rosterQuery.data ?? [];
    // A currently-selected person must stay in the list even when they fall
    // outside the search or have left the space — otherwise picking anyone else
    // silently drops them from the control's value.
    const selected = selectedIds.map(
      (id) => resolved[id] ?? { id, name: null, email: null, image: null, role: null },
    );
    const seen = new Set(selected.map((user) => user.id));
    const rest = roster.filter((user) => {
      if (seen.has(user.id)) return false;
      if (!debouncedQuery) return true;
      const haystack = `${user.name ?? ""} ${user.email ?? ""} ${user.id}`.toLowerCase();
      return haystack.includes(debouncedQuery);
    });
    return [...selected, ...rest];
  }, [debouncedQuery, resolved, rosterQuery.data, selectedIds]);

  const hasNoOptions = !rosterQuery.isFetching && options.length === 0;

  return (
    <div className="grid gap-1.5">
      <input
        aria-label={`${messages.base.searchMembers} — ${fieldName}`}
        className="h-9 w-full rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
        onChange={(event) => setQuery(event.target.value)}
        placeholder={messages.base.searchMembers}
        type="search"
        value={query}
      />
      <select
        aria-label={fieldName}
        className="min-h-9 w-full rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
        data-member-field-editor={field.slug}
        id={inputId}
        multiple={isMulti}
        onChange={(event) => {
          const picked = Array.from(event.currentTarget.selectedOptions).map(
            (option) => option.value,
          );
          // React needs a scalar for a single-select and an array for a
          // multi-select; handing an array to a single-select leaves the control
          // unbound and shows no current value (the bug `relation` hit).
          onChange(isMulti ? picked : (picked[0] ?? ""));
        }}
        value={isMulti ? selectedIds : (selectedIds[0] ?? "")}
      >
        {isMulti ? null : <option value="">{messages.base.unassignedMember}</option>}
        {options.map((user) => (
          <option key={user.id} value={user.id}>
            {formatUserRefLabel(user, user.id, messages)}
            {user.email ? ` · ${user.email}` : ""}
          </option>
        ))}
      </select>
      {rosterQuery.isFetching ? (
        <span className="text-muted-foreground text-[11px]">{messages.common.loading}</span>
      ) : hasNoOptions ? (
        // Says which of the two it is. "No members" and "the roster call was
        // refused" look identical otherwise, and the user can act on neither.
        <span className="text-muted-foreground text-[11px]">
          {messages.base.noMembersAvailable}
        </span>
      ) : debouncedQuery && options.length === selectedIds.length ? (
        <span className="text-muted-foreground text-[11px]">{messages.search.noMatchesTitle}</span>
      ) : null}
    </div>
  );
}
