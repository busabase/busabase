"use client";

import { hashKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  SPACE_INSTRUCTIONS_MAX_BYTES,
  type SpaceInstructionsVO,
} from "busabase-contract/domains/space-instructions/types";
import { Button } from "kui/button";
import { Label } from "kui/label";
import { Textarea } from "kui/textarea";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";

interface Props {
  orpc: BusabaseQueryUtils;
  spaceId: string;
  /** A tunnel stays keyed by its id while the self-hosted server returns "local". */
  responseSpaceId?: string;
  canManage: boolean;
}

interface Draft {
  saved: SpaceInstructionsVO;
  body: string;
}

/** A new workspace starts a separate editor, including draft and request state. */
export function SpaceInstructionsSettings(props: Props) {
  const scope = hashKey([
    props.spaceId,
    props.responseSpaceId ?? props.spaceId,
    props.canManage,
    props.orpc.spaceInstructions.get.queryOptions({}).queryKey,
  ]);
  return <SpaceInstructionsEditor key={scope} {...props} />;
}

function SpaceInstructionsEditor({ orpc, spaceId, responseSpaceId = spaceId, canManage }: Props) {
  const labels = useCoreI18n().spaceInstructions;
  const queryClient = useQueryClient();
  const editorId = useId();
  const descriptionId = useId();
  const queryOptions = orpc.spaceInstructions.get.queryOptions({ staleTime: 0 });
  const query = useQuery(queryOptions);
  const update = useMutation(orpc.spaceInstructions.update.mutationOptions());
  const queryScope = hashKey(queryOptions.queryKey);
  const draftQueryKey = useMemo(
    () => ["space-instructions-draft", spaceId, responseSpaceId, queryScope],
    [spaceId, responseSpaceId, queryScope],
  );
  const [draft, setDraft] = useState<Draft | null>(() => {
    // Keep unsaved text only in this session's query cache, never on disk.
    // A member who cannot manage the workspace always sees canonical content.
    const cached = canManage ? queryClient.getQueryData<Draft>(draftQueryKey) : null;
    return cached?.saved.spaceId === responseSpaceId ? cached : null;
  });
  const [saved, setSaved] = useState(false);
  const [reloading, setReloading] = useState(false);
  const rememberDraft = useCallback(
    (next: Draft | null) => {
      if (!canManage) return;
      if (next && next.body !== next.saved.body) {
        queryClient.setQueryDefaults(draftQueryKey, { gcTime: Number.POSITIVE_INFINITY });
        queryClient.setQueryData(draftQueryKey, next);
      } else {
        queryClient.removeQueries({ queryKey: draftQueryKey, exact: true });
      }
    },
    [canManage, queryClient, draftQueryKey],
  );

  // Background refetches may update a clean editor, but never replace unsaved work.
  // A slow response from before a save must also not roll its version backwards.
  useEffect(() => {
    const current = query.data;
    if (!current || current.spaceId !== responseSpaceId) return;
    setDraft((previous) => {
      if (
        previous &&
        (previous.body !== previous.saved.body || current.version < previous.saved.version)
      ) {
        return previous;
      }
      if (previous?.saved === current) return previous;
      return { saved: current, body: current.body };
    });
  }, [query.data, responseSpaceId]);

  const dirty = draft !== null && draft.body !== draft.saved.body;
  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  const setBody = (body: string) => {
    if (!canManage || !draft) return;
    const next = { ...draft, body };
    // Write immediately so closing the dialog in the next action cannot lose it.
    rememberDraft(next);
    setDraft(next);
    setSaved(false);
    update.reset();
  };

  const save = async () => {
    if (!canManage || !draft) return;
    const cacheEntry = queryClient
      .getQueryCache()
      .find({ queryKey: queryOptions.queryKey, exact: true });
    setSaved(false);
    try {
      await queryClient.cancelQueries({ queryKey: queryOptions.queryKey });
      const result = await update.mutateAsync({
        body: draft.body,
        expectedVersion: draft.saved.version,
      });
      // Logout may clear the cache while a write is in flight. Its late reply
      // must not put private data back into the cleared session.
      if (
        queryClient.getQueryCache().find({ queryKey: queryOptions.queryKey, exact: true }) !==
        cacheEntry
      )
        return;
      const current = queryClient.getQueryData<SpaceInstructionsVO>(queryOptions.queryKey);
      if (!current || current.version <= result.version) {
        queryClient.setQueryData(queryOptions.queryKey, result);
      }
      const cachedDraft = queryClient.getQueryData<Draft>(draftQueryKey);
      if (cachedDraft?.body === draft.body && cachedDraft.saved.version === draft.saved.version) {
        queryClient.removeQueries({ queryKey: draftQueryKey, exact: true });
      }
      setDraft({ saved: result, body: result.body });
      setSaved(true);
    } catch {
      // The mutation's error is rendered below; keep the exact draft for retry.
    }
  };

  const reload = async () => {
    setReloading(true);
    try {
      const result = await query.refetch();
      if (!result.isError && result.data?.spaceId === responseSpaceId) {
        rememberDraft(null);
        setDraft({ saved: result.data, body: result.data.body });
        update.reset();
        setSaved(false);
      }
    } finally {
      setReloading(false);
    }
  };

  const conflict =
    update.error !== null &&
    typeof update.error === "object" &&
    "code" in update.error &&
    update.error.code === "CONFLICT";
  const tooLong =
    draft !== null &&
    new TextEncoder().encode(draft.body).byteLength > SPACE_INSTRUCTIONS_MAX_BYTES;
  const busy = update.isPending || reloading;

  return (
    <section aria-labelledby={`${editorId}-title`} className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-medium text-base" id={`${editorId}-title`}>
          {labels.title}
        </h3>
        <p className="text-muted-foreground text-sm" id={descriptionId}>
          {labels.description}
        </p>
      </div>

      {draft === null && query.isPending ? <p role="status">{labels.loading}</p> : null}
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

      {draft !== null ? (
        <>
          <div className="space-y-2">
            <Label htmlFor={editorId}>{labels.editorLabel}</Label>
            <Textarea
              aria-describedby={descriptionId}
              className="min-h-64 resize-y font-mono text-sm leading-relaxed"
              disabled={busy}
              id={editorId}
              onChange={(event) => setBody(event.target.value)}
              placeholder={labels.placeholder}
              readOnly={!canManage}
              rows={12}
              value={draft.body}
            />
            <p className="text-muted-foreground text-xs">{labels.behavior}</p>
            {!draft.body.trim() ? (
              <p className="text-muted-foreground text-sm">{labels.empty}</p>
            ) : null}
          </div>

          {!canManage ? <p className="text-muted-foreground text-sm">{labels.readOnly}</p> : null}
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={!dirty || busy || tooLong || conflict}
                onClick={() => void save()}
                type="button"
              >
                {update.isPending ? labels.saving : labels.save}
              </Button>
              {!draft.body.trim() ? (
                <Button
                  disabled={busy}
                  onClick={() => setBody(labels.example)}
                  type="button"
                  variant="outline"
                >
                  {labels.insertExample}
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => setBody("")} type="button" variant="ghost">
                  {labels.clear}
                </Button>
              )}
              {dirty ? (
                <span className="text-muted-foreground text-sm">{labels.unsaved}</span>
              ) : null}
              {saved ? (
                <span className="text-muted-foreground text-sm" role="status">
                  {labels.saved}
                </span>
              ) : null}
            </div>
          ) : null}
          {tooLong ? (
            <p className="text-destructive text-sm" role="alert">
              {fmt(labels.tooLong, { limit: String(SPACE_INSTRUCTIONS_MAX_BYTES / 1024) })}
            </p>
          ) : null}
          {update.isError ? (
            <div className="space-y-2" role="alert">
              <p className="text-destructive text-sm">
                {conflict ? labels.conflict : labels.saveFailed}
              </p>
              {conflict ? (
                <Button
                  disabled={busy}
                  onClick={() => void reload()}
                  type="button"
                  variant="outline"
                >
                  {reloading ? labels.loading : labels.reload}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
