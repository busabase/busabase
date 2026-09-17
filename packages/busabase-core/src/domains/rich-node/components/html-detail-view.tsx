"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { HtmlDocument } from "busabase-contract/domains/rich-node/types";
import type { NodeVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { CodeXml, Eye, FileCode2, Info, Save } from "lucide-react";
import { useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { NodeActionsMenu } from "../../dashboard/components/node-actions-menu";
import { NodeAgentPromptsButton } from "../../dashboard/components/node-agent-prompts-button";
import { NodePinButton, nodeSidePanelTabId } from "../../dashboard/components/node-pin-button";
import { NodeSettingsDialog } from "../../dashboard/components/node-settings-dialog";
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
import { useReportLoadedNode } from "../../dashboard/hooks/use-report-loaded-node";
import type { NodeDetailProps } from "../../dashboard/node-detail-registry";
import type { SidePanelTabProps } from "../../dashboard/side-panel-registry";
import { useIsAnonymousVisitor } from "../../dashboard/visitor-context";
import { RichNodeNotFound, useNodeContentSave, useServerDocumentSync } from "./rich-node-shell";

function HtmlPreviewSurface({
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
  return (
    <FullscreenPreviewSurface
      aria-label={fmt(messages.richNodes.previewFrame, { name: node.name })}
      bodyClassName={fullscreenState.fullscreen ? "bg-background p-0" : "bg-muted/20 p-3"}
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
        className={
          fullscreenState.fullscreen
            ? "h-full w-full border-0 bg-card"
            : "h-full w-full border border-border bg-card"
        }
        // `allow-popups` only lets the frame open a new, separate tab — it
        // grants no access back into this origin, so it's safe alongside
        // deliberately omitting `allow-same-origin`.
        sandbox="allow-forms allow-modals allow-popups allow-scripts"
        srcDoc={source}
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
  const [source, setSource] = useState(htmlDocument.source);
  const [selectedTab, setSelectedTab] = useState("preview");
  const [infoOpen, setInfoOpen] = useState(false);
  const fullscreenState = usePreviewFullscreen({ syncWithUrl: true });
  const { error, markDirty, save, status } = useNodeContentSave(orpc, node, "html");
  // Seed only after the real node document loads, then reconcile later updates
  // from another tab or an agent without replacing unsaved local edits.
  useServerDocumentSync({
    apply: (document: HtmlDocument) => setSource(document.source),
    getLocalDocument: () => ({ version: 1 as const, source }),
    node,
    serverDocument: htmlDocument,
    status,
  });

  const statusLabel =
    status === "saving"
      ? messages.richNodes.saving
      : status === "saved"
        ? messages.richNodes.saved
        : messages.richNodes.unsaved;

  useRegisterTopbarNodeActions(
    isAnonymous ? null : (
      <>
        <span
          className={
            status === "error"
              ? "hidden max-w-48 truncate text-destructive text-xs sm:block"
              : "hidden text-muted-foreground text-xs sm:block"
          }
          title={error ?? statusLabel}
        >
          {error ?? statusLabel}
        </span>
        <NodePinButton
          payload={{ nodeId: node.id }}
          tabId={nodeSidePanelTabId("html", node.id)}
          tabType="html-preview"
          title={node.name}
        />
        <PreviewFullscreenButton
          fullscreenState={fullscreenState}
          label={messages.airapp.enterFullscreen}
          onEnter={() => setSelectedTab("preview")}
        />
        <NodeAgentPromptsButton orpc={orpc} nodeId={node.id} nodeName={node.name} nodeType="html" />
        <NodeActionsMenu
          nodeId={node.id}
          nodeName={node.name}
          nodeSlug={node.slug}
          nodeType="html"
          orpc={orpc}
        />
        <Button
          aria-label={messages.richNodes.save}
          disabled={status === "saving" || status === "saved"}
          onClick={() => save({ version: 1, source })}
          size="icon-sm"
          title={messages.richNodes.save}
          type="button"
          variant="default"
        >
          <Save className="size-3.5" />
        </Button>
      </>
    ),
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        onValueChange={setSelectedTab}
        value={fullscreenState.fullscreen ? "preview" : selectedTab}
      >
        <header className="shrink-0 border-border/60 border-b px-4 pt-5 pb-2 md:px-6">
          <div className="flex min-w-0 items-start gap-2">
            <CodeXml className="mt-1 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-semibold text-foreground text-xl leading-7">
                {node.name}
              </h1>
              {node.description ? (
                <p
                  className="mt-1 line-clamp-2 text-muted-foreground text-sm leading-5 md:line-clamp-1"
                  title={node.description}
                >
                  {node.description}
                </p>
              ) : null}
            </div>
            <Button
              aria-label={messages.nodeDetail.details}
              className="shrink-0 text-muted-foreground"
              onClick={() => setInfoOpen(true)}
              size="icon-sm"
              title={messages.nodeDetail.details}
              type="button"
              variant="ghost"
            >
              <Info className="size-3.5" />
            </Button>
            {infoOpen ? (
              <NodeSettingsDialog
                initialTab="info"
                nodeId={node.id}
                nodeName={node.name}
                nodeSlug={node.slug}
                nodeType="html"
                onOpenChange={setInfoOpen}
                open
                orpc={orpc}
              />
            ) : null}
          </div>
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
        </header>
        <TabsContent className="m-0 min-h-0 flex-1" value="preview">
          <HtmlPreviewSurface fullscreenState={fullscreenState} node={node} source={source} />
        </TabsContent>
        <TabsContent className="m-0 min-h-0 flex-1" value="source">
          <textarea
            aria-label={messages.richNodes.htmlSource}
            className="h-full w-full resize-none border-0 bg-background p-4 font-mono text-foreground text-sm leading-6 outline-none"
            onChange={(event) => {
              setSource(event.target.value);
              markDirty();
            }}
            spellCheck={false}
            readOnly={isAnonymous}
            value={source}
          />
        </TabsContent>
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
