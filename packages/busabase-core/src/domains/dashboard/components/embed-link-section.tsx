"use client";

// "Embed on another site" — the second half of sharing, and the only human
// entry point to `embedLinks.create` / `.list` / `.revoke`.
//
// Why this is a separate file from `node-share-button.tsx`: an embed link is
// polymorphic (`node` | `change-request` | `record-detail`), so this section is
// meant to be dropped into a Change Request page or a record detail panel
// later without dragging the node-only Share dialog along with it. Everything
// it needs arrives through `target`.
//
// Why it is NOT governed by the Share dialog's blue "Share to web" switch:
// public share (`nodes.share.set`) and embed links are two independent grants
// stored in two different places. Turning the switch off does not touch
// `busabase_embed_links`, which is why `EmbedLinkStillLiveNotice` exists —
// see the comment on it.
//
// SECRETS: `url`/`iframeUrl` are bearer capabilities returned exactly ONCE by
// `create`. They live in `useState` only — never in the query cache, never in a
// log — and the caller clears them when the dialog closes. `list` deliberately
// has no `url`, so a list row must never grow a Copy button: it could not work.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  type CreatedEmbedLinkVO,
  EMBED_LINK_DEFAULT_MINUTES,
  EMBED_LINK_MAX_MINUTES,
  type EmbedFrameMode,
  type EmbedLinkVO,
  type EmbedTargetType,
  isEmbeddableNodeType,
} from "busabase-contract/contract/embed-link-schemas";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import { Textarea } from "kui/textarea";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { localizeCoreErrorMessage } from "../../../i18n/localize-error";
import { formatDetailTime } from "../helpers/format";
import { useIsAnonymousVisitor } from "../visitor-context";
import { ConfirmActionDialog } from "./primitives";
import { useWorkspacePermissionLevel } from "./split-submit-button";

/** What an embed link would point at. `nodeType` is only read for `"node"`. */
export interface EmbedTarget {
  type: EmbedTargetType;
  typeId: string;
  nodeType?: string;
}

/** The expiry choices offered, in minutes. Capped by the contract's own max. */
const EXPIRY_CHOICES = [15, 60, 8 * 60, 24 * 60].filter(
  (minutes) => minutes <= EMBED_LINK_MAX_MINUTES,
);
const MAX_ALLOWED_ORIGINS = 20;

/**
 * May this viewer mint/see embed links for this target?
 *
 * Fail-closed, in order, and ABSENT rather than disabled when it fails — the
 * same choice the Permissions tab makes:
 *  1. A public/anonymous visitor never manages anything. The server already
 *     refuses (`embedLinks.*` is in neither the embed-read nor the anonymous
 *     allowlist, both default-deny), so this only stops a wall of 403s.
 *  2. All three procedures are `workspace("manage")`, and `createEmbedLink`
 *     independently re-checks `manage` on the target node.
 *  3. `createEmbedLink` rejects node types outside `EmbedNodeTypeSchema`, so
 *     offering the control for a Form/whiteboard/workflow would be a button
 *     that can only error.
 */
export function useCanManageEmbedLinks(target: EmbedTarget): boolean {
  const isAnonymous = useIsAnonymousVisitor();
  const permissionLevel = useWorkspacePermissionLevel();
  if (isAnonymous) return false;
  if (!hasApiKeyLevel(permissionLevel, "manage")) return false;
  if (target.type === "node") return isEmbeddableNodeType(target.nodeType);
  return true;
}

const listQueryOptions = (orpc: BusabaseQueryUtils, target: EmbedTarget) => ({
  ...orpc.embedLinks.list.queryOptions({
    // The contract's `typeId` filter exists for exactly this per-target
    // scoping — the space-wide view is a separate, deliberate follow-up.
    input: { type: target.type, typeId: target.typeId },
  }),
  // A viewer who can't manage embed links gets a refusal here, and that's an
  // answer, not a transient failure. Retrying it three times would only turn
  // one "no" into four. Same treatment the comments mention-picker gives its
  // FORBIDDEN agent catalog.
  retry: false,
});

/**
 * How many embed links for this target are still live.
 *
 * Shared by the section itself and by the Share dialog's "turning the switch off
 * does not revoke these" notice; React Query dedupes the two calls into one
 * request because they resolve to the same key.
 */
export function useActiveEmbedLinkCount(
  orpc: BusabaseQueryUtils,
  target: EmbedTarget,
  enabled: boolean,
): number {
  const query = useQuery({ ...listQueryOptions(orpc, target), enabled });
  return (query.data ?? []).filter((link) => link.active).length;
}

const statusOf = (link: EmbedLinkVO): "active" | "revoked" | "expired" => {
  if (link.revokedAt) return "revoked";
  // `active` is computed server-side against the server's clock. Do NOT
  // recompute expiry from `expiresAt` here — a skewed client would disagree
  // with the thing actually enforcing it.
  return link.active ? "active" : "expired";
};

const iframeSnippet = (iframeUrl: string): string =>
  `<iframe src="${iframeUrl}" width="100%" height="600" style="border:0"></iframe>`;

/** Read-only value + Copy, used for both the URL and the iframe snippet. */
function CopyableValue({
  label,
  multiline = false,
  copyLabel,
  value,
  testId,
}: {
  label: string;
  multiline?: boolean;
  copyLabel: string;
  value: string;
  testId: string;
}) {
  const messages = useCoreI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(messages.embedLinks.copied);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : messages.embedLinks.failed);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label className="font-medium text-sm">{label}</Label>
      <div className="flex items-start gap-2">
        {multiline ? (
          <Textarea
            className="min-h-16 flex-1 font-mono text-xs"
            data-testid={testId}
            readOnly
            value={value}
          />
        ) : (
          <Input
            className="h-8 flex-1 font-mono text-xs"
            data-testid={testId}
            readOnly
            value={value}
          />
        )}
        <Button onClick={handleCopy} size="sm" type="button" variant="outline">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copyLabel}
        </Button>
      </div>
    </div>
  );
}

function EmbedLinkRow({
  link,
  onRevoke,
  pending,
}: {
  link: EmbedLinkVO;
  onRevoke: (link: EmbedLinkVO) => void;
  pending: boolean;
}) {
  const messages = useCoreI18n();
  const t = messages.embedLinks;
  const locale = useCoreLocale();
  const status = statusOf(link);
  const statusLabel =
    status === "active" ? t.statusActive : status === "revoked" ? t.statusRevoked : t.statusExpired;
  const frameLabel: Record<EmbedFrameMode, string> = {
    anywhere: t.frameAnywhere,
    origins: t.frameOrigins,
    "top-level-only": t.frameTopLevel,
  };

  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-md border border-border/60 p-2.5 ${
        status === "active" ? "" : "opacity-60"
      }`}
      data-testid="embed-link-row"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-sm">{link.targetName}</span>
          <Badge variant={status === "active" ? "secondary" : "outline"}>{statusLabel}</Badge>
        </div>
        <div className="text-muted-foreground text-xs">
          {`${t.colWhere}: ${frameLabel[link.framePolicy.mode]}`}
          {link.framePolicy.mode === "origins" && link.framePolicy.allowedOrigins.length > 0
            ? ` (${link.framePolicy.allowedOrigins.join(", ")})`
            : ""}
        </div>
        <div className="text-muted-foreground text-xs">
          {`${t.colExpires}: ${formatDetailTime(link.expiresAt, locale)}`}
        </div>
      </div>
      {status === "active" && (
        <Button
          disabled={pending}
          onClick={() => onRevoke(link)}
          size="sm"
          type="button"
          variant="outline"
        >
          {t.revoke}
        </Button>
      )}
    </div>
  );
}

/**
 * The mental-model fix, rendered by the Share dialog ABOVE this section.
 *
 * The bug it answers is not cosmetic: the Share dialog's switch is the only
 * kill switch a human can see, and it does not touch embed links. An agent may
 * have minted one through MCP `embed_links_create` hours ago. Without this line
 * the product actively teaches that "sharing is off" means "nobody outside can
 * see this", which is false.
 */
export function EmbedLinkStillLiveNotice({ count }: { count: number }) {
  const messages = useCoreI18n();
  if (count <= 0) return null;
  return (
    <p
      className="rounded-md border border-border/60 bg-muted/40 p-2.5 text-muted-foreground text-xs"
      data-testid="embed-link-still-live-notice"
    >
      {fmt(messages.embedLinks.notRevokedByShareToggle, { count })}
    </p>
  );
}

export function EmbedLinkSection({
  orpc,
  target,
  enabled = true,
  divider = true,
}: {
  orpc: BusabaseQueryUtils;
  target: EmbedTarget;
  /** The host's own open/visibility gate — keeps the list query off when closed. */
  enabled?: boolean;
  /** Off when this is the first thing in its container (no rule above it). */
  divider?: boolean;
}) {
  const messages = useCoreI18n();
  const t = messages.embedLinks;
  const queryClient = useQueryClient();
  const canManage = useCanManageEmbedLinks(target);

  const [expiresInMinutes, setExpiresInMinutes] = useState(EMBED_LINK_DEFAULT_MINUTES);
  const [frameMode, setFrameMode] = useState<EmbedFrameMode>("anywhere");
  const [originsDraft, setOriginsDraft] = useState("");
  // The one-time reveal. Never cached, never logged; the Share dialog drops the
  // whole component when it closes, which is what clears it.
  const [created, setCreated] = useState<CreatedEmbedLinkVO | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<EmbedLinkVO | null>(null);

  // Drop the revealed capability the moment the host hides this section. The
  // Share dialog already unmounts us on close (Radix portals away the content),
  // but a host that keeps us mounted must not be the one place a bearer token
  // survives in memory and in the DOM. Render-phase state adjustment, not an
  // effect, so the secret is gone in the same commit that hides it.
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    if (!enabled && created) setCreated(null);
  }

  const listQuery = useQuery({
    ...listQueryOptions(orpc, target),
    enabled: enabled && canManage,
  });
  const createLink = useMutation(orpc.embedLinks.create.mutationOptions());
  const revokeLink = useMutation(orpc.embedLinks.revoke.mutationOptions());

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.embedLinks.list.key() });

  const handleCreate = async () => {
    const allowedOrigins = originsDraft
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    try {
      const result = await createLink.mutateAsync({
        type: target.type,
        typeId: target.typeId,
        expiresInMinutes,
        // Origin validation (HTTPS-or-loopback, exact origin, no wildcards) is
        // the contract's job — `EmbedAllowedOriginSchema`. Re-implementing it
        // here would only create a second, drifting definition; a rejected
        // origin surfaces through the error toast instead.
        framePolicy:
          frameMode === "origins"
            ? { mode: "origins", allowedOrigins }
            : { mode: frameMode, allowedOrigins: [] },
      });
      setCreated(result);
      await invalidate();
      toast.success(t.created);
    } catch (err) {
      // In a `?demo=` workspace the demo twin refuses create/revoke outright;
      // its FORBIDDEN message explains why, so it reaches the user verbatim.
      toast.error(
        localizeCoreErrorMessage(messages, err instanceof Error ? err.message : t.failed),
      );
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await revokeLink.mutateAsync({ id: revokeTarget.id });
      setRevokeTarget(null);
      await invalidate();
      toast.success(t.revoked);
    } catch (err) {
      toast.error(
        localizeCoreErrorMessage(messages, err instanceof Error ? err.message : t.failed),
      );
    }
  };

  if (!canManage) return null;
  // Second, authoritative gate: the SERVER said no.
  //
  // `useWorkspacePermissionLevel` is a React context, and the sidebar chrome
  // (`BusabaseDashboardShell`) mounts its copy of the Share dialog OUTSIDE the
  // `SubmitPermissionProvider` that `BusabaseDashboard` installs — so on that
  // path the level reads as the context default (`"manage"`) even for a Cloud
  // viewer. Rather than duplicate the host's permission plumbing, follow the
  // one source that is never wrong: if `embedLinks.list` was refused, there is
  // nothing here this viewer may do, so show nothing instead of a Create button
  // that can only produce a 403 toast.
  if (listQuery.isError) return null;

  const links = listQuery.data ?? [];
  const busy = createLink.isPending;

  return (
    <div
      className={`space-y-4 ${divider ? "border-border/60 border-t pt-4" : ""}`}
      data-testid="embed-link-section"
    >
      <div className="space-y-1">
        <h3 className="font-medium text-sm">{t.title}</h3>
        <p className="text-muted-foreground text-xs">{t.hint}</p>
        {/* An AirApp is a program: the embed does not show a snapshot, the
            visitor's browser downloads and runs its files. Same warning the
            public-share half already gives. */}
        {target.nodeType === "airapp" && (
          <p className="text-muted-foreground text-xs">{t.airappHint}</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label className="font-medium text-sm" htmlFor="embed-link-expiry">
          {t.expiresLabel}
        </Label>
        <Select
          onValueChange={(value) => setExpiresInMinutes(Number(value))}
          value={String(expiresInMinutes)}
        >
          <SelectTrigger className="h-8 w-44" id="embed-link-expiry">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_CHOICES.map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {minutes === 15
                  ? t.expires15m
                  : minutes === 60
                    ? t.expires1h
                    : minutes === 480
                      ? t.expires8h
                      : t.expires24h}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label className="font-medium text-sm" htmlFor="embed-link-frame">
          {t.frameLabel}
        </Label>
        <Select onValueChange={(value) => setFrameMode(value as EmbedFrameMode)} value={frameMode}>
          <SelectTrigger className="h-8 w-44" id="embed-link-frame">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anywhere">{t.frameAnywhere}</SelectItem>
            <SelectItem value="origins">{t.frameOrigins}</SelectItem>
            <SelectItem value="top-level-only">{t.frameTopLevel}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {frameMode === "origins" && (
        <div className="space-y-1.5">
          <Label className="font-medium text-sm" htmlFor="embed-link-origins">
            {t.originsLabel}
          </Label>
          <Textarea
            className="min-h-16 font-mono text-xs"
            id="embed-link-origins"
            onChange={(e) => setOriginsDraft(e.target.value)}
            placeholder={t.originsPlaceholder}
            value={originsDraft}
          />
          <p className="text-muted-foreground text-xs">
            {fmt(t.originsHint, { max: MAX_ALLOWED_ORIGINS })}
          </p>
        </div>
      )}

      <Button
        data-testid="embed-link-create"
        /* Deliberately a plain Button, NOT `SplitSubmitButton`: minting a
           capability URL is not a ChangeRequest-able write. The input schema
           has no `autoMerge`, the access table maps all three procedures to
           workspace("manage"), and the logic re-checks `manage` on the target
           node — "submit this for review instead" is not an option the server
           offers here. */
        disabled={busy || (frameMode === "origins" && originsDraft.trim().length === 0)}
        onClick={handleCreate}
        size="sm"
        type="button"
      >
        {busy ? t.creating : t.createButton}
      </Button>

      {created && (
        <div
          className="space-y-3 rounded-md border border-border/60 bg-muted/40 p-3"
          data-testid="embed-link-created"
        >
          <div className="font-medium text-sm">{t.createdTitle}</div>
          <CopyableValue
            copyLabel={t.copyLink}
            label={t.linkLabel}
            testId="embed-link-created-url"
            value={created.url}
          />
          <CopyableValue
            copyLabel={t.copyIframe}
            label={t.iframeLabel}
            multiline
            testId="embed-link-created-iframe"
            value={iframeSnippet(created.iframeUrl)}
          />
          <p className="text-muted-foreground text-xs">{t.createdOnceHint}</p>
        </div>
      )}

      <div className="space-y-2">
        <div className="font-medium text-sm">{t.listTitle}</div>
        {links.length === 0 ? (
          /* Not `EmptyState` from ./primitives — that one is a full-page
             placeholder with a 460px floor, which inside a dialog would push
             every control off-screen. Same tokens, dialog-sized. */
          <div className="rounded-md border border-border/60 border-dashed p-3 text-center">
            <div className="font-medium text-sm">{t.listEmptyTitle}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t.listEmptyBody}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {links.map((link) => (
              <EmbedLinkRow
                key={link.id}
                link={link}
                onRevoke={setRevokeTarget}
                pending={revokeLink.isPending}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmActionDialog
        body={fmt(t.revokeConfirmBody, { target: revokeTarget?.targetName ?? "" })}
        confirmLabel={t.revoke}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        open={revokeTarget !== null}
        pending={revokeLink.isPending}
        title={t.revokeConfirmTitle}
      />
    </div>
  );
}
