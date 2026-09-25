"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { publicAccessOf } from "busabase-contract/domains";
import { nodeWebUrl } from "busabase-contract/node-web-url";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "kui/dialog";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import { Switch } from "kui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { Check, Copy, ExternalLink, Globe2, Lock, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCoreI18n } from "../../../i18n";
import {
  expiryIsoForPreset,
  publicPreviewUrl,
  type ShareExpiryPreset,
  toDatetimeLocalValue,
} from "../utils/share-dialog-utils";
import { useIsAnonymousVisitor } from "../visitor-context";
import {
  EmbedLinkSection,
  EmbedLinkStillLiveNotice,
  useActiveEmbedLinkCount,
  useCanManageEmbedLinks,
} from "./embed-link-section";
import { DialogContent } from "./localized-dialog-content";
import { useWorkspacePermissionLevel } from "./split-submit-button";

type NodeShareCapability = "read" | "submit";

/**
 * The space id for the canonical public URL. When the caller can't hand it in
 * (the base-detail header doesn't carry it), fall back to reading it from the
 * current `/dashboard/<spaceId>/…` pathname — every dashboard route is mounted
 * under that prefix, so the id is always the first path segment after
 * `/dashboard`.
 */
const resolveSpaceId = (spaceId?: string): string | null => {
  if (spaceId) return spaceId;
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/dashboard\/([^/]+)/);
  return match?.[1] ?? null;
};

export function NodeShareDialog({
  orpc,
  nodeId,
  nodeName,
  spaceId,
  nodeType,
  nodeSlug,
  open,
  onOpenChange,
}: {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeName: string;
  spaceId?: string;
  nodeType: string;
  nodeSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const messages = useCoreI18n();
  const t = messages.share;
  const queryClient = useQueryClient();

  // The two halves of this dialog have independent NODE-CAPABILITY gates, and
  // most node types qualify for only one of them. A Form can be shared to the
  // web but never embedded; a Drive / Skill is the reverse (their registry
  // definitions declare `publicAccess: "no"` because an anonymous detail route
  // wouldn't work, yet `embedLinks.create` accepts both and the
  // `/embed/[publicId]` route tree serves them). An AirApp qualifies for BOTH:
  // its `publicAccess: "runtime"` resolves a public link through the relayed
  // runtime rather than an anonymous detail route (see the history note on
  // `airappNodeType`), and it is embeddable too. So neither gate may hide the
  // other's section. Both procedure families still require workspace
  // manage, so the dialog disappears when the viewer cannot manage sharing or
  // when both node-capability gates say no.
  const isAnonymous = useIsAnonymousVisitor();
  const permissionLevel = useWorkspacePermissionLevel();
  const canManageShareSettings = !isAnonymous && hasApiKeyLevel(permissionLevel, "manage");
  const canShareToWeb = canManageShareSettings && publicAccessOf(nodeType) !== "no";
  const embedTarget = useMemo(
    () => ({ type: "node" as const, typeId: nodeId, nodeType }),
    [nodeId, nodeType],
  );
  const canEmbed = useCanManageEmbedLinks(embedTarget);

  const shareQuery = useQuery({
    ...orpc.nodes.share.get.queryOptions({ input: { nodeId } }),
    // Don't ask about public-share settings for a type that can't have them —
    // this dialog opens for Drive/Skill purely for the embed half.
    enabled: canShareToWeb,
  });
  const share = shareQuery.data ?? null;
  const isPublic = share?.scope === "public";

  // Feeds the "turning the switch off does not revoke these" notice below. Same
  // query key as the embed section's own list, so React Query serves both from
  // a single request.
  const activeEmbedLinkCount = useActiveEmbedLinkCount(orpc, embedTarget, canEmbed && open);

  const setShare = useMutation(orpc.nodes.share.set.mutationOptions());

  // A Form carries a SECOND, form-specific gate next to the node's public
  // capability: `form.share.anonymousSubmit`. The server has always enforced it
  // (`submitForm` rejects an anonymous caller when it is false — see
  // form-ops.ts), but nothing in the UI could ever turn it off, so "public link,
  // but only signed-in people may submit" was reachable through the API alone.
  // Only fetched for Form nodes; every other type ignores this entirely.
  const isForm = nodeType === "form";
  const formQuery = useQuery({
    ...orpc.forms.getByNode.queryOptions({ input: { nodeId } }),
    enabled: isForm && open,
    retry: false,
  });
  const form = formQuery.data ?? null;
  const updateForm = useMutation(orpc.forms.update.mutationOptions());

  const handleRequireSignIn = async (requireSignIn: boolean) => {
    if (!form) return;
    try {
      await updateForm.mutateAsync({
        nodeId,
        share: { ...form.share, anonymousSubmit: !requireSignIn },
      });
      await queryClient.invalidateQueries({
        queryKey: orpc.forms.getByNode.queryOptions({ input: { nodeId } }).queryKey,
      });
      toast.success(t.updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.failed);
    }
  };

  // Local drafts for the optional fields — a new password is only sent when the
  // user typed one (empty box = leave the stored password untouched); expiry is
  // a datetime-local string converted to ISO on submit.
  const [passwordDraft, setPasswordDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"share" | "embed">(canShareToWeb ? "share" : "embed");
  const [expiryPreset, setExpiryPreset] = useState<ShareExpiryPreset>("never");
  const [customExpiry, setCustomExpiry] = useState("");
  const [hasUncopiedEmbedSecret, setHasUncopiedEmbedSecret] = useState(false);
  const submittedExpiryRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (share?.expiresAt === submittedExpiryRef.current) {
      setCustomExpiry(toDatetimeLocalValue(share?.expiresAt));
      submittedExpiryRef.current = undefined;
      return;
    }
    if (!share?.expiresAt) {
      setExpiryPreset("never");
      setCustomExpiry("");
      return;
    }
    setExpiryPreset("custom");
    setCustomExpiry(toDatetimeLocalValue(share.expiresAt));
  }, [share?.expiresAt]);

  const publicUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    const resolvedSpaceId = resolveSpaceId(spaceId);
    if (!resolvedSpaceId) return null;
    // Shared with the SDK/CLI/server via busabase-contract — this used to be an
    // inline template literal here, which is why no headless caller could ever
    // produce the same link. See node-web-url.ts.
    return nodeWebUrl({
      webOrigin: window.location.origin,
      spaceId: resolvedSpaceId,
      nodeType,
      nodeSlug,
    });
  }, [spaceId, nodeType, nodeSlug]);

  // Both the share row itself AND the node listings: `NodeVO.shared` is what
  // draws the sidebar's "shared publicly" marker, so publishing/revoking here
  // has to refresh the tree (and Favorites, built from the same rows) or the
  // marker would lag a full page load behind the switch the user just flipped.
  // `nodes.list` is keyed by its input (the sidebar's lazy per-folder fetches
  // each have their own entry), so this invalidates the whole `nodes.list`
  // prefix rather than one input.
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.nodes.share.get.queryOptions({ input: { nodeId } }).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: orpc.nodes.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.nodes.listFavorites.key() }),
    ]);
  };

  const handleToggle = async (next: boolean) => {
    try {
      await setShare.mutateAsync({ nodeId, scope: next ? "public" : "none" });
      await invalidate();
      toast.success(next ? t.enabled : t.disabled);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.failed);
    }
  };

  const handleCapability = async (capability: NodeShareCapability) => {
    try {
      await setShare.mutateAsync({ nodeId, scope: "public", capability });
      await invalidate();
      toast.success(t.updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.failed);
    }
  };

  const handlePassword = async (password: string | null) => {
    try {
      await setShare.mutateAsync({ nodeId, scope: "public", password });
      setPasswordDraft("");
      await invalidate();
      toast.success(t.updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.failed);
    }
  };

  const handleExpiry = async (preset: ShareExpiryPreset, customValue = customExpiry) => {
    if (preset === "custom" && !customValue) return;
    const expiresAt = expiryIsoForPreset(preset, customValue);
    submittedExpiryRef.current = expiresAt;
    try {
      await setShare.mutateAsync({ nodeId, scope: "public", expiresAt });
      await invalidate();
      toast.success(t.updated);
    } catch (err) {
      submittedExpiryRef.current = undefined;
      toast.error(err instanceof Error ? err.message : t.failed);
    }
  };

  const handleExpiryPreset = (preset: ShareExpiryPreset) => {
    setExpiryPreset(preset);
    if (preset !== "custom") void handleExpiry(preset);
  };

  const handleCopy = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      toast.success(t.linkCopied);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.failed);
    }
  };

  const busy = setShare.isPending;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && hasUncopiedEmbedSecret && !window.confirm(t.closeUncopiedEmbedConfirm)) {
      return;
    }
    if (!nextOpen) setHasUncopiedEmbedSecret(false);
    onOpenChange(nextOpen);
  };

  // Keep direct call sites fail-closed too. Menus apply the same capability
  // before opening this dialog, but the dialog is a public component and must
  // never mint a dead link for an unsupported node type on its own. Nothing to
  // offer at all = render nothing, rather than an empty shell.
  if (!canShareToWeb && !canEmbed) return null;

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      {/* The embed half roughly doubles this dialog's height on a node that
          already has links, so it has to be able to scroll — same treatment
          every other tall dialog in this folder gets. */}
      <DialogContent
        className="max-h-[85vh] max-w-lg overflow-y-auto"
        data-testid="node-share-dialog"
        showCloseButton={false}
      >
        <button
          aria-label={t.close}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
          onClick={() => handleOpenChange(false)}
          type="button"
        >
          <X aria-hidden="true" className="h-4 w-4" />
          <span className="sr-only">{t.close}</span>
        </button>
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{nodeName}</DialogDescription>
        </DialogHeader>

        <Tabs onValueChange={(value) => setActiveTab(value as "share" | "embed")} value={activeTab}>
          {canShareToWeb && canEmbed && (
            <TabsList className="grid w-full grid-cols-2" data-testid="share-dialog-tabs">
              <TabsTrigger value="share">{t.shareLinkTab}</TabsTrigger>
              <TabsTrigger value="embed">
                {t.embedTab}
                {activeEmbedLinkCount > 0 && (
                  <Badge className="ml-1.5" variant="secondary">
                    {activeEmbedLinkCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          )}

          {canShareToWeb && (
            <TabsContent className="mt-4 space-y-5" value="share">
              {/* Share-to-web toggle */}
              {shareQuery.isPending ? (
                <div
                  aria-live="polite"
                  className="py-8 text-center text-muted-foreground text-sm"
                  role="status"
                >
                  {t.loading}
                </div>
              ) : shareQuery.isError ? (
                <div className="rounded-md border border-destructive/30 p-3 text-sm">
                  <p className="font-medium">{t.loadFailed}</p>
                  <Button
                    className="mt-2"
                    onClick={() => shareQuery.refetch()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t.retry}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-4 rounded-md border border-border/60 p-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 rounded-md bg-muted p-2">
                        {isPublic ? (
                          <Globe2 aria-hidden="true" className="size-4" />
                        ) : (
                          <Lock aria-hidden="true" className="size-4" />
                        )}
                      </div>
                      <Label className="flex flex-col gap-1" htmlFor="node-share-public">
                        <span className="font-medium text-sm">
                          {isPublic ? t.anyoneWithLink : t.restricted}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {/* An AirApp is a program, so "anyone with the link can open
                    this" understates what sharing does: the visitor's browser
                    downloads and RUNS its files. Say so where the decision is
                    made, not in a doc nobody reads. */}
                          {nodeType === "airapp" ? t.shareToWebAirAppHint : t.shareToWebHint}
                        </span>
                      </Label>
                    </div>
                    <Switch
                      checked={isPublic}
                      disabled={busy}
                      id="node-share-public"
                      onCheckedChange={handleToggle}
                    />
                  </div>

                  {/* THE MENTAL-MODEL FIX. The switch above is the only kill switch a
              human can see, and it does not touch `busabase_embed_links` — an
              agent may have minted a capability URL through MCP hours ago, and
              it stays live. Saying nothing here means the product teaches that
              "share is off" equals "nobody outside can see this", which is
              false. Only shown when there is actually something still live. */}
                  {canShareToWeb && !isPublic && (
                    <EmbedLinkStillLiveNotice count={activeEmbedLinkCount} />
                  )}

                  {isPublic && publicUrl && (
                    <div className="space-y-2">
                      <Label className="font-medium text-sm">{t.linkLabel}</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          className="h-9 flex-1"
                          data-testid="node-share-public-url"
                          readOnly
                          value={publicUrl}
                        />
                        <Button
                          data-testid="node-share-copy-link"
                          onClick={handleCopy}
                          type="button"
                        >
                          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                          {t.copyLink}
                        </Button>
                      </div>
                      <Button
                        className="px-0"
                        data-testid="node-share-preview"
                        onClick={() =>
                          window.open(publicPreviewUrl(publicUrl), "_blank", "noopener,noreferrer")
                        }
                        size="sm"
                        type="button"
                        variant="link"
                      >
                        <ExternalLink aria-hidden="true" className="size-3.5" />
                        {t.previewAsVisitor}
                      </Button>
                    </div>
                  )}

                  {isPublic && (
                    <div
                      className="space-y-4 border-border/60 border-t pt-4"
                      data-testid="node-share-settings"
                    >
                      <div>
                        <h3 className="font-medium text-sm">{t.settingsTitle}</h3>
                        <p className="text-muted-foreground text-xs">{t.settingsHint}</p>
                      </div>
                      {/* Capability — only where "submit" is a real option. The server
                  only ever routes ONE procedure through the submit tier
                  (`forms.submit`), so on every other type this select offered a
                  choice with no effect: you could pick "Allow submissions", it
                  saved, and nothing anywhere behaved differently. */}
                      {publicAccessOf(nodeType) === "submit" && (
                        <div className="flex items-center justify-between gap-3">
                          <Label className="font-medium text-sm">{t.capabilityLabel}</Label>
                          <Select
                            onValueChange={(value) =>
                              handleCapability(value as NodeShareCapability)
                            }
                            value={share?.capability ?? "read"}
                          >
                            <SelectTrigger className="h-8 w-44">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="read">{t.capabilityRead}</SelectItem>
                              <SelectItem value="submit">{t.capabilitySubmit}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Only meaningful once the link may submit at all — on a
                  view-only link there is nothing to require a sign-in for. */}
                      {isForm && form && (share?.capability ?? "read") === "submit" && (
                        <div className="flex items-start justify-between gap-3">
                          <Label
                            className="flex flex-col gap-1"
                            htmlFor="node-share-require-signin"
                          >
                            <span className="font-medium text-sm">{t.requireSignInLabel}</span>
                            <span className="text-muted-foreground text-xs">
                              {t.requireSignInHint}
                            </span>
                          </Label>
                          <Switch
                            checked={!form.share.anonymousSubmit}
                            data-testid="node-share-require-signin"
                            disabled={busy || updateForm.isPending}
                            id="node-share-require-signin"
                            onCheckedChange={handleRequireSignIn}
                          />
                        </div>
                      )}

                      {/* Password — the value is never displayed; only a "set" state. */}
                      <div className="space-y-1.5">
                        <Label className="font-medium text-sm" htmlFor="node-share-password">
                          {t.passwordLabel}
                        </Label>
                        <div className="flex items-center gap-2">
                          <Input
                            className="h-8 flex-1"
                            id="node-share-password"
                            onChange={(e) => setPasswordDraft(e.target.value)}
                            placeholder={t.passwordPlaceholder}
                            type="password"
                            value={passwordDraft}
                          />
                          <Button
                            disabled={busy || !passwordDraft}
                            onClick={() => handlePassword(passwordDraft)}
                            size="sm"
                            type="button"
                          >
                            {t.passwordLabel}
                          </Button>
                          {share?.hasPassword && (
                            <Button
                              disabled={busy}
                              onClick={() => handlePassword(null)}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              {t.passwordClear}
                            </Button>
                          )}
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {share?.hasPassword ? t.passwordSet : t.passwordHint}
                        </p>
                      </div>

                      {/* Expiry */}
                      <div className="space-y-1.5">
                        <Label className="font-medium text-sm" htmlFor="node-share-expiry">
                          {t.expiryLabel}
                        </Label>
                        <Select
                          onValueChange={(value) => handleExpiryPreset(value as ShareExpiryPreset)}
                          value={expiryPreset}
                        >
                          <SelectTrigger
                            className="h-8"
                            id="node-share-expiry"
                            data-testid="node-share-expiry-preset"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="never">{t.expiryNever}</SelectItem>
                            <SelectItem value="1-day">{t.expiryOneDay}</SelectItem>
                            <SelectItem value="7-days">{t.expirySevenDays}</SelectItem>
                            <SelectItem value="30-days">{t.expiryThirtyDays}</SelectItem>
                            <SelectItem value="custom">{t.expiryCustom}</SelectItem>
                          </SelectContent>
                        </Select>
                        {expiryPreset === "custom" && (
                          <div className="flex items-center gap-2">
                            <Input
                              className="h-8 flex-1"
                              data-testid="node-share-custom-expiry"
                              disabled={busy}
                              min={toDatetimeLocalValue(new Date().toISOString())}
                              onChange={(event) => setCustomExpiry(event.target.value)}
                              type="datetime-local"
                              value={customExpiry}
                            />
                            <Button
                              disabled={busy || !customExpiry}
                              onClick={() => handleExpiry("custom")}
                              size="sm"
                              type="button"
                            >
                              {t.apply}
                            </Button>
                          </div>
                        )}
                        <p className="text-muted-foreground text-xs">{t.expiryHint}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          )}

          {/* "Embed on another site" — the capability-URL half. Gates itself
              (anonymous visitor / non-manager / non-embeddable type all render
              nothing), so there is no second copy of that policy here. */}
          {canEmbed && (
            <TabsContent className="mt-4 data-[state=inactive]:hidden" forceMount value="embed">
              <EmbedLinkSection
                divider={false}
                enabled={open}
                onUncopiedSecretChange={setHasUncopiedEmbedSecret}
                orpc={orpc}
                target={embedTarget}
              />
            </TabsContent>
          )}
        </Tabs>

        <DialogFooter>
          <Button onClick={() => handleOpenChange(false)} type="button" variant="outline">
            {t.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
