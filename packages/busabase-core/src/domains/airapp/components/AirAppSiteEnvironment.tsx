"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  type AirAppSiteDirectValueInput,
  type AirAppSiteEnvironmentBinding,
  type AirAppSiteEnvironmentVO,
  type AirAppSiteStateVO,
  airAppSiteDirectValueInputSchema,
  airAppSiteEnvironmentNameSchema,
  airAppSiteSaveEnvironmentInputSchema,
} from "busabase-contract/domains/airapp/contract";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import {
  readSiteAccessDenial,
  type SiteAccessDenial,
  siteAccessMessage,
  siteDeploymentDenial,
} from "../utils/site-access";
import { AirAppSiteConfigurationList } from "./AirAppSiteConfigurationList";
import { AirAppSiteDirectValues, type DirectValueDraft } from "./AirAppSiteDirectValues";

type Props = {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  state: AirAppSiteStateVO;
  enabled?: boolean;
};

type DraftBinding = AirAppSiteEnvironmentBinding & { rowId: string };
type EnvironmentDraft = { bindings: DraftBinding[]; directValues?: DirectValueDraft[] };

const bindingInputs = (rows: readonly AirAppSiteEnvironmentBinding[]) =>
  rows.map(({ envName, vaultItemId }) => ({ envName, vaultItemId }));

/** Older clients and hosts can still render their existing Site settings. */
export function AirAppSiteEnvironment(props: Props) {
  if (!props.orpc.airapps.siteEnvironment) return null;
  return <SiteEnvironmentEditor key={props.nodeId} {...props} />;
}

function SiteEnvironmentEditor({ orpc, nodeId, state, enabled = true }: Props) {
  const copy = useCoreI18n().airapp.site.environment;
  const id = useId();
  const nextRowId = useRef(0);
  const queryClient = useQueryClient();
  const queryOptions = orpc.airapps.siteEnvironment.queryOptions({ input: { nodeId } });
  const query = useQuery({
    ...queryOptions,
    enabled,
    staleTime: 0,
    retry: false,
  });
  const data = query.data;
  const [draft, setDraft] = useState<EnvironmentDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [accessDenied, setAccessDenied] = useState<SiteAccessDenial | null>(null);
  const queryDenied = readSiteAccessDenial(query.error);
  const rows =
    draft?.bindings ??
    data?.bindings.map((binding, index) => ({ ...binding, rowId: `stored-${index}` })) ??
    [];
  const directSupported = data?.directValues !== undefined;
  const directRows: DirectValueDraft[] =
    draft?.directValues ??
    data?.directValues?.map((value) => ({ ...value, rowId: `direct-${value.vaultItemId}` })) ??
    [];
  const unboundRows = (data?.unboundDirectValues ?? []).filter(
    (value) => !directRows.some((row) => row.vaultItemId === value.vaultItemId),
  );
  const directInputs = (values: readonly DirectValueDraft[]): AirAppSiteDirectValueInput[] =>
    values.map(({ vaultItemId, envName, kind, value }) => ({
      ...(vaultItemId ? { vaultItemId } : {}),
      envName,
      kind,
      ...(value !== undefined ? { value } : {}),
    }));
  const inputs = {
    nodeId,
    bindings: bindingInputs(rows),
    ...(directSupported ? { directValues: directInputs(directRows) } : {}),
  };
  const dirty =
    JSON.stringify(inputs.bindings) !== JSON.stringify(bindingInputs(data?.bindings ?? [])) ||
    (directSupported &&
      JSON.stringify(inputs.directValues) !==
        JSON.stringify(
          directInputs(
            data?.directValues?.map((value) => ({ ...value, rowId: value.vaultItemId })) ?? [],
          ),
        ));
  const validNames = airAppSiteSaveEnvironmentInputSchema.safeParse(inputs).success;
  const namedRows = rows.filter((row) => row.envName !== "");
  const allNames = [...rows, ...directRows].map((row) => row.envName.trim()).filter(Boolean);
  const invalidDirect = directRows.some(
    (row) =>
      row.envName &&
      !airAppSiteDirectValueInputSchema.safeParse({
        envName: row.envName,
        kind: row.kind,
        value: row.value ?? "",
      }).success,
  );
  const invalidNames =
    invalidDirect ||
    namedRows.some((row) => !airAppSiteEnvironmentNameSchema.safeParse(row.envName).success) ||
    new Set(allNames).size !== allNames.length;
  const validSources =
    rows.every((row) => data?.sources.some((source) => source.id === row.vaultItemId)) &&
    directRows.every((row) => {
      const status =
        data?.directValues?.find((item) => item.vaultItemId === row.vaultItemId)?.status ??
        data?.unboundDirectValues?.find((item) => item.vaultItemId === row.vaultItemId)?.status ??
        row.status;
      return !row.vaultItemId
        ? row.value !== undefined
        : status !== "runtime-disabled" && (status !== "missing" || row.value !== undefined);
    });
  const count = rows.length + directRows.length;
  const mutationKey = ["site-environment-save", nodeId, id];

  const save = useMutation({
    mutationKey,
    gcTime: 0,
    mutationFn: (input: typeof inputs) => orpc.airapps.siteSaveEnvironment.call(input),
    onMutate: () => setSaveError(false),
    onError: (error) => {
      setSaveError(true);
      setAccessDenied(readSiteAccessDenial(error));
    },
    onSuccess: async (next: AirAppSiteEnvironmentVO) => {
      queryClient.setQueryData(queryOptions.queryKey, next);
      setDraft(null);
      setSaved(true);
      // Another tab may still be editing its Vault. Send only an invalidation
      // hint; the receiver rechecks its own permissions and reference metadata.
      if (typeof BroadcastChannel !== "undefined") {
        let channel: BroadcastChannel | undefined;
        try {
          channel = new BroadcastChannel("busabase-site-environment");
          channel.postMessage({ type: "site-environment-saved", nodeId });
        } catch {
          // Cross-tab messaging must never turn a confirmed save into a failure.
        } finally {
          channel?.close();
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.airapps.siteState.queryOptions({ input: { nodeId } }).queryKey,
        }),
        ...(orpc.airapps.siteReleases
          ? [
              queryClient.invalidateQueries({
                queryKey: orpc.airapps.siteReleases.queryOptions({ input: { nodeId } }).queryKey,
              }),
            ]
          : []),
      ]);
    },
    onSettled: () => {
      save.reset();
      for (const mutation of queryClient.getMutationCache().findAll({ mutationKey }))
        queryClient.getMutationCache().remove(mutation);
    },
  });

  useEffect(() => {
    if (!enabled) return;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        await Promise.all([
          query.refetch(),
          queryClient.invalidateQueries({
            queryKey: orpc.airapps.siteState.queryOptions({ input: { nodeId } }).queryKey,
          }),
        ]);
      } finally {
        refreshing = false;
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    let channel: BroadcastChannel | undefined;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel("busabase-vault");
        channel.onmessage = (event: MessageEvent<unknown>) => {
          const value = event.data as {
            type?: unknown;
            scopeType?: unknown;
            scopeId?: unknown;
          } | null;
          if (
            value?.type === "vault-saved" &&
            (value.scopeType === "workspace" || value.scopeType === "api_key") &&
            typeof value.scopeId === "string" &&
            value.scopeId.length > 0 &&
            value.scopeId.length <= 256
          )
            void refresh();
        };
      }
    } catch {
      /* Focus and visibility remain available when messaging is blocked. */
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      channel?.close();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled, query.refetch, queryClient, orpc, nodeId]);

  const editEnvironment = (next: EnvironmentDraft) => {
    setDraft(next);
    setSaved(false);
    setSaveError(false);
  };
  const edit = (next: DraftBinding[]) =>
    editEnvironment({ bindings: next, ...(directSupported ? { directValues: directRows } : {}) });
  const editDirect = (next: DirectValueDraft[]) =>
    editEnvironment({ bindings: rows, directValues: next });
  const vaultLink = (href: string | undefined, label: string) =>
    href ? (
      <a
        className="text-xs text-primary underline underline-offset-2"
        href={href}
        rel="noopener noreferrer"
        target="_blank"
      >
        {label} ↗
      </a>
    ) : null;

  if (!enabled || (!query.isError && data?.available === false)) return null;

  return (
    <section
      className="min-w-0 space-y-3 border-border border-t pt-3"
      data-airapp-site-environment=""
    >
      <div className="space-y-1">
        <h4 className="font-medium text-sm">{copy.title}</h4>
        <p className="text-muted-foreground text-xs">{copy.description}</p>
        {siteDeploymentDenial(state) ? (
          <p
            className="text-muted-foreground text-xs"
            data-airapp-site-access-denied=""
            role="status"
          >
            {copy.manageRequired}
          </p>
        ) : null}
      </div>
      {query.isPending ? (
        <p className="text-muted-foreground text-xs" role="status">
          {copy.loading}
        </p>
      ) : query.isError && !data ? (
        <div className="space-y-2">
          <p className="text-destructive text-xs" role="alert">
            {queryDenied ? siteAccessMessage(copy, queryDenied) : copy.loadFailed}
          </p>
          {!queryDenied ? (
            <Button onClick={() => void query.refetch()} size="sm" type="button" variant="outline">
              {copy.retry}
            </Button>
          ) : null}
        </div>
      ) : data?.available ? (
        <form
          className="min-w-0 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              dirty &&
              validNames &&
              validSources &&
              !save.isPending &&
              !accessDenied &&
              !queryDenied
            )
              save.mutate(inputs);
          }}
        >
          {query.isError ? (
            <p className="text-destructive text-xs" role="alert">
              {queryDenied ? siteAccessMessage(copy, queryDenied) : copy.loadFailed}
            </p>
          ) : null}
          <fieldset
            className="min-w-0 space-y-3"
            disabled={save.isPending || Boolean(accessDenied) || Boolean(queryDenied)}
          >
            {unboundRows.length > 0 ? (
              <section
                className="min-w-0 space-y-2 rounded-md border border-border p-2"
                data-airapp-site-unbound=""
              >
                <h5 className="font-medium text-xs">{copy.unboundTitle}</h5>
                <p className="text-muted-foreground text-xs">{copy.unboundDescription}</p>
                {unboundRows.map((item) => {
                  const canAdopt =
                    item.status === "ready" &&
                    count < 100 &&
                    airAppSiteDirectValueInputSchema.safeParse({
                      vaultItemId: item.vaultItemId,
                      envName: item.envName,
                      kind: item.kind,
                    }).success &&
                    !allNames.includes(item.envName);
                  return (
                    <div
                      className="flex min-w-0 flex-wrap items-center justify-between gap-2"
                      data-airapp-site-unbound-row=""
                      key={item.vaultItemId}
                    >
                      <span className="min-w-0 break-all font-mono text-xs">
                        {item.envName} · {item.kind === "secret" ? copy.secret : copy.variable}
                      </span>
                      <Button
                        data-airapp-site-unbound-adopt=""
                        disabled={!canAdopt}
                        onClick={() =>
                          editDirect([
                            ...directRows,
                            { ...item, savedKind: item.kind, rowId: `direct-${item.vaultItemId}` },
                          ])
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {copy.adoptExisting}
                      </Button>
                      {!canAdopt ? (
                        <p className="w-full text-destructive text-xs">
                          {item.status === "runtime-disabled"
                            ? copy.directRuntimeDisabled
                            : count >= 100
                              ? copy.limit
                              : copy.directInvalid}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            ) : null}
            {rows.length === 0 ? (
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">{copy.empty}</p>
                {vaultLink(data.vaultLinks?.space, copy.openVault)}
              </div>
            ) : null}
            {directSupported ? (
              <AirAppSiteDirectValues
                rows={directRows}
                stored={data.directValues ?? []}
                unbound={data.unboundDirectValues}
                id={id}
                onChange={editDirect}
              />
            ) : null}
            {rows.map((row) => {
              const source = data.sources.find((item) => item.id === row.vaultItemId);
              const previous = data.bindings.find((item) => item.vaultItemId === row.vaultItemId);
              const sourceError =
                row.vaultItemId && !source
                  ? previous?.status === "runtime-disabled"
                    ? copy.runtimeDisabled
                    : copy.missing
                  : null;
              const selectedKind = source?.kind ?? previous?.kind;
              const rowId = `${id}-${row.rowId}`;
              return (
                <div
                  className="min-w-0 space-y-2 rounded-md border border-border p-2"
                  data-airapp-site-environment-row=""
                  key={row.rowId}
                >
                  <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                    <div className="min-w-0 space-y-1">
                      <Label className="text-xs" htmlFor={`${rowId}-name`}>
                        {copy.name}
                      </Label>
                      <Input
                        autoComplete="off"
                        className="min-w-0 font-mono text-xs"
                        data-airapp-site-environment-name=""
                        id={`${rowId}-name`}
                        maxLength={128}
                        onChange={(event) =>
                          edit(
                            rows.map((item) =>
                              item.rowId === row.rowId
                                ? { ...item, envName: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="API_TOKEN"
                        spellCheck={false}
                        value={row.envName}
                      />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-1.5">
                        <Label className="text-xs" htmlFor={`${rowId}-source`}>
                          {copy.source}
                        </Label>
                        {selectedKind ? (
                          <span
                            className="shrink-0 rounded border border-border bg-muted px-1.5 text-muted-foreground text-xs"
                            data-airapp-site-environment-kind=""
                          >
                            {selectedKind === "secret" ? copy.secret : copy.variable}
                          </span>
                        ) : null}
                      </div>
                      <select
                        aria-invalid={Boolean(sourceError)}
                        className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        data-airapp-site-environment-source=""
                        id={`${rowId}-source`}
                        onChange={(event) => {
                          const selected = data.sources.find(
                            (item) => item.id === event.target.value,
                          );
                          edit(
                            rows.map((item) =>
                              item.rowId === row.rowId
                                ? {
                                    ...item,
                                    vaultItemId: event.target.value,
                                    envName: item.envName || selected?.key || "",
                                  }
                                : item,
                            ),
                          );
                        }}
                        value={row.vaultItemId}
                      >
                        <option disabled value="">
                          {copy.chooseSource}
                        </option>
                        {row.vaultItemId && !source ? (
                          <option disabled value={row.vaultItemId}>
                            {previous?.sourceKey ?? row.envName}
                          </option>
                        ) : null}
                        {data.sources.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.key} · {item.kind === "secret" ? copy.secret : copy.variable}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      aria-label={copy.remove}
                      className="justify-self-end"
                      data-airapp-site-environment-remove=""
                      onClick={() => edit(rows.filter((item) => item.rowId !== row.rowId))}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </Button>
                  </div>
                  {sourceError ? (
                    <p className="text-destructive text-xs" role="alert">
                      {sourceError}
                    </p>
                  ) : null}
                </div>
              );
            })}
            {data.sources.length === 0 ? (
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">{copy.noSources}</p>
                {rows.length > 0 ? vaultLink(data.vaultLinks?.space, copy.openVault) : null}
              </div>
            ) : null}
            {rows.length > 0 ? (
              <p className="text-muted-foreground text-xs">{copy.bindingRemovalDescription}</p>
            ) : null}
            {vaultLink(data.vaultLinks?.apiKey, copy.openApiKeyVault)}
            <AirAppSiteConfigurationList
              directValues={directRows}
              bindings={rows.map((row) => {
                const source = data.sources.find((item) => item.id === row.vaultItemId);
                const previous = data.bindings.find((item) => item.vaultItemId === row.vaultItemId);
                return {
                  envName: row.envName,
                  kind: source?.kind ?? previous?.kind ?? null,
                  sourceKey: source?.key ?? previous?.sourceKey ?? null,
                };
              })}
              dirty={dirty}
            />
            <div className="flex flex-wrap items-center gap-2">
              {directSupported ? (
                <Button
                  data-airapp-site-direct-add=""
                  disabled={count >= 100}
                  onClick={() =>
                    editDirect([
                      ...directRows,
                      { rowId: `direct-new-${nextRowId.current++}`, envName: "", kind: "secret" },
                    ])
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                  {copy.addVariable}
                </Button>
              ) : null}
              <Button
                data-airapp-site-environment-add=""
                disabled={data.sources.length === 0 || count >= 100}
                onClick={() => {
                  edit([
                    ...rows,
                    { rowId: `new-${nextRowId.current++}`, envName: "", vaultItemId: "" },
                  ]);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" className="size-3.5" />
                {copy.add}
              </Button>
              <Button
                data-airapp-site-environment-save=""
                disabled={!dirty || !validNames || !validSources}
                size="sm"
                type="submit"
              >
                {save.isPending ? (
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                ) : null}
                {save.isPending ? copy.saving : copy.save}
              </Button>
            </div>
          </fieldset>
          {dirty && invalidNames ? (
            <p className="text-destructive text-xs" role="alert">
              {invalidDirect ? copy.directInvalid : copy.invalid}
            </p>
          ) : null}
          {count >= 100 ? <p className="text-muted-foreground text-xs">{copy.limit}</p> : null}
          {saveError ? (
            <p className="text-destructive text-xs" role="alert">
              {accessDenied ? siteAccessMessage(copy, accessDenied) : copy.saveFailed}
            </p>
          ) : null}
          {dirty ? (
            <p className="text-muted-foreground text-xs" role="status">
              {copy.unsaved}
            </p>
          ) : saved ? (
            <p className="text-muted-foreground text-xs" role="status">
              {copy.saved}
            </p>
          ) : null}
          {state.previewEnvironmentStale || state.liveEnvironmentStale ? (
            <div
              className="space-y-1 text-muted-foreground text-xs"
              data-airapp-site-environment-pending=""
            >
              {state.previewEnvironmentStale ? <p>{copy.pendingPreview}</p> : null}
              {state.liveEnvironmentStale ? <p>{copy.pendingLive}</p> : null}
            </div>
          ) : null}
          <p className="text-muted-foreground text-xs">{copy.latestOnPublish}</p>
        </form>
      ) : null}
    </section>
  );
}
