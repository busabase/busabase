"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BaseFieldVO } from "busabase-contract/types";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { Search, UserRoundX, X } from "lucide-react";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { getAppUserId } from "../../base/field-types";
import { formatFullTime, formatRelativeTime } from "../helpers/format";
import {
  type AppUserFieldHost,
  AppUserFieldHostContext,
  type AppUserFieldUser,
} from "./app-user-field-slot";

/**
 * The `appUser` field type's read display, details popover and editor.
 *
 * The cell stores one app user id. Who that is comes from the host
 * (`AppUserFieldHostProvider`): every visible cell asks for its id, and a
 * small loader folds all asks of one tick into ONE `resolve` call per Base, so
 * a grid of 50 rows costs one request, not 50. An id the host does not return
 * is a deleted app user (ids are never reused). Without a host — the
 * open-source app — the raw id is all there is, and it is shown as such.
 */

const RESOLVE_BATCH = 100;

interface Waiter {
  resolve: (user: AppUserFieldUser | null) => void;
  reject: (error: unknown) => void;
}

interface AppUserLoader {
  load: (baseId: string, id: string) => Promise<AppUserFieldUser | null>;
}

const createAppUserLoader = (host: AppUserFieldHost): AppUserLoader => {
  const pending = new Map<string, Map<string, Waiter[]>>();

  const flush = async (baseId: string) => {
    const waiters = pending.get(baseId);
    pending.delete(baseId);
    if (!waiters) return;
    const ids = [...waiters.keys()];
    for (let start = 0; start < ids.length; start += RESOLVE_BATCH) {
      const chunk = ids.slice(start, start + RESOLVE_BATCH);
      try {
        const users = await host.resolve(baseId, chunk);
        const byId = new Map(users.map((user) => [user.id, user]));
        for (const id of chunk) {
          for (const waiter of waiters.get(id) ?? []) waiter.resolve(byId.get(id) ?? null);
        }
      } catch (error) {
        for (const id of chunk) {
          for (const waiter of waiters.get(id) ?? []) waiter.reject(error);
        }
      }
    }
  };

  return {
    load: (baseId, id) =>
      new Promise((resolve, reject) => {
        let waiters = pending.get(baseId);
        if (!waiters) {
          waiters = new Map();
          pending.set(baseId, waiters);
          // Every cell of one render asks inside the same tick; answer them together.
          setTimeout(() => {
            void flush(baseId);
          }, 0);
        }
        waiters.set(id, [...(waiters.get(id) ?? []), { resolve, reject }]);
      }),
  };
};

const loaders = new WeakMap<AppUserFieldHost, AppUserLoader>();
const loaderFor = (host: AppUserFieldHost): AppUserLoader => {
  let loader = loaders.get(host);
  if (!loader) {
    loader = createAppUserLoader(host);
    loaders.set(host, loader);
  }
  return loader;
};

const appUserQueryKey = (host: AppUserFieldHost | null, baseId: string, id: string | null) =>
  ["busabase", "app-user-field", host?.scope ?? "", baseId, id ?? ""] as const;

/** Who the id in one cell is: `data` null = deleted; undefined while loading. */
export function useAppUserFieldUser(baseId: string, id: string | null) {
  const host = useContext(AppUserFieldHostContext);
  const query = useQuery({
    enabled: Boolean(host && id),
    queryFn: () => (host && id ? loaderFor(host).load(baseId, id) : Promise.resolve(null)),
    queryKey: appUserQueryKey(host, baseId, id),
    retry: false,
    staleTime: 60_000,
  });
  return { host, ...query };
}

const chipClassName =
  "inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2 text-xs";

/** The raw id, for a host without app users (or one that could not answer). */
function RawAppUserId({ id, title }: { id: string; title?: string }) {
  return (
    <span
      className="min-w-0 max-w-full truncate font-mono text-muted-foreground text-xs"
      data-app-user-id={id}
      data-app-user-state="raw"
      title={title ? `${id} — ${title}` : id}
    >
      {id}
    </span>
  );
}

/**
 * One app user, as a chip: the email (dimmed with a "Disabled" mark for a
 * disabled user), "Deleted app user" for an id that no longer resolves, the raw
 * id without a host. A resolved chip opens the details popover.
 */
export function AppUserFieldValue({
  className = "",
  field,
  value,
}: {
  className?: string;
  field: Pick<BaseFieldVO, "baseId">;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const id = getAppUserId(value);
  const { host, data, isError, isPending } = useAppUserFieldUser(field.baseId, id);

  if (!id) {
    return <span className="text-muted-foreground">-</span>;
  }
  if (!host) {
    return <RawAppUserId id={id} title={messages.appUserField.cloudOnly} />;
  }
  if (isError) {
    return <RawAppUserId id={id} title={messages.appUserField.loadFailed} />;
  }
  if (isPending) {
    return (
      <span
        aria-busy="true"
        className={`${chipClassName} border-border/60 text-muted-foreground ${className}`}
        data-app-user-id={id}
        data-app-user-state="loading"
      >
        <span className="truncate font-mono">{id}</span>
      </span>
    );
  }
  if (!data) {
    return (
      <span
        className={`inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-md bg-muted/60 px-2 text-muted-foreground text-xs ${className}`}
        data-app-user-id={id}
        data-app-user-state="deleted"
        title={messages.appUserField.deleted}
      >
        <UserRoundX aria-hidden className="size-3.5 shrink-0 opacity-70" />
        <span className="truncate">{messages.appUserField.deleted}</span>
      </span>
    );
  }
  return <AppUserChip className={className} host={host} user={data} />;
}

function AppUserChip({
  className,
  host,
  user,
}: {
  className: string;
  host: AppUserFieldHost;
  user: AppUserFieldUser;
}) {
  const messages = useCoreI18n();
  const [open, setOpen] = useState(false);
  const disabled = user.status === "disabled";
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={`${messages.appUserField.details}: ${user.email}`}
          className={`${chipClassName} bg-card transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            disabled ? "text-muted-foreground" : "text-foreground"
          } ${className}`}
          data-app-user-id={user.id}
          data-app-user-state={disabled ? "disabled" : "active"}
          // Inside a grid cell / record link: show the person, don't open the row.
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          title={disabled ? `${user.email} · ${messages.appUserField.disabled}` : user.email}
          type="button"
        >
          <span className="truncate">{user.email}</span>
          {disabled ? (
            <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground no-underline">
              {messages.appUserField.disabled}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-3"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <AppUserDetails
          onManage={(appId) => {
            setOpen(false);
            host.openManage(appId ? { appId } : undefined);
          }}
          user={user}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Email, status, last sign-in, apps, and the way to Space settings → App users. */
export function AppUserDetails({
  onManage,
  user,
}: {
  onManage: (appId?: string) => void;
  user: AppUserFieldUser;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const copy = messages.appUserField;
  return (
    <div className="grid gap-2 text-sm" data-app-user-details={user.id}>
      <div className="min-w-0">
        <div className="truncate font-medium" title={user.email}>
          {user.email}
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">{user.id}</div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{copy.status}</dt>
        <dd className={user.status === "disabled" ? "text-destructive" : "text-foreground"}>
          {user.status === "disabled" ? copy.disabled : copy.active}
        </dd>
        <dt className="text-muted-foreground">{copy.lastSignIn}</dt>
        <dd title={user.lastSignInAt ? formatFullTime(user.lastSignInAt, locale) : undefined}>
          {user.lastSignInAt ? formatRelativeTime(user.lastSignInAt, locale) : copy.neverSignedIn}
        </dd>
        <dt className="text-muted-foreground">{copy.apps}</dt>
        <dd className="flex min-w-0 flex-wrap gap-1">
          {user.apps.length === 0 ? (
            <span className="text-muted-foreground">{copy.noApps}</span>
          ) : (
            user.apps.map((app) => (
              <button
                className="max-w-full truncate rounded bg-muted px-1.5 text-foreground hover:bg-accent"
                key={app.id}
                onClick={() => onManage(app.id)}
                title={app.name}
                type="button"
              >
                {app.name}
              </button>
            ))
          )}
        </dd>
      </dl>
      <button
        className="justify-self-start text-primary text-xs underline-offset-2 hover:underline"
        data-app-user-manage
        onClick={() => onManage()}
        type="button"
      >
        {copy.manage}
      </button>
    </div>
  );
}

/** Wait this long after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The record form's control for an `appUser` field.
 *
 * With a host: the current person (or nothing), "Clear", and a search over
 * the space's app users by email. Listing the pool is a space-admin power, so
 * anyone else gets keep-or-clear and a sentence saying why. Without a host:
 * a plain input for the id, which is what the cell stores.
 */
export function AppUserFieldEditor({
  ariaDescribedBy,
  focusOnMount = false,
  field,
  fieldName,
  inputId,
  onChange,
  value,
}: {
  ariaDescribedBy?: string;
  focusOnMount?: boolean;
  field: Pick<BaseFieldVO, "baseId">;
  fieldName: string;
  inputId: string;
  onChange: (value: string | null) => void;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const copy = messages.appUserField;
  const host = useContext(AppUserFieldHostContext);
  const queryClient = useQueryClient();
  const focusInput = useCallback(
    (input: HTMLInputElement | null) => {
      if (focusOnMount) input?.focus();
    },
    [focusOnMount],
  );
  const id = getAppUserId(value);
  const editorRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const search = useQuery({
    enabled: Boolean(host),
    queryFn: () => (host ? host.search(debounced) : Promise.resolve({ users: [], canPick: false })),
    queryKey: ["busabase", "app-user-field-search", host?.scope ?? "", debounced],
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!focusOnMount || !host || search.isPending) return;
    if (!search.isError && search.data?.canPick) return;
    // The grid suppresses the popover's default focus so the search can take
    // it. Keep-or-clear and failure states have no search input to do that.
    const editor = editorRef.current;
    const clear = id ? editor?.querySelector<HTMLButtonElement>("[data-app-user-clear]") : null;
    (clear ?? editor)?.focus();
  }, [focusOnMount, host, id, search.data?.canPick, search.isError, search.isPending]);

  if (!host) {
    return (
      <input
        aria-describedby={ariaDescribedBy}
        aria-label={fieldName}
        className="h-9 w-full rounded-md border border-border/70 bg-card px-2.5 py-1.5 font-mono text-sm outline-none transition-colors focus:border-primary"
        id={inputId}
        ref={focusInput}
        onChange={(event) => onChange(event.target.value)}
        placeholder={copy.idPlaceholder}
        title={copy.cloudOnly}
        value={typeof value === "string" ? value : ""}
      />
    );
  }

  // The last query's options must not remain selectable during debounce or a
  // refresh: a fast Enter in the grid would assign that query's first person.
  const searching = query.trim() !== debounced || search.isFetching;
  const choose = (user: AppUserFieldUser) => {
    if (searching || search.isError || !search.data?.canPick) return;
    // The picker already knows who this is — show it at once, no extra lookup.
    queryClient.setQueryData(appUserQueryKey(host, field.baseId, user.id), user);
    onChange(user.id);
    setQuery("");
  };
  const canPick = search.data?.canPick ?? false;
  const users = searching ? [] : (search.data?.users ?? []);

  return (
    <div
      className="grid min-w-0 gap-2"
      data-app-user-editor
      ref={editorRef}
      tabIndex={focusOnMount ? -1 : undefined}
    >
      <div className="flex min-h-9 min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <AppUserFieldValue field={field} value={id} />
        </div>
        {id ? (
          <button
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 text-muted-foreground text-xs hover:bg-accent hover:text-foreground"
            data-app-user-clear
            onClick={() => onChange(null)}
            type="button"
          >
            <X aria-hidden className="size-3" />
            {copy.clear}
          </button>
        ) : null}
      </div>
      {search.isPending ? null : search.isError ? (
        <p className="text-destructive text-xs" role="alert">
          {copy.loadFailed}
        </p>
      ) : !canPick ? (
        <p className="text-muted-foreground text-xs" data-app-user-cannot-pick>
          {copy.cannotPick}
        </p>
      ) : (
        <div className="grid min-w-0 gap-1">
          <label className="relative block">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              aria-describedby={ariaDescribedBy}
              aria-label={`${fieldName}: ${copy.search}`}
              className="h-9 w-full rounded-md border border-border/70 bg-card py-1.5 pr-2.5 pl-8 text-sm outline-none transition-colors focus:border-primary"
              id={inputId}
              ref={focusInput}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.search}
              type="search"
              value={query}
            />
          </label>
          <div
            aria-busy={searching}
            className="max-h-56 overflow-y-auto rounded-md border border-border/60"
            role="listbox"
          >
            {searching ? (
              <div className="px-2.5 py-2 text-muted-foreground text-xs" role="status">
                {messages.common.loading}
              </div>
            ) : users.length === 0 ? (
              <div className="px-2.5 py-2 text-muted-foreground text-xs">
                {debounced ? copy.noMatches : copy.noUsers}
              </div>
            ) : (
              users.map((user) => (
                <button
                  aria-label={fmt(copy.choose, { email: user.email })}
                  aria-selected={user.id === id}
                  className={`flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent ${
                    user.id === id ? "bg-primary/10" : ""
                  }`}
                  data-app-user-option={user.id}
                  key={user.id}
                  onClick={() => choose(user)}
                  role="option"
                  type="button"
                >
                  <span
                    className={`min-w-0 flex-1 truncate ${user.status === "disabled" ? "text-muted-foreground" : ""}`}
                  >
                    {user.email}
                  </span>
                  {user.status === "disabled" ? (
                    <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                      {copy.disabled}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
