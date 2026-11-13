"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { HtmlDocument } from "busabase-contract/domains/rich-node/types";
import type { NodeVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { Eye, FileCode2 } from "lucide-react";
import { registerPopstateInterceptor } from "openlib/ui/dashboard";
import { useEffect, useRef, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { NodeActionsMenu } from "../../dashboard/components/node-actions-menu";
import { NodeAgentPromptsButton } from "../../dashboard/components/node-agent-prompts-button";
import { NodePinButton, nodeSidePanelTabId } from "../../dashboard/components/node-pin-button";
import {
  FullscreenPreviewSurface,
  PREVIEW_DETAIL_TAB_LIST_CLASS,
  PREVIEW_DETAIL_TAB_TRIGGER_CLASS,
  PreviewFullscreenButton,
  type PreviewFullscreenState,
  usePreviewFullscreen,
} from "../../dashboard/components/preview-fullscreen";
import { NodeDetailSkeleton } from "../../dashboard/components/skeletons";
import { asNodeDetail } from "../../dashboard/helpers/node-detail";
import { useRegisterTopbarNodeActions } from "../../dashboard/hooks/use-register-topbar-node-actions";
import { useRegisterTopbarNodeInfo } from "../../dashboard/hooks/use-register-topbar-node-info";
import { useReportLoadedNode } from "../../dashboard/hooks/use-report-loaded-node";
import type { NodeDetailProps } from "../../dashboard/node-detail-registry";
import type { SidePanelTabProps } from "../../dashboard/side-panel-registry";
import { useIsAnonymousVisitor } from "../../dashboard/visitor-context";
import { useWorkbenchLinkResolver } from "../../dashboard/workbench-link-context";
import {
  buildHtmlPreviewDocument,
  resolveHtmlPreviewNavigation,
} from "../utils/html-preview-navigation";
import {
  RichNodeNotFound,
  RichNodeReviewLink,
  richNodeActionClusterClass,
  richNodeSaveStatusLabel,
  useNodeContentSave,
  useServerDocumentSync,
} from "./rich-node-shell";

const historyPositionKey = "__busabaseHtmlHistoryPosition";
const readHistoryPosition = (state: unknown = window.history.state) => {
  const position =
    state && typeof state === "object" && historyPositionKey in state
      ? state[historyPositionKey]
      : null;
  return typeof position === "number" && Number.isSafeInteger(position) ? position : null;
};
let historyGuard: {
  current: ((event: PopStateEvent) => void) | null;
  protect?: (event: PopStateEvent) => void;
  position?: number;
  restoringPosition?: number | null;
  trackingLegacyHistory?: boolean;
} = { current: null };
const nativeHistoryNavigation = () => {
  const navigation = window.navigation;
  return !historyGuard.trackingLegacyHistory &&
    readHistoryPosition() === null &&
    typeof navigation?.addEventListener === "function" &&
    typeof navigation.removeEventListener === "function" &&
    navigation.currentEntry?.url === window.location.href
    ? navigation
    : null;
};
if (typeof window !== "undefined") {
  // Keep the forwarding cell through development hot reloads. The shared
  // browser-location module installs the listener before router subscriptions.
  const key = Symbol.for("busabase.html-history-guard");
  const registry = window as unknown as Record<symbol, typeof historyGuard | undefined>;
  const existing = registry[key];
  if (existing) {
    historyGuard = existing;
  } else {
    registry[key] = historyGuard;
  }
  registerPopstateInterceptor((event) => historyGuard.current?.(event));
  if (historyGuard.position === undefined) {
    const storedPosition = readHistoryPosition();
    historyGuard.position = storedPosition ?? window.navigation?.currentEntry?.index ?? 0;
    historyGuard.trackingLegacyHistory = nativeHistoryNavigation() === null;
    historyGuard.restoringPosition = null;
    let writingPosition = false;
    const stampPosition = () => {
      if (
        !historyGuard.trackingLegacyHistory ||
        writingPosition ||
        readHistoryPosition() === historyGuard.position
      )
        return;
      const state: unknown = window.history.state;
      if (state !== null && typeof state !== "object") return;
      writingPosition = true;
      try {
        // Preserve Next.js and other callers' state; wouter already emits these
        // events, so no second History API patch is needed.
        window.history.replaceState({ ...state, [historyPositionKey]: historyGuard.position }, "");
      } finally {
        writingPosition = false;
      }
    };
    window.addEventListener("pushState", () => {
      if (writingPosition) return;
      historyGuard.position = (historyGuard.position ?? 0) + 1;
      // A partially implemented Navigation API can leave currentEntry at the
      // previous URL. Use the fallback before trusting its cancellation.
      if (!nativeHistoryNavigation()) historyGuard.trackingLegacyHistory = true;
      stampPosition();
    });
    window.addEventListener("replaceState", () => {
      if (writingPosition) return;
      if (!nativeHistoryNavigation()) historyGuard.trackingLegacyHistory = true;
      stampPosition();
    });
    historyGuard.current = (event) => {
      if (!historyGuard.trackingLegacyHistory) return;
      const destinationPosition = readHistoryPosition(event.state);
      if (historyGuard.restoringPosition !== null) {
        // The router never saw the rejected destination. Keep the restoration
        // traversal private too, and never ask the same question a second time.
        event.stopImmediatePropagation();
        historyGuard.position = destinationPosition ?? historyGuard.restoringPosition;
        historyGuard.restoringPosition = null;
        stampPosition();
        return;
      }
      historyGuard.protect?.(event);
      if (historyGuard.restoringPosition !== null) return;
      // The dashboard loads this module before SPA navigation. An untagged
      // same-document entry therefore predates its initial tagged entry.
      historyGuard.position = destinationPosition ?? (historyGuard.position ?? 0) - 1;
      stampPosition();
    };
    stampPosition();
  }
}

/** The sandboxed HTML preview frame; also Home's welcome card when the welcome page is HTML. */
export function HtmlPreviewSurface({
  fullscreenState,
  node,
  showToolbar = false,
  source,
}: {
  fullscreenState: PreviewFullscreenState;
  node: NodeVO;
  showToolbar?: boolean;
  source: string;
}) {
  const messages = useCoreI18n();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const resolveWorkbenchLink = useWorkbenchLinkResolver();
  const [preview, setPreview] = useState<{ sessionId: string; document: string } | null>(null);
  useEffect(() => {
    const sessionId = crypto.randomUUID();
    let navigating = false;
    const onMessage = (event: MessageEvent) => {
      // Opaque origins all serialize as "null"; origin alone is not identity.
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.origin !== "null" ||
        navigating ||
        !navigator.userActivation?.isActive
      )
        return;
      const navigation = resolveHtmlPreviewNavigation({
        data: event.data,
        sessionId,
        currentHref: window.location.href,
        resolveWorkbenchLink,
      });
      if (!navigation) return;
      if (navigation.inPlace) {
        navigating = true;
        // A document navigation loads the destination's permissions and AirApp
        // runtime on the server, including public/shared entry points.
        window.location.assign(navigation.href);
      } else {
        // The frame's trusted click activates its ancestors too. Do not await:
        // open during that transient activation to preserve popup permissions.
        window.open(navigation.href, "_blank", "noopener,noreferrer");
      }
    };
    window.addEventListener("message", onMessage);
    setPreview({
      sessionId,
      document: buildHtmlPreviewDocument(source, { parentHref: window.location.href, sessionId }),
    });
    return () => window.removeEventListener("message", onMessage);
  }, [source, resolveWorkbenchLink]);
  return (
    <FullscreenPreviewSurface
      aria-label={fmt(messages.richNodes.previewFrame, { name: node.name })}
      bodyClassName="bg-background p-0"
      data-html-fullscreen={fullscreenState.fullscreen ? "true" : "false"}
      data-html-preview=""
      exitLabel={messages.airapp.exitFullscreen}
      fullscreenState={fullscreenState}
      toolbar={
        showToolbar ? (
          <div className="flex min-h-11 items-center justify-between gap-2 border-border/60 border-b px-4 py-2">
            <span className="font-medium text-muted-foreground text-xs uppercase">
              {messages.richNodes.preview}
            </span>
            <PreviewFullscreenButton
              fullscreenState={fullscreenState}
              label={messages.airapp.enterFullscreen}
            />
          </div>
        ) : null
      }
    >
      <iframe
        key={preview?.sessionId ?? "loading"}
        ref={frameRef}
        allowFullScreen
        className="block h-full w-full border-0 bg-card"
        // New tabs need their own origin/COOP context; this preview remains
        // opaque and cannot read the workbench's cookies or DOM.
        sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts"
        srcDoc={preview?.document}
        title={fmt(messages.richNodes.previewFrame, { name: node.name })}
      />
    </FullscreenPreviewSurface>
  );
}

interface HtmlEditorProps {
  document: HtmlDocument;
  node: NodeVO;
  orpc: BusabaseQueryUtils;
}

function HtmlEditor({ document: htmlDocument, node, orpc }: HtmlEditorProps) {
  const messages = useCoreI18n();
  const isAnonymous = useIsAnonymousVisitor();
  const [isEditing, setIsEditing] = useState(false);
  const [source, setSource] = useState(htmlDocument.source);
  const [baseline, setBaseline] = useState(htmlDocument.source);
  const [submittedSource, setSubmittedSource] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState("source");
  const fullscreenState = usePreviewFullscreen({ syncWithUrl: true });
  const { error, markDirty, reset, reviewRequestId, save, status } = useNodeContentSave(
    orpc,
    node,
    "html",
  );
  const dirty = isEditing && source !== baseline;
  const saving = status === "saving";
  const reviewing = status === "in_review" || status === "approved";

  // Reading always uses the published document. A background update may refresh
  // a clean editor, but cannot replace unsaved work or an unmerged proposal.
  useServerDocumentSync({
    apply: (document: HtmlDocument) => {
      setSource(document.source);
      setBaseline(document.source);
    },
    getLocalDocument: () => ({ version: 1 as const, source }),
    node,
    serverDocument: htmlDocument,
    status,
  });

  useEffect(() => {
    if (isEditing && submittedSource !== null && status === "saved" && source === submittedSource) {
      setIsEditing(false);
      setSubmittedSource(null);
    }
  }, [isEditing, source, status, submittedSource]);

  // Match the existing record editor's protection for refresh and link navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Fullscreen rewrites the URL, so refresh the protected history entry too.
  useEffect(() => {
    if (!dirty && !saving) return;
    const currentHref = window.location.href;
    const currentHistoryPosition = historyGuard.position ?? 0;
    const navigation =
      typeof window.navigation?.addEventListener === "function" &&
      typeof window.navigation.removeEventListener === "function"
        ? window.navigation
        : null;
    const mayLeave = () => !saving && window.confirm(messages.richNodes.discardChanges);
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const confirmNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.download ||
        (anchor.target && anchor.target !== "_self")
      )
        return;
      const target = new URL(anchor.href, window.location.href);
      if (target.href === window.location.href || target.protocol === "javascript:") return;
      if (!mayLeave()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const confirmTraversal = (event: NavigateEvent) => {
      if (
        !nativeHistoryNavigation() ||
        event.navigationType !== "traverse" ||
        !event.destination.sameDocument ||
        !event.cancelable ||
        new URL(event.destination.url).pathname === new URL(currentHref).pathname
      )
        return;
      // Intercept before the URL changes or a router can discard the draft.
      if (!mayLeave()) event.preventDefault();
    };
    const confirmHistoryNavigation = (event: PopStateEvent) => {
      if (new URL(window.location.href).pathname === new URL(currentHref).pathname) return;
      if (!mayLeave()) {
        event.stopImmediatePropagation();
        const destinationPosition = readHistoryPosition(event.state) ?? currentHistoryPosition - 1;
        historyGuard.restoringPosition = currentHistoryPosition;
        // Traverse back to the protected entry, in either direction. Appending
        // an entry here would truncate Forward and change the meaning of Back.
        window.history.go(currentHistoryPosition - destinationPosition);
      }
    };
    window.addEventListener("beforeunload", warn);
    // Keep both entry points ready: a later History API write can reveal a
    // partial Navigation API without causing another React render.
    navigation?.addEventListener("navigate", confirmTraversal);
    historyGuard.protect = confirmHistoryNavigation;
    document.addEventListener("click", confirmNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      navigation?.removeEventListener("navigate", confirmTraversal);
      if (historyGuard.protect === confirmHistoryNavigation) historyGuard.protect = undefined;
      document.removeEventListener("click", confirmNavigation, true);
    };
  }, [dirty, fullscreenState.fullscreen, messages.richNodes.discardChanges, saving]);

  const finishEditing = () => {
    if (saving || (dirty && !window.confirm(messages.richNodes.discardChanges))) return;
    setIsEditing(false);
    setSource(htmlDocument.source);
    setBaseline(htmlDocument.source);
    setSubmittedSource(null);
    reset();
  };
  const saveDraft = async () => {
    const submitted = source;
    if (await save({ version: 1, source: submitted })) {
      setBaseline(submitted);
      setSubmittedSource(submitted);
    }
  };
  const fullscreenButton = (
    <PreviewFullscreenButton
      fullscreenState={fullscreenState}
      label={messages.airapp.enterFullscreen}
    />
  );

  useRegisterTopbarNodeActions(
    isAnonymous ? null : (
      <div className={richNodeActionClusterClass} data-rich-node-actions="">
        {fullscreenButton}
        {isEditing ? (
          <>
            <Button disabled={saving} onClick={finishEditing} size="sm" variant="outline">
              {reviewing && !dirty ? messages.richNodes.returnToReading : messages.common.cancel}
            </Button>
            <Button
              disabled={saving || (!dirty && (!reviewRequestId || reviewing))}
              onClick={saveDraft}
              size="sm"
              title={messages.richNodes.save}
            >
              {saving ? messages.richNodes.saving : messages.richNodes.save}
            </Button>
          </>
        ) : (
          <Button
            onClick={() => {
              reset();
              setSource(htmlDocument.source);
              setBaseline(htmlDocument.source);
              setSubmittedSource(null);
              setSelectedTab("source");
              setIsEditing(true);
            }}
            size="sm"
            variant="outline"
          >
            {messages.common.edit}
          </Button>
        )}
        <NodeAgentPromptsButton orpc={orpc} nodeId={node.id} nodeName={node.name} nodeType="html" />
        <NodePinButton
          payload={{ nodeId: node.id }}
          tabId={nodeSidePanelTabId("html", node.id)}
          tabType="html-preview"
          title={node.name}
        />
        <NodeActionsMenu
          nodeId={node.id}
          nodeName={node.name}
          nodeSlug={node.slug}
          nodeType="html"
          orpc={orpc}
        />
      </div>
    ),
    true,
    isAnonymous ? fullscreenButton : null,
  );
  useRegisterTopbarNodeInfo({
    description: node.description,
    nodeId: node.id,
    nodeName: node.name,
    nodeSlug: node.slug,
    nodeType: "html",
    orpc,
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        onValueChange={setSelectedTab}
        value={isEditing && !fullscreenState.fullscreen ? selectedTab : "preview"}
      >
        {isEditing ? (
          <header className="flex shrink-0 flex-wrap items-center gap-2 border-border/60 border-b px-4 py-2">
            <TabsList className={PREVIEW_DETAIL_TAB_LIST_CLASS}>
              <TabsTrigger className={PREVIEW_DETAIL_TAB_TRIGGER_CLASS} value="preview">
                <Eye className="size-3.5" />
                {messages.richNodes.preview}
              </TabsTrigger>
              <TabsTrigger className={PREVIEW_DETAIL_TAB_TRIGGER_CLASS} value="source">
                <FileCode2 className="size-3.5" />
                {messages.richNodes.source}
              </TabsTrigger>
            </TabsList>
            {error || dirty || saving || reviewRequestId ? (
              <span
                className={error ? "text-destructive text-xs" : "text-muted-foreground text-xs"}
                data-rich-node-save-status=""
                role={error ? "alert" : "status"}
              >
                {error ?? richNodeSaveStatusLabel(status, messages)}
              </span>
            ) : null}
            {reviewRequestId ? <RichNodeReviewLink requestId={reviewRequestId} /> : null}
          </header>
        ) : null}
        <TabsContent className="m-0 min-h-0 flex-1" value="preview">
          <HtmlPreviewSurface
            fullscreenState={fullscreenState}
            node={node}
            source={isEditing ? source : htmlDocument.source}
          />
        </TabsContent>
        {isEditing ? (
          <TabsContent className="m-0 min-h-0 flex-1" value="source">
            <textarea
              aria-label={messages.richNodes.htmlSource}
              className="h-full w-full resize-none border-0 bg-background p-4 font-mono text-foreground text-sm leading-6 outline-none"
              onChange={(event) => {
                setSource(event.target.value);
                markDirty();
              }}
              spellCheck={false}
              value={source}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

interface HtmlDetailViewProps {
  orpc: BusabaseQueryUtils;
  slug: string | null;
  onNodeLoaded?: NodeDetailProps["onNodeLoaded"];
}

export function HtmlDetailView({ orpc, slug, onNodeLoaded }: HtmlDetailViewProps) {
  const messages = useCoreI18n();
  const detailQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: slug ?? "", type: "html" } }),
    enabled: Boolean(slug),
  });
  const detail = asNodeDetail(detailQuery.isError ? undefined : detailQuery.data, "html");
  useReportLoadedNode(detail?.node, onNodeLoaded);

  if (!detail) {
    return detailQuery.isLoading ? (
      <NodeDetailSkeleton />
    ) : (
      <RichNodeNotFound type={messages.nodeDetail.html} />
    );
  }

  // Keyed by node id so switching between two HTML nodes — or this query
  // resolving after an initial render with no data yet — always mounts a
  // fresh editor seeded from that node's real document, instead of reusing
  // an instance whose `source` state was already seeded from a different
  // (or placeholder) document.
  return (
    <HtmlEditor document={detail.document} key={detail.node.id} node={detail.node} orpc={orpc} />
  );
}

/** Read-only HTML preview kept mounted by the side-panel tab host. */
export function HtmlSidePanelPreview({ orpc, payload }: SidePanelTabProps) {
  const messages = useCoreI18n();
  const { nodeId } = payload as { nodeId: string };
  const fullscreenState = usePreviewFullscreen();
  const detailQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId, type: "html" } }),
    enabled: Boolean(nodeId),
  });
  const detail = asNodeDetail(detailQuery.isError ? undefined : detailQuery.data, "html");

  if (!detail) {
    return detailQuery.isLoading ? (
      <NodeDetailSkeleton />
    ) : (
      <RichNodeNotFound type={messages.nodeDetail.html} />
    );
  }

  return (
    <HtmlPreviewSurface
      fullscreenState={fullscreenState}
      node={detail.node}
      showToolbar
      source={detail.document.source}
    />
  );
}
