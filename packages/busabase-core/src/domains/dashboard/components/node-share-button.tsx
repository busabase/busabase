"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Button } from "kui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "kui/dialog";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import { Switch } from "kui/switch";
import { Check, Copy, Globe } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useCoreI18n } from "../../../i18n";
import { useIsAnonymousVisitor } from "../visitor-context";
import { NodeActionButton } from "./node-action-button";

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

/**
 * Node-level public link sharing: a trigger button + dialog. The orthogonal
 * axis to `NodePermissionsButton` — that one governs which space members may see
 * a node, this one governs whether an ANONYMOUS visitor may reach it over its
 * own canonical URL, and what they may do there (view-only vs. allow
 * submissions), optionally behind a password and/or an expiry. Mirrors the
 * shape of `NodePermissionsButton`, one component per entry point.
 */
export function NodeShareButton({
  orpc,
  nodeId,
  nodeName,
  spaceId,
  nodeType,
  nodeSlug,
  variant = "toolbar",
}: {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeName: string;
  /** Optional — derived from the current pathname when omitted. */
  spaceId?: string;
  nodeType: string;
  nodeSlug: string;
  variant?: "toolbar" | "menu";
}) {
  const messages = useCoreI18n();
  const t = messages.share;
  const [open, setOpen] = useState(false);
  // Publishing a node is a manage-only action; a public read-only visitor can
  // never perform it, so this self-gates everywhere it is mounted (base header,
  // doc/folder/file detail headers, sidebar menu) rather than each call site
  // having to remember the guard. Hooks above run unconditionally first.
  const isAnon = useIsAnonymousVisitor();
  if (isAnon) {
    return null;
  }

  return (
    <>
      <NodeActionButton
        icon={Globe}
        label={t.title}
        onClick={() => setOpen(true)}
        variant={variant}
      />
      {open && (
        <NodeShareDialog
          nodeId={nodeId}
          nodeName={nodeName}
          nodeSlug={nodeSlug}
          nodeType={nodeType}
          onOpenChange={setOpen}
          open={open}
          orpc={orpc}
          spaceId={spaceId}
        />
      )}
    </>
  );
}

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

  const shareQuery = useQuery(orpc.nodes.share.get.queryOptions({ input: { nodeId } }));
  const share = shareQuery.data ?? null;
  const isPublic = share?.scope === "public";

  const setShare = useMutation(orpc.nodes.share.set.mutationOptions());
  const disableShare = useMutation(orpc.nodes.share.disable.mutationOptions());

  // Local drafts for the optional fields — a new password is only sent when the
  // user typed one (empty box = leave the stored password untouched); expiry is
  // a datetime-local string converted to ISO on submit.
  const [passwordDraft, setPasswordDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const publicUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    const resolvedSpaceId = resolveSpaceId(spaceId);
    if (!resolvedSpaceId) return null;
    return `${window.location.origin}/dashboard/${resolvedSpaceId}/${nodeType}/${nodeSlug}`;
  }, [spaceId, nodeType, nodeSlug]);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.nodes.share.get.queryOptions({ input: { nodeId } }).queryKey,
    });

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

  const handleExpiry = async (value: string) => {
    // datetime-local (local time, no zone) → ISO; empty clears it.
    const expiresAt = value ? new Date(value).toISOString() : null;
    try {
      await setShare.mutateAsync({ nodeId, scope: "public", expiresAt });
      await invalidate();
      toast.success(t.updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.failed);
    }
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

  // A stored `expiresAt` (ISO) rendered back into a datetime-local value.
  const expiryInputValue = useMemo(() => {
    if (!share?.expiresAt) return "";
    const d = new Date(share.expiresAt);
    if (Number.isNaN(d.getTime())) return "";
    // Trim to `YYYY-MM-DDThh:mm` in local time for the datetime-local input.
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [share?.expiresAt]);

  const busy = setShare.isPending || disableShare.isPending;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{nodeName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Share-to-web toggle */}
          <div className="flex items-start justify-between gap-3">
            <Label className="flex flex-col gap-1" htmlFor="node-share-public">
              <span className="font-medium text-sm">{t.shareToWeb}</span>
              <span className="text-muted-foreground text-xs">{t.shareToWebHint}</span>
            </Label>
            <Switch
              checked={isPublic}
              disabled={busy}
              id="node-share-public"
              onCheckedChange={handleToggle}
            />
          </div>

          {isPublic && (
            <div className="space-y-4 border-border/60 border-t pt-4">
              {/* Capability */}
              <div className="flex items-center justify-between gap-3">
                <Label className="font-medium text-sm">{t.capabilityLabel}</Label>
                <Select
                  onValueChange={(value) => handleCapability(value as NodeShareCapability)}
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
                <Input
                  className="h-8"
                  defaultValue={expiryInputValue}
                  disabled={busy}
                  id="node-share-expiry"
                  onBlur={(e) => handleExpiry(e.target.value)}
                  type="datetime-local"
                />
                <p className="text-muted-foreground text-xs">{t.expiryHint}</p>
              </div>

              {/* Copy link */}
              {publicUrl && (
                <div className="space-y-1.5">
                  <Label className="font-medium text-sm">{t.linkLabel}</Label>
                  <div className="flex items-center gap-2">
                    <Input className="h-8 flex-1" readOnly value={publicUrl} />
                    <Button onClick={handleCopy} size="sm" type="button" variant="outline">
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {t.copyLink}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            {t.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
