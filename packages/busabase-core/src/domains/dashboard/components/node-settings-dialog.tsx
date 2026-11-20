"use client";

// The single, unified "Node Settings" dialog — General (avatar/name/slug/description)
// / Info (read-only properties) / Permissions (access control, cloud-only)
// / User sign-in (AirApps only, cloud-only — `NodeSettingsAppSignInSlotProvider`).
// Replaces three previously-separate surfaces: `NodeRenameDialog`, the inline
// "Info" `Popover` that used to live in `node-detail-views.tsx`, and
// `NodePermissionsDialog` (now split out so this dialog renders whatever the
// host injects via `NodeSettingsPermissionsSlotProvider`).
//
// Follows the SAME plain "left tab rail + right content pane" shape as
// `apps/busabase/src/domains/settings/components/settings-dialog.tsx` — an
// inline `tabs` array + `activeTab === "x" ? <Content/> : null` — rather than
// a heavier accordion/sections settings shell, which this dialog has no use for.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import type { NodeIcon } from "busabase-contract/types";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import type { LucideIcon } from "lucide-react";
import { Info, KeyRound, Shield, SlidersHorizontal } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import {
  type AirAppEngineChoice,
  AirAppEngineSetting,
  FOLLOW_APP,
  resolveAvailableAirAppRunnerKind,
  resolveEffectiveEngineChoice,
} from "../../airapp/components/AirAppEngineSetting";
import { AirAppSiteSettings } from "../../airapp/components/AirAppSiteControls";
import {
  useAirAppEngineAvailability,
  useAirAppEnginePlanGate,
  useAirAppEnginesNotConfigured,
} from "../../airapp/components/engine-availability-context";
import type { AirAppRunnerKind } from "../../airapp/components/runners/types";
import {
  AIRAPP_MANIFEST_PATH,
  type AirAppRuntimeKind,
  parseAirAppManifest,
  resolveRunPlan,
} from "../../airapp/utils/airapp-runtime-descriptor";
import { replaceNodeRouteSlug } from "../utils/node-route";
import { toSlugInput } from "../utils/slug-input";
import { DialogContent } from "./localized-dialog-content";
import { NodeIconPicker } from "./node-icon-picker";
import { NodeInfoPanel } from "./node-info-panel";
import { NodeSettingsAppSignInSlotContext } from "./node-settings-app-sign-in-slot";
import { NodeSettingsPermissionsSlotContext } from "./node-settings-permissions-slot";
import { SplitSubmitButton } from "./split-submit-button";

export type NodeSettingsTab = "general" | "info" | "permissions" | "signIn";

/** Select value for "no default" — the Base opens on its leftmost tab. */
const LEFTMOST_VIEW = "__leftmost__";

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
  const t = messages.nodeSettings;
  const renderPermissionsPanel = useContext(NodeSettingsPermissionsSlotContext);
  const renderAppSignInPanel = useContext(NodeSettingsAppSignInSlotContext);
  // AirApps only, and only when the host has app users at all — see
  // `node-settings-app-sign-in-slot.tsx`.
  const appSignInPanel = nodeType === "airapp" ? renderAppSignInPanel : null;

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
    ...(appSignInPanel ? [{ id: "signIn" as const, icon: KeyRound, label: t.tabUserSignIn }] : []),
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
              <NodeInfoPanel
                detail={detail}
                isLoading={detailQuery.isLoading}
                nodeId={nodeId}
                nodeSlug={nodeSlug}
                nodeType={nodeType}
                orpc={orpc}
              />
            ) : null}
            {activeTab === "permissions" && renderPermissionsPanel
              ? renderPermissionsPanel(nodeId, nodeName)
              : null}
            {activeTab === "signIn" && appSignInPanel
              ? appSignInPanel({ nodeId, nodeName, closeDialog: () => onOpenChange(false) })
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
  const locale = useCoreLocale();
  // This tab writes name + description + icon in ONE operation, so its copy is
  // "save", not "rename". The `rename` block's strings are still the right ones
  // for the surfaces that really are just a rename — the mobile
  // `NodeRenameSheet` and the Base Design tab both still use them — which is
  // why they live on rather than being repointed here.
  const t = messages.nodeSettings;
  const queryClient = useQueryClient();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const availableAirAppEngines = useAirAppEngineAvailability();
  const airAppEnginePlanGate = useAirAppEnginePlanGate();
  const notConfiguredAirAppEngines = useAirAppEnginesNotConfigured();
  // The saved override now lives on the NODE, not in this browser. It used to
  // be `localStorage`, which made "which engine this AirApp runs on" a property
  // of whoever happened to be looking at it: two people opening the same node
  // got different answers, and the choice did not travel with the node the way
  // every other node setting does.
  const savedEngine = detail?.node.settings?.airappEngine ?? null;

  const [name, setName] = useState(nodeName);
  // Seeded from `detail`, not the `nodeSlug` prop: a page reached by node id
  // passes the id there, and the sidebar entry points pass nothing.
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<NodeIcon | null>(null);
  const [iconDirty, setIconDirty] = useState(false);
  const [runnerKind, setRunnerKind] = useState<AirAppEngineChoice>(FOLLOW_APP);
  /** `null` until the person changes the select. The saved slug is shown until then. */
  const [defaultViewDraft, setDefaultViewDraft] = useState<string | null>(null);
  /** What `airapp.json` asks for, so "follow the app" can name it. */
  const [appPreferred, setAppPreferred] = useState<AirAppRunnerKind | undefined>(undefined);
  const [appRequired, setAppRequired] = useState<AirAppRunnerKind | undefined>(undefined);
  /** The raw `airapp.json`, kept so the runtime is resolved the way a run resolves it. */
  const [appManifest, setAppManifest] = useState<string | undefined>(undefined);
  const hydratedRef = useRef(false);
  const runnerKindDirtyRef = useRef(false);
  const [location, setLocation] = useLocation();
  const search = useSearch();

  const updateSettings = useMutation(orpc.nodes.updateSettings.mutationOptions());
  // Hosts and tests sometimes hand this dialog a client that only implements
  // the node writes. The view list is optional in that case: the field stays
  // on "loading" rather than throwing while the rest of the form still works.
  const listBaseViews = orpc.bases?.listViews;
  const viewsQuery = useQuery({
    ...(listBaseViews
      ? listBaseViews.queryOptions({ input: { baseId: nodeId } })
      : {
          queryKey: ["busabase", "node-settings", "views", nodeId],
          queryFn: async () => [],
        }),
    enabled: open && nodeType === "base" && Boolean(listBaseViews),
  });

  const savedDefaultViewChoice = (() => {
    if (!viewsQuery.isSuccess) return LEFTMOST_VIEW;
    const saved = detail?.node.settings?.defaultViewSlug;
    return saved && viewsQuery.data.some((view) => view.slug === saved) ? saved : LEFTMOST_VIEW;
  })();
  const defaultViewChoice = defaultViewDraft ?? savedDefaultViewChoice;

  /**
   * Persist the system settings this dialog edits.
   *
   * The endpoint replaces the whole object, so a save of one key has to send
   * the other one too or it wipes it. `null` clears a key — "follow the app"
   * for the engine, "leftmost tab" for the default view. The server drops the
   * null rather than storing a sentinel.
   */
  const persistNodeSettings = async () => {
    const defaultViewDirty = defaultViewDraft !== null;
    if (!runnerKindDirtyRef.current && !defaultViewDirty) return;
    const current = detail?.node.settings;
    await updateSettings.mutateAsync({
      nodeId,
      settings: {
        airappEngine: runnerKindDirtyRef.current
          ? runnerKind === FOLLOW_APP
            ? null
            : runnerKind
          : (current?.airappEngine ?? null),
        defaultViewSlug: defaultViewDirty
          ? defaultViewChoice === LEFTMOST_VIEW
            ? null
            : defaultViewChoice
          : (current?.defaultViewSlug ?? null),
      },
    });
  };

  // Reset local edit state whenever the dialog opens for a (possibly new) node.
  useEffect(() => {
    if (!open) {
      hydratedRef.current = false;
      return;
    }
    setName(nodeName);
    runnerKindDirtyRef.current = false;
    setDefaultViewDraft(null);
    setAppPreferred(undefined);
    setAppRequired(undefined);
    setAppManifest(undefined);
  }, [open, nodeName]);

  // Adopt the node's saved override once the shared `nodes.get` fetch resolves,
  // unless the user has already changed this dialog's draft.
  useEffect(() => {
    if (!open || runnerKindDirtyRef.current) return;
    setRunnerKind(
      savedEngine
        ? resolveAvailableAirAppRunnerKind(savedEngine, availableAirAppEngines)
        : FOLLOW_APP,
    );
  }, [availableAirAppEngines, open, savedEngine]);

  // Read what the app itself asks for, so "follow the app" names a concrete
  // engine. Without this the dialog could say "follow the app" while
  // `airapp.json` said `remote` — the same "the screen does not match what will
  // happen" problem this control exists to end.
  useEffect(() => {
    if (!open || nodeType !== "airapp") return;
    let cancelled = false;
    void (async () => {
      try {
        const manifest = await orpc.fileTrees.readFile.call({
          nodeId,
          filePath: AIRAPP_MANIFEST_PATH,
          type: "airapp",
        });
        if (cancelled || manifest.encoding !== "utf8") return;
        const parsedManifest = parseAirAppManifest(manifest.content);
        setAppPreferred(parsedManifest.preferredEngine);
        setAppRequired(parsedManifest.requiredEngine);
        setAppManifest(manifest.content);
      } catch {
        // No manifest, or an unreadable one. "Follow the app" then simply means
        // the default — which is exactly what it will do.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nodeId, nodeType, open, orpc]);

  // Which runtime the app is, from the same inputs the Run panel uses (the
  // file listing's marker files plus `airapp.json`), so "follow the app" can
  // name the engine a run lands on — a Python app never falls back to the
  // browser. `undefined` until both are known; the field then assumes Node.
  const appRuntime = useMemo<AirAppRuntimeKind | undefined>(() => {
    if (nodeType !== "airapp" || !detail || !("files" in detail)) return undefined;
    const probeFiles: Record<string, string> = {};
    for (const file of detail.files) probeFiles[file.path] = "";
    if (appManifest !== undefined) probeFiles[AIRAPP_MANIFEST_PATH] = appManifest;
    try {
      return resolveRunPlan(probeFiles).runtime;
    } catch {
      return undefined;
    }
  }, [appManifest, detail, nodeType]);

  // Seed slug/description/icon once the shared `nodes.get` fetch resolves — guarded
  // so a background refetch never clobbers an in-progress edit.
  useEffect(() => {
    if (!open || hydratedRef.current || !detail) return;
    setSlug(detail.node.slug);
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
  const isSaving = createCr.isPending;

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

  const nextSlug = slug.trim();
  // Only once hydrated — before that the field is empty because nothing has
  // loaded yet, not because the user cleared it.
  const slugMissing = !!detail && !nextSlug;

  const submit = async (options?: { mergeImmediately?: boolean }) => {
    const trimmed = name.trim();
    // Same gate as the button's `disabled` — Enter in a field bypasses it.
    if (!trimmed || !nextSlug || !detail) return;
    const currentSlug = detail.node.slug;
    // Only sent when it changed: the slug is the node's address, so a Save that
    // only touched the description must not re-assert it.
    const slugChanged = nextSlug !== currentSlug;
    try {
      // The intent goes to the endpoint, which applies it in the same request.
      // Omitting it let the permission-aware default answer BOTH modes the same
      // way, so "submit for review" renamed the node on the spot and then said a
      // request was waiting.
      const changeRequest = await createCr.mutateAsync({
        autoMerge: options?.mergeImmediately === true,
        operations: [
          {
            kind: "rename",
            nodeId,
            name: trimmed,
            ...(slugChanged ? { slug: nextSlug } : {}),
            description,
            ...(iconDirty ? { icon } : {}),
          },
        ],
      });
      if (runnerKindDirtyRef.current || defaultViewDraft !== null) await persistNodeSettings();
      // A merged slug change retires the url this page was reached by. Move to
      // the new one BEFORE invalidating, so the refetch runs against the new
      // slug rather than 404ing the old one on screen; `replace`, so Back does
      // not lead to a dead address. Settings opened from the sidebar for a node
      // that is not on screen leaves the location alone.
      const slugMerged = changeRequest.status === "merged" && slugChanged;
      if (slugMerged) {
        const movedLocation = replaceNodeRouteSlug(location, nodeType, currentSlug, nextSlug);
        if (movedLocation) {
          setLocation(search ? `${movedLocation}?${search}` : movedLocation, { replace: true });
        }
      }
      // The slug is baked into every list that links here — the parent
      // folder's children, Home, search — and those queries are keyed by THEIR
      // node, not this one, so the id/slug sweep misses them. A stale name
      // there is cosmetic; a stale slug is a link to nothing. Slug changes are
      // rare, so refresh everything, same as a template install does.
      await (slugMerged ? queryClient.invalidateQueries() : invalidateNodes());
      // Report what happened, not what was asked for.
      if (changeRequest.status === "merged") {
        toast.success(t.saved);
        onRenamed?.(trimmed);
        onClose();
        return;
      }
      toast.success(t.changeRequestSubmitted);
      onClose();
    } catch (err) {
      toast.error(presentCoreError(messages, locale, err, t.saveFailed));
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
        <Label htmlFor="node-settings-slug">{messages.common.slug}</Label>
        <Input
          aria-describedby="node-settings-slug-hint"
          aria-invalid={slugMissing}
          id="node-settings-slug"
          onChange={(e) => setSlug(toSlugInput(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit({ mergeImmediately: true });
          }}
          placeholder={messages.createNode.slugPlaceholder}
          value={slug}
        />
        <p
          className={`text-xs ${slugMissing ? "text-destructive" : "text-muted-foreground"}`}
          id="node-settings-slug-hint"
        >
          {slugMissing ? messages.createNode.slugRequired : t.slugHint}
        </p>
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

      {nodeType === "base" ? (
        <div className="space-y-2">
          <Label htmlFor="node-settings-default-view">{t.defaultViewLabel}</Label>
          {viewsQuery.isPending ? (
            <p className="text-muted-foreground text-xs">{t.defaultViewLoading}</p>
          ) : viewsQuery.isError ? (
            <p className="text-destructive text-xs">{t.defaultViewLoadFailed}</p>
          ) : (
            <Select
              disabled={!detail}
              onValueChange={(next) => {
                setDefaultViewDraft(next);
              }}
              value={defaultViewChoice}
            >
              <SelectTrigger id="node-settings-default-view">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={LEFTMOST_VIEW}>{t.defaultViewLeftmost}</SelectItem>
                {(viewsQuery.data ?? []).map((view) => (
                  <SelectItem key={view.id} value={view.slug}>
                    {view.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-muted-foreground text-xs" id="node-settings-default-view-hint">
            {t.defaultViewHint}
          </p>
        </div>
      ) : null}

      {nodeType === "airapp" ? (
        <AirAppEngineSetting
          appPreferred={appPreferred}
          appRequired={appRequired}
          appRuntime={appRuntime}
          availableEngines={availableAirAppEngines}
          disabled={!detail}
          onValueChange={(next) => {
            runnerKindDirtyRef.current = true;
            setRunnerKind(next);
          }}
          notConfiguredEngines={notConfiguredAirAppEngines}
          planGate={airAppEnginePlanGate}
          value={runnerKind}
        />
      ) : null}
      {nodeType === "airapp" &&
      resolveEffectiveEngineChoice(runnerKind, appPreferred, appRequired) === "site" &&
      (availableAirAppEngines.includes("site") ||
        airAppEnginePlanGate?.lockedEngines.includes("site")) ? (
        <AirAppSiteSettings nodeId={nodeId} orpc={orpc} />
      ) : null}

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
          disabled={isSaving || !name.trim() || !nextSlug || !detail}
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
