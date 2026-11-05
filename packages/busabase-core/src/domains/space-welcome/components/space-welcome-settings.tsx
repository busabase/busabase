"use client";

import { hashKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  SPACE_WELCOME_NODE_TYPES,
  type SpaceWelcomeVO,
} from "busabase-contract/domains/space-welcome/types";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { useEffect, useId, useMemo, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import type { CoreI18nMessages } from "../../../i18n/messages";
import { NodeAvatar } from "../../dashboard/helpers/node-icons";

interface Props {
  orpc: BusabaseQueryUtils;
  spaceId: string;
  /** A tunnel stays keyed by its id while the self-hosted server returns "local". */
  responseSpaceId?: string;
  canManage: boolean;
}

const isConflict = (error: unknown) =>
  error !== null && typeof error === "object" && "code" in error && error.code === "CONFLICT";

/** A new workspace starts a separate picker, including selection and request state. */
export function SpaceWelcomeSettings(props: Props) {
  const scope = hashKey([
    props.spaceId,
    props.responseSpaceId ?? props.spaceId,
    props.canManage,
    props.orpc.spaceWelcome.get.queryOptions({}).queryKey,
  ]);
  return <SpaceWelcomePicker key={scope} {...props} />;
}

/**
 * Settings → Welcome page: which Doc or HTML node Home opens with.
 *
 * Mirrors the space-instructions editor's rules: managers choose, everyone
 * else sees the current choice read-only, and a stale version is a CONFLICT to
 * reload rather than something to overwrite. The current node's name is read
 * through `nodes.get`, so a member who cannot open that page is told it is not
 * visible to them instead of being shown its name.
 */
function SpaceWelcomePicker({ orpc, spaceId, responseSpaceId = spaceId, canManage }: Props) {
  const messages = useCoreI18n();
  const labels = messages.spaceWelcome;
  const queryClient = useQueryClient();
  const titleId = useId();
  const searchId = useId();
  const groupName = useId();
  const queryOptions = orpc.spaceWelcome.get.queryOptions({ staleTime: 0, retry: false });
  const query = useQuery(queryOptions);
  const saved: SpaceWelcomeVO | null =
    query.data && query.data.spaceId === responseSpaceId ? query.data : null;
  const savedNodeId = saved?.nodeId ?? null;

  const currentQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: savedNodeId ?? "" } }),
    enabled: Boolean(savedNodeId),
    retry: false,
  });
  const current =
    savedNodeId && !currentQuery.isError && currentQuery.data?.node.id === savedNodeId
      ? currentQuery.data.node
      : null;

  const candidatesQuery = useQuery({
    ...orpc.nodes.list.queryOptions({ input: { types: [...SPACE_WELCOME_NODE_TYPES] } }),
    enabled: canManage,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const update = useMutation(orpc.spaceWelcome.update.mutationOptions());

  // Follow the server's choice until the manager picks something else.
  useEffect(() => {
    setSelected((previous) => previous ?? savedNodeId);
  }, [savedNodeId]);

  const candidates = candidatesQuery.data ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter(
      (node) =>
        node.name.toLowerCase().includes(needle) || node.slug.toLowerCase().includes(needle),
    );
  }, [candidates, search]);

  const conflict = isConflict(update.error);
  const busy = update.isPending;
  const dirty = selected !== null && selected !== savedNodeId;

  const save = async (nodeId: string | null) => {
    if (!canManage || !saved) return;
    setSavedNotice(false);
    try {
      await queryClient.cancelQueries({ queryKey: queryOptions.queryKey });
      const result = await update.mutateAsync({ nodeId, expectedVersion: saved.version });
      queryClient.setQueryData(queryOptions.queryKey, result);
      // Home may read the welcome through another query client prefix (Cloud's
      // dashboard and its settings use different ones); refresh every copy.
      void queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          Array.isArray(queryKey[0]) && (queryKey[0] as unknown[]).includes("spaceWelcome"),
      });
      setSelected(result.nodeId);
      setSavedNotice(true);
    } catch {
      // Rendered below from the mutation's error; the selection stays for a retry.
    }
  };

  const reload = async () => {
    const result = await query.refetch();
    if (!result.isError) {
      update.reset();
      setSavedNotice(false);
      setSelected(result.data?.nodeId ?? null);
    }
  };

  // Same lookup as the New dialog: one translated name per registered node type.
  const typeName = (type: string): string =>
    messages.nodeDetail[type as keyof CoreI18nMessages["createNode"]["typeHints"]] ?? type;

  return (
    <section aria-labelledby={titleId} className="space-y-4" data-space-welcome-settings="">
      <div className="space-y-1">
        <h3 className="font-medium text-base" id={titleId}>
          {labels.title}
        </h3>
        <p className="text-muted-foreground text-sm">{labels.description}</p>
      </div>

      {query.isPending ? <p role="status">{labels.loading}</p> : null}
      {query.isError ? (
        <div className="space-y-2" role="alert">
          <p className="text-destructive text-sm">{labels.loadFailed}</p>
          <Button
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            type="button"
            variant="outline"
          >
            {labels.retry}
          </Button>
        </div>
      ) : null}

      {saved ? (
        <>
          <div className="space-y-1">
            <p className="font-medium text-muted-foreground text-xs">{labels.current}</p>
            {!savedNodeId ? (
              <p className="text-muted-foreground text-sm">{labels.none}</p>
            ) : current ? (
              <p className="flex min-w-0 items-center gap-2 text-sm" data-space-welcome-current="">
                <span
                  aria-hidden="true"
                  className="flex size-4 shrink-0 items-center justify-center overflow-hidden text-muted-foreground"
                >
                  <NodeAvatar node={current} />
                </span>
                <span className="min-w-0 truncate font-medium">{current.name}</span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {typeName(current.type)}
                </span>
              </p>
            ) : currentQuery.isPending ? (
              <p className="text-muted-foreground text-sm">{labels.loading}</p>
            ) : (
              <p className="text-muted-foreground text-sm">{labels.unreadable}</p>
            )}
            <p className="text-muted-foreground text-xs">{labels.visibilityHint}</p>
          </div>

          {canManage ? (
            <div className="space-y-2">
              <Label htmlFor={searchId}>{labels.searchLabel}</Label>
              <Input
                disabled={busy}
                id={searchId}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={labels.searchPlaceholder}
                type="search"
                value={search}
              />
              {candidatesQuery.isPending ? (
                <p className="text-muted-foreground text-sm">{labels.loading}</p>
              ) : candidates.length === 0 ? (
                <p className="text-muted-foreground text-sm">{labels.noCandidates}</p>
              ) : filtered.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {fmt(labels.noMatches, { query: search.trim() })}
                </p>
              ) : (
                <div
                  aria-label={labels.searchLabel}
                  className="max-h-64 divide-y divide-border/60 overflow-auto rounded-md border border-border"
                  role="radiogroup"
                >
                  {filtered.map((node) => (
                    <label
                      className="flex min-w-0 cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-accent/25 has-[:checked]:bg-accent/40"
                      key={node.id}
                    >
                      <input
                        checked={selected === node.id}
                        className="accent-primary"
                        disabled={busy}
                        name={groupName}
                        onChange={() => {
                          setSelected(node.id);
                          setSavedNotice(false);
                          update.reset();
                        }}
                        type="radio"
                        value={node.id}
                      />
                      <span
                        aria-hidden="true"
                        className="flex size-4 shrink-0 items-center justify-center overflow-hidden text-muted-foreground"
                      >
                        <NodeAvatar node={node} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{node.name}</span>
                      <span className="shrink-0 text-muted-foreground text-xs">
                        {typeName(node.type)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  disabled={!dirty || busy || conflict}
                  onClick={() => void save(selected)}
                  type="button"
                >
                  {busy ? labels.saving : labels.save}
                </Button>
                {savedNodeId ? (
                  <Button
                    disabled={busy || conflict}
                    onClick={() => void save(null)}
                    type="button"
                    variant="ghost"
                  >
                    {labels.clear}
                  </Button>
                ) : null}
                {savedNotice ? (
                  <span className="text-muted-foreground text-sm" role="status">
                    {labels.saved}
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{labels.readOnly}</p>
          )}

          {update.isError ? (
            <div className="space-y-2" role="alert">
              <p className="text-destructive text-sm">
                {conflict ? labels.conflict : labels.saveFailed}
              </p>
              {conflict ? (
                <Button
                  disabled={query.isFetching}
                  onClick={() => void reload()}
                  type="button"
                  variant="outline"
                >
                  {labels.reload}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
