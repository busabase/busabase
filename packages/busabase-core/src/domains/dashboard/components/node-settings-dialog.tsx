"use client";

// The single, unified "Node Settings" dialog — General (avatar/name/description)
// / Info (read-only properties) / Permissions (access control, cloud-only).
// Replaces three previously-separate surfaces: `NodeRenameDialog`, the inline
// "Info" `Popover` that used to live in `node-detail-views.tsx`, and
// `NodePermissionsDialog` (now split out — its UI moved to
// `apps/busabase-cloud/.../node-permissions-panel.tsx`, this dialog only
// renders whatever the host injects via `NodeSettingsPermissionsSlotProvider`).
//
// Follows the SAME plain "left tab rail + right content pane" shape as
// `apps/busabase/src/domains/settings/components/settings-dialog.tsx` — an
// inline `tabs` array + `activeTab === "x" ? <Content/> : null` — rather than
// buda's heavier `settings-dialog-shell.tsx` (accordion/sections/headerNode),
// which this dialog has no use for.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import type { NodeIcon } from "busabase-contract/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { Input } from "kui/input";
import { Label } from "kui/label";
import type { LucideIcon } from "lucide-react";
import { Info, Shield, SlidersHorizontal } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { getNodePropertyItems } from "../helpers/node-property-items";
import { AssetMetadataBlock } from "./assets";
import { NodeIconPicker } from "./node-icon-picker";
import { NodeSettingsPermissionsSlotContext } from "./node-settings-permissions-slot";
import { EmptyState } from "./primitives";
import { SplitSubmitButton } from "./split-submit-button";

export type NodeSettingsTab = "general" | "info" | "permissions";

export interface NodeSettingsDialogProps {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  nodeSlug?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jump straight to a specific tab when the dialog (re-)opens. */
  initialTab?: NodeSettingsTab;
  /** Auto-focus + select the name field on open — used by the "Rename" entry points. */
  focusField?: "name";
  /** Fired after a successful immediate rename (not a submitted-for-review request). */
  onRenamed?: (name: string) => void;
}

export function NodeSettingsDialog({
  orpc,
  nodeId,
  nodeType,
  nodeName,
  nodeSlug,
  open,
  onOpenChange,
  initialTab,
  focusField,
  onRenamed,
}: NodeSettingsDialogProps) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const t = messages.nodeSettings;
  const renderPermissionsPanel = useContext(NodeSettingsPermissionsSlotContext);

  const [activeTab, setActiveTab] = useState<NodeSettingsTab>(initialTab ?? "general");
  useEffect(() => {
    if (open && initialTab) setActiveTab(initialTab);
  }, [open, initialTab]);

  // One shared fetch for both General (initial description/icon) and Info
  // (the full property list) — `nodes.get` is the same query every detail
  // view already reads, so this is normally a cache hit, not an extra
  // round-trip. Keyed by the node's slug when the caller has one (every
  // detail-page query is keyed by slug, not id — see `NodeRenameDialog`'s
  // `nodeSlug` doc for the full "why"), falling back to the id for the
  // sidebar "•••" entry points, which never have a slug in hand.
  const detailQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: nodeSlug ?? nodeId, type: nodeType } }),
    enabled: open,
  });
  const detail: NodeDetailVO | undefined = detailQuery.data;

  const tabs: { id: NodeSettingsTab; icon: LucideIcon; label: string }[] = [
    { id: "general", icon: SlidersHorizontal, label: t.tabGeneral },
    { id: "info", icon: Info, label: t.tabInfo },
    // Absent entirely (not disabled) when no host injected a panel — see
    // `node-settings-permissions-slot.tsx`.
    ...(renderPermissionsPanel
      ? [{ id: "permissions" as const, icon: Shield, label: t.tabPermissions }]
      : []),
  ];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        // Radix's own open-auto-focus grabs the FIRST focusable descendant —
        // here that's the "General" tab button, rendered before the Name
        // field in DOM order — which silently wins over the name input's own
        // `useEffect`-driven `.focus()` below (that effect runs on React's
        // commit, Radix's auto-focus runs after, on the next frame). Taking
        // over this hook is the only reliable way to land focus on the name
        // field instead, for the "Rename" entry points that pass `focusField`.
        onOpenAutoFocus={(event) => {
          if (focusField === "name") {
            event.preventDefault();
            const input = document.getElementById("node-settings-name");
            if (input instanceof HTMLInputElement) {
              input.focus();
              input.select();
            }
          }
        }}
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{nodeName}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-44 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3">
            {tabs.map((tab) => (
              <button
                className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent ${
                  activeTab === tab.id ? "bg-accent font-medium" : "text-muted-foreground"
                }`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <tab.icon className="size-4" />
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
            {activeTab === "general" ? (
              <GeneralTabContent
                detail={detail}
                focusField={focusField}
                nodeId={nodeId}
                nodeName={nodeName}
                nodeSlug={nodeSlug}
                nodeType={nodeType}
                onClose={() => onOpenChange(false)}
                onRenamed={onRenamed}
                open={open}
                orpc={orpc}
              />
            ) : null}
            {activeTab === "info" ? (
              <InfoTabContent detail={detail} isLoading={detailQuery.isLoading} locale={locale} />
            ) : null}
            {activeTab === "permissions" && renderPermissionsPanel
              ? renderPermissionsPanel(nodeId, nodeName)
              : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GeneralTabContent({
  orpc,
  nodeId,
  nodeType,
  nodeName,
  nodeSlug,
  detail,
  open,
  focusField,
  onRenamed,
  onClose,
}: {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  nodeSlug?: string;
  detail: NodeDetailVO | undefined;
  open: boolean;
  focusField?: "name";
  onRenamed?: (name: string) => void;
  onClose: () => void;
}) {
  const messages = useCoreI18n();
  // This tab writes name + description + icon in ONE operation, so its copy is
  // "save", not "rename". The `rename` block's strings are still the right ones
  // for the surfaces that really are just a rename — the mobile
  // `NodeRenameSheet` and the Base Design tab both still use them — which is
  // why they live on rather than being repointed here.
  const t = messages.nodeSettings;
  const queryClient = useQueryClient();
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(nodeName);
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<NodeIcon | null>(null);
  const [iconDirty, setIconDirty] = useState(false);
  const hydratedRef = useRef(false);

  // Reset local edit state whenever the dialog opens for a (possibly new) node.
  useEffect(() => {
    if (!open) {
      hydratedRef.current = false;
      return;
    }
    setName(nodeName);
  }, [open, nodeName]);

  // Seed description/icon once the shared `nodes.get` fetch resolves — guarded
  // so a background refetch never clobbers an in-progress edit.
  useEffect(() => {
    if (!open || hydratedRef.current || !detail) return;
    setDescription(detail.node.description);
    setIcon(detail.node.icon ?? null);
    setIconDirty(false);
    hydratedRef.current = true;
  }, [open, detail]);

  useEffect(() => {
    if (open && focusField === "name") {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [open, focusField]);

  const createCr = useMutation(orpc.nodes.createChangeRequest.mutationOptions());
  const reviewCr = useMutation(orpc.changeRequests.review.mutationOptions());
  const mergeCr = useMutation(orpc.changeRequests.merge.mutationOptions());
  const isSaving = createCr.isPending || reviewCr.isPending || mergeCr.isPending;

  // Same "invalidate the sidebar tree + every cached query keyed by this
  // node's id/slug" sweep `NodeRenameDialog` used — see that component's doc
  // comment for the full "why a predicate over every query key" reasoning.
  const invalidateNodes = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.nodes.list.queryOptions({}).queryKey }),
      queryClient.invalidateQueries({
        predicate: (query) => {
          const keyStr = JSON.stringify(query.queryKey);
          return keyStr.includes(nodeId) || (!!nodeSlug && keyStr.includes(nodeSlug));
        },
      }),
    ]);

  const submit = async (options?: { mergeImmediately?: boolean }) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const changeRequest = await createCr.mutateAsync({
        operations: [
          {
            kind: "rename",
            nodeId,
            name: trimmed,
            description,
            ...(iconDirty ? { icon } : {}),
          },
        ],
      });
      if (options?.mergeImmediately) {
        await reviewCr.mutateAsync({ changeRequestIds: [changeRequest.id], verdict: "approved" });
        await mergeCr.mutateAsync({ changeRequestIds: [changeRequest.id] });
        await invalidateNodes();
        toast.success(t.saved);
        onRenamed?.(trimmed);
        onClose();
        return;
      }
      await invalidateNodes();
      toast.success(t.changeRequestSubmitted);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.saveFailed);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <NodeIconPicker
          icon={icon}
          nodeId={nodeId}
          nodeType={nodeType}
          onChange={(next) => {
            setIcon(next);
            setIconDirty(true);
          }}
          orpc={orpc}
        />
        <p className="text-muted-foreground text-xs">
          {messages.nodeSettings.iconUploadFormatHint}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="node-settings-name">{messages.common.name}</Label>
        <Input
          id="node-settings-name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit({ mergeImmediately: true });
          }}
          placeholder={t.namePlaceholder}
          ref={nameInputRef}
          value={name}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="node-settings-description">{messages.common.description}</Label>
        <textarea
          className="min-h-20 w-full resize-none rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
          id="node-settings-description"
          onChange={(e) => setDescription(e.target.value)}
          value={description}
        />
      </div>

      <div className="flex justify-end border-border/50 border-t pt-4">
        <SplitSubmitButton
          changeRequestAction={{
            label: t.requestReview,
            loadingLabel: messages.common.submitting,
            onSubmit: () => submit(),
            isLoading: isSaving,
          }}
          // `!detail` blocks submit until the shared `nodes.get` fetch has
          // hydrated `description` — otherwise a fast Enter/click on a cold
          // cache (e.g. the sidebar "•••" entry point, which never had this
          // node's detail pre-fetched) would submit the still-default empty
          // `description` and silently blank out the node's real one.
          disabled={isSaving || !name.trim() || !detail}
          hint={t.requestReviewHint}
          immediateAction={{
            label: t.saveNow,
            loadingLabel: t.saving,
            onSubmit: () => submit({ mergeImmediately: true }),
            isLoading: isSaving,
          }}
        />
      </div>
    </div>
  );
}

function InfoTabContent({
  detail,
  isLoading,
  locale,
}: {
  detail: NodeDetailVO | undefined;
  isLoading: boolean;
  locale: string;
}) {
  const messages = useCoreI18n();

  if (!detail) {
    return isLoading ? (
      <div className="animate-pulse text-muted-foreground text-sm">{messages.common.loading}</div>
    ) : (
      <EmptyState body="" title={messages.common.none} />
    );
  }

  const items = getNodePropertyItems(detail, messages, locale);

  return (
    <div>
      {detail.node.description ? (
        <p className="mb-3 text-muted-foreground text-sm leading-6">{detail.node.description}</p>
      ) : null}
      {detail.type === "file" ? (
        <h2 className="mb-2 font-medium text-muted-foreground text-xs uppercase">
          {messages.nodeDetail.backingAsset}
        </h2>
      ) : null}
      <dl className="flex flex-col gap-2 text-xs">
        {items.map((item) => (
          <div className="flex min-w-0 items-center justify-between gap-3" key={item.label}>
            <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
            <dd className="min-w-0 truncate font-mono text-foreground/80" title={item.value}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      {detail.type === "file" ? (
        <>
          <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-xs">
            <dt className="shrink-0 text-muted-foreground">{messages.nodeDetail.assetUrl}</dt>
            <dd className="min-w-0 truncate">
              <a
                className="text-primary underline-offset-2 hover:underline"
                href={detail.asset.url}
                rel="noreferrer"
                target="_blank"
              >
                {detail.asset.url}
              </a>
            </dd>
          </div>
          <AssetMetadataBlock compact metadata={detail.asset.metadata} />
        </>
      ) : null}
    </div>
  );
}
