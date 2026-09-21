"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { SharedNodeVO } from "busabase-contract/contract/schemas";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import { Globe, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { formatDetailTime } from "../helpers/format";
import { nodeRoutePath } from "../helpers/known-node-cache";
import { useHrefWithCurrentSearch } from "../helpers/link-search";
import { NodeAvatar } from "../helpers/node-icons";
import { ConfirmActionDialog, EmptyState } from "./primitives";
import { useWorkspacePermissionLevel } from "./split-submit-button";

interface Props {
  orpc: BusabaseQueryUtils;
}

/**
 * Space-level public-share audit — "what in this workspace can anyone on the
 * internet open, and how do I stop it?".
 *
 * Until this screen existed the only way to answer that was to open every
 * node's Share dialog one at a time, so the honest answer for most workspaces
 * was "nobody knows". Sibling of the Embed-link audit (same shape of question,
 * a different kind of grant): creation stays on each node's own Share dialog,
 * and this screen only reviews and revokes.
 *
 * Scope, deliberately: rows are nodes carrying their OWN live public share row
 * — exactly what the sidebar tree marks with a globe, and exactly what
 * `nodes.share.disable` can revoke. A Doc sitting inside a shared folder is
 * reachable, but nobody published the Doc; listing it would offer a "Stop
 * sharing" button whose only possible effect is closing the folder, which is
 * not the row the user pointed at. `ownGrantsHint` says this on screen rather
 * than leaving it to be discovered.
 */
export function SharedAccessView({ orpc }: Props) {
  const messages = useCoreI18n();
  const t = messages.sharedAccess;
  const locale = useCoreLocale();
  const queryClient = useQueryClient();
  // `nodes.share.list` and `nodes.share.disable` are both manage-level (see
  // `PROCEDURE_PERMISSION_POLICY`), so there is nothing here for anyone else —
  // including the revoke button, which is why the whole screen is gated rather
  // than just the action column.
  const canManage = hasApiKeyLevel(useWorkspacePermissionLevel(), "manage");
  const [revokeTarget, setRevokeTarget] = useState<SharedNodeVO | null>(null);

  const listQuery = useQuery({
    ...orpc.nodes.share.list.queryOptions({ input: {} }),
    enabled: canManage,
  });
  const disableShare = useMutation(orpc.nodes.share.disable.mutationOptions());
  const shares = listQuery.data ?? [];

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await disableShare.mutateAsync({ nodeId: revokeTarget.nodeId });
      setRevokeTarget(null);
      await queryClient.invalidateQueries({ queryKey: orpc.nodes.share.list.key() });
      // The node's own Share dialog reads the per-node endpoint. Keep it honest
      // for the case where someone revokes here and then opens that node.
      await queryClient.invalidateQueries({ queryKey: orpc.nodes.share.get.key() });
      // The sidebar's globe markers ride on `NodeVO.shared`, which comes back
      // with the node tree — without this the row the user just revoked keeps
      // its marker until the next unrelated refetch.
      await queryClient.invalidateQueries({ queryKey: orpc.nodes.list.key() });
      toast.success(t.revoked);
    } catch {
      toast.error(t.revokeFailed);
    }
  };

  if (!canManage) {
    return (
      <div className="h-full min-h-0 overflow-auto px-4 py-6 md:px-6">
        {/* A lock, not the primitive's default pencil: this is a door that is
            shut, not a page waiting to be written. */}
        <EmptyState body={t.permissionBody} icon={Lock} title={t.permissionTitle} />
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col" data-dashboard-scroll="shared-access">
      <header className="shrink-0 border-border border-b px-4 py-4 md:px-6">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
            <Globe className="size-4.5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-semibold text-foreground text-lg">{t.title}</h1>
            <p className="mt-0.5 max-w-3xl text-muted-foreground text-sm">{t.description}</p>
            <p className="mt-1 text-muted-foreground text-xs">{t.ownGrantsHint}</p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {listQuery.isPending ? (
          <SharedTableSkeleton />
        ) : listQuery.isError ? (
          <EmptyState
            action={
              <Button onClick={() => listQuery.refetch()} size="sm" type="button" variant="outline">
                {t.retry}
              </Button>
            }
            body={t.failedBody}
            icon={TriangleAlert}
            title={t.failedTitle}
          />
        ) : shares.length === 0 ? (
          // Empty is GOOD NEWS on a governance screen — nothing is exposed —
          // so this state reads as an answer, not as a missing result. Hence a
          // shield rather than the primitive's default pencil, which would
          // read as "nothing here yet, go share something".
          <EmptyState body={t.emptyBody} icon={ShieldCheck} title={t.emptyTitle} />
        ) : (
          <>
            <p className="mb-2 text-muted-foreground text-xs">
              {fmt(t.count, { count: shares.length })}
            </p>
            <div className="overflow-x-auto rounded-md border border-border/70">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground text-xs">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t.columnTarget}</th>
                    <th className="px-3 py-2 font-medium">{t.columnCapability}</th>
                    <th className="px-3 py-2 font-medium">{t.columnPassword}</th>
                    <th className="px-3 py-2 font-medium">{t.columnExpires}</th>
                    <th className="px-3 py-2 text-right font-medium">{t.columnActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {shares.map((share) => (
                    <SharedRow
                      key={share.nodeId}
                      locale={locale}
                      onRevoke={() => setRevokeTarget(share)}
                      revokeDisabled={disableShare.isPending}
                      share={share}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <ConfirmActionDialog
        body={fmt(t.revokeConfirmBody, { target: revokeTarget?.name ?? "" })}
        confirmLabel={t.revoke}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        open={revokeTarget !== null}
        pending={disableShare.isPending}
        title={t.revokeConfirmTitle}
      />
    </section>
  );
}

interface SharedRowProps {
  share: SharedNodeVO;
  locale: string;
  revokeDisabled: boolean;
  onRevoke: () => void;
}

/**
 * One grant. Its own component only because the target cell needs
 * `useHrefWithCurrentSearch` — the workbench carries `?demo=…` and friends
 * through every in-app link, and a hook cannot be called inside `.map()`.
 */
function SharedRow({ share, locale, revokeDisabled, onRevoke }: SharedRowProps) {
  const messages = useCoreI18n();
  const t = messages.sharedAccess;
  const href = useHrefWithCurrentSearch(nodeRoutePath(share.type, share.slug));

  return (
    <tr className="border-border/60 border-t">
      <td className="max-w-80 px-3 py-2.5">
        <Link
          className="flex min-w-0 items-center gap-2 rounded-md transition-colors hover:text-foreground"
          href={href}
        >
          <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded text-muted-foreground">
            <NodeAvatar node={share} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium" title={share.name}>
              {share.name}
            </span>
            {/* The grant's age, the one audit fact with no column of its own —
                "when did this become public" is context for the row, not
                something anyone sorts or scans by. */}
            <span className="block text-muted-foreground text-xs">
              {fmt(t.sharedSince, { time: formatDetailTime(share.createdAt, locale) })}
            </span>
          </span>
        </Link>
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">
        {share.capability === "submit" ? t.capabilitySubmit : t.capabilityRead}
      </td>
      <td className="px-3 py-2.5">
        {/* Never the password itself, and never a hash — the VO carries only
            this boolean (see `sharedNodeSchema`). */}
        <Badge variant={share.hasPassword ? "secondary" : "outline"}>
          {share.hasPassword ? t.passwordSet : t.passwordNone}
        </Badge>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
        {share.expiresAt ? formatDetailTime(share.expiresAt, locale) : t.neverExpires}
      </td>
      <td className="px-3 py-2.5 text-right">
        <Button
          disabled={revokeDisabled}
          onClick={onRevoke}
          size="sm"
          type="button"
          variant="outline"
        >
          {t.revoke}
        </Button>
      </td>
    </tr>
  );
}

function SharedTableSkeleton() {
  return (
    <div
      aria-label="Loading"
      className="overflow-hidden rounded-md border border-border/70"
      role="status"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div
          className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 border-border/60 border-b px-3 py-3 last:border-b-0"
          key={`shared-row-${index + 1}`}
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
