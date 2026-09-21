"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { EmbedFrameMode, EmbedLinkVO } from "busabase-contract/contract/embed-link-schemas";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import { Link2, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { formatDetailTime } from "../helpers/format";
import { getEmbedLinkStatus } from "./embed-link-section";
import { ConfirmActionDialog, EmptyState } from "./primitives";
import { useWorkspacePermissionLevel } from "./split-submit-button";

const PAGE_SIZE = 40;

type AuditStatus = "active" | "expired" | "revoked" | "all";

const AUDIT_STATUSES: readonly AuditStatus[] = ["active", "expired", "revoked", "all"];

/**
 * Space-wide capability-link audit. Creation stays on the target's Share
 * dialog: this screen answers "what is still live anywhere?" and lets a
 * manager cut access off without already knowing which node or agent created it.
 */
export function EmbedLinksAuditView({ orpc }: { orpc: BusabaseQueryUtils }) {
  const messages = useCoreI18n();
  const t = messages.embedLinkAudit;
  const embedT = messages.embedLinks;
  const locale = useCoreLocale();
  const queryClient = useQueryClient();
  const permissionLevel = useWorkspacePermissionLevel();
  const canManage = hasApiKeyLevel(permissionLevel, "manage");
  const [status, setStatus] = useState<AuditStatus>("active");
  const [revokeTarget, setRevokeTarget] = useState<EmbedLinkVO | null>(null);

  const listOptions = useMemo(
    () =>
      orpc.embedLinks.listPaged.infiniteOptions({
        input: (pageParam: string | undefined) => ({
          status,
          limit: PAGE_SIZE,
          cursor: pageParam,
        }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      }),
    [orpc, status],
  );
  const listQuery = useInfiniteQuery({ ...listOptions, enabled: canManage });
  const revokeMutation = useMutation(orpc.embedLinks.revoke.mutationOptions());
  const links = listQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const statusLabels: Record<AuditStatus, string> = {
    active: t.filterActive,
    expired: t.filterExpired,
    revoked: t.filterRevoked,
    all: t.filterAll,
  };
  const kindLabels: Record<EmbedLinkVO["type"], string> = {
    node: t.kindNode,
    "change-request": t.kindChangeRequest,
    "record-detail": t.kindRecord,
  };
  const frameLabels: Record<EmbedFrameMode, string> = {
    anywhere: embedT.frameAnywhere,
    origins: embedT.frameOrigins,
    "top-level-only": embedT.frameTopLevel,
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await revokeMutation.mutateAsync({ id: revokeTarget.id });
      setRevokeTarget(null);
      await queryClient.invalidateQueries({ queryKey: orpc.embedLinks.listPaged.key() });
      // The per-target Share dialog uses the legacy list endpoint. Keep it in
      // sync if the user opens that node after revoking from this audit page.
      await queryClient.invalidateQueries({ queryKey: orpc.embedLinks.list.key() });
      toast.success(t.revoked);
    } catch {
      toast.error(t.revokeFailed);
    }
  };

  if (!canManage) {
    return (
      <div className="h-full min-h-0 overflow-auto px-4 py-6 md:px-6">
        <EmptyState body={t.permissionBody} title={t.permissionTitle} />
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col" data-dashboard-scroll="embed-links">
      <header className="shrink-0 border-border border-b px-4 py-4 md:px-6">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
            <ShieldCheck className="size-4.5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-semibold text-foreground text-lg">{t.title}</h1>
            <p className="mt-0.5 max-w-3xl text-muted-foreground text-sm">{t.description}</p>
            <p className="mt-1 text-muted-foreground text-xs">{t.oneTimeHint}</p>
          </div>
        </div>
        <div className="mt-4 inline-flex rounded-md border bg-muted p-1" role="group">
          {AUDIT_STATUSES.map((candidate) => (
            <button
              aria-pressed={status === candidate}
              className={`min-w-20 rounded-sm px-3 py-1.5 font-medium text-sm transition-colors ${
                status === candidate
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              key={candidate}
              onClick={() => setStatus(candidate)}
              type="button"
            >
              {statusLabels[candidate]}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {listQuery.isPending ? (
          <AuditTableSkeleton />
        ) : listQuery.isError ? (
          <EmptyState
            action={
              <Button onClick={() => listQuery.refetch()} size="sm" type="button" variant="outline">
                {t.retry}
              </Button>
            }
            body={t.failedBody}
            title={t.failedTitle}
          />
        ) : links.length === 0 && !listQuery.hasNextPage ? (
          <EmptyState
            body={status === "active" ? t.emptyActiveBody : t.emptyHistoryBody}
            title={status === "active" ? t.emptyActiveTitle : t.emptyHistoryTitle}
          />
        ) : links.length === 0 ? (
          <EmptyState
            action={
              <Button
                disabled={listQuery.isFetchingNextPage}
                onClick={() => listQuery.fetchNextPage()}
                size="sm"
                type="button"
                variant="outline"
              >
                {listQuery.isFetchingNextPage ? t.loadingMore : t.loadMore}
              </Button>
            }
            body={t.continueBody}
            title={t.continueTitle}
          />
        ) : (
          <>
            <p className="mb-2 text-muted-foreground text-xs">
              {fmt(t.loadedCount, { count: links.length })}
            </p>
            <div className="overflow-x-auto rounded-md border border-border/70">
              <table className="w-full min-w-[920px] border-collapse text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground text-xs">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t.target}</th>
                    <th className="px-3 py-2 font-medium">{t.kind}</th>
                    <th className="px-3 py-2 font-medium">{t.policy}</th>
                    <th className="px-3 py-2 font-medium">{t.created}</th>
                    <th className="px-3 py-2 font-medium">{t.expires}</th>
                    <th className="px-3 py-2 font-medium">{t.status}</th>
                    <th className="px-3 py-2 text-right font-medium">{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => {
                    const linkStatus = getEmbedLinkStatus(link);
                    const statusLabel =
                      linkStatus === "active"
                        ? embedT.statusActive
                        : linkStatus === "expired"
                          ? embedT.statusExpired
                          : embedT.statusRevoked;
                    const policy =
                      link.framePolicy.mode === "origins"
                        ? link.framePolicy.allowedOrigins.join(", ")
                        : frameLabels[link.framePolicy.mode];
                    return (
                      <tr className="border-border/60 border-t" key={link.id}>
                        <td className="max-w-64 px-3 py-2.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium" title={link.targetName}>
                              {link.targetName}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {kindLabels[link.type]}
                        </td>
                        <td
                          className="max-w-64 truncate px-3 py-2.5 text-muted-foreground"
                          title={policy}
                        >
                          {policy}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                          {formatDetailTime(link.createdAt, locale)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                          {formatDetailTime(link.expiresAt, locale)}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge variant={linkStatus === "active" ? "secondary" : "outline"}>
                            {statusLabel}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {linkStatus === "active" ? (
                            <Button
                              disabled={revokeMutation.isPending}
                              onClick={() => setRevokeTarget(link)}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              {t.revoke}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {listQuery.hasNextPage ? (
              <Button
                className="mt-3 w-full"
                disabled={listQuery.isFetchingNextPage}
                onClick={() => listQuery.fetchNextPage()}
                type="button"
                variant="outline"
              >
                {listQuery.isFetchingNextPage ? t.loadingMore : t.loadMore}
              </Button>
            ) : null}
          </>
        )}
      </div>

      <ConfirmActionDialog
        body={fmt(t.revokeConfirmBody, { target: revokeTarget?.targetName ?? "" })}
        confirmLabel={t.revoke}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        open={revokeTarget !== null}
        pending={revokeMutation.isPending}
        title={t.revokeConfirmTitle}
      />
    </section>
  );
}

function AuditTableSkeleton() {
  return (
    <div
      aria-label="Loading"
      className="overflow-hidden rounded-md border border-border/70"
      role="status"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div
          className="grid grid-cols-[2fr_1fr_2fr_1fr_1fr] gap-4 border-border/60 border-b px-3 py-3 last:border-b-0"
          key={`audit-row-${index + 1}`}
        >
          <div className="h-4 animate-pulse rounded bg-muted" />
          <div className="h-4 animate-pulse rounded bg-muted" />
          <div className="h-4 animate-pulse rounded bg-muted" />
          <div className="h-4 animate-pulse rounded bg-muted" />
          <div className="h-4 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
