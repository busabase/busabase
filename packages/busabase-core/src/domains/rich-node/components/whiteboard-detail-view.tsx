"use client";

import "@excalidraw/excalidraw/index.css";

import type { NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  EMPTY_WHITEBOARD_DOCUMENT,
  type WhiteboardDocument,
} from "busabase-contract/domains/rich-node/types";
import { useEffect, useRef, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import {
  FullscreenPreviewSurface,
  PreviewFullscreenButton,
  usePreviewFullscreen,
} from "../../dashboard/components/preview-fullscreen";
import {
  NodeDetailSkeleton,
  WhiteboardContentSkeleton,
} from "../../dashboard/components/skeletons";
import { asNodeDetail } from "../../dashboard/helpers/node-detail";
import { useReportLoadedNode } from "../../dashboard/hooks/use-report-loaded-node";
import type { NodeDetailProps } from "../../dashboard/node-detail-registry";
import type { SidePanelTabProps } from "../../dashboard/side-panel-registry";
import { useIsAnonymousVisitor } from "../../dashboard/visitor-context";
import {
  RichNodeNotFound,
  RichNodeShell,
  useNodeContentSave,
  useServerDocumentSync,
} from "./rich-node-shell";

type ExcalidrawModule = typeof import("@excalidraw/excalidraw");
/** `updateScene` takes a slightly fuller AppState than `initialData` does. */
type UpdateScenePayload = Parameters<ExcalidrawImperativeAPI["updateScene"]>[0];

const persistentAppState = (appState: AppState): Record<string, unknown> => ({
  gridSize: appState.gridSize,
  gridStep: appState.gridStep,
  theme: appState.theme,
  viewBackgroundColor: appState.viewBackgroundColor,
});

function useExcalidrawModule() {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const [excalidraw, setExcalidraw] = useState<ExcalidrawModule | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    import("@excalidraw/excalidraw")
      .then((module) => {
        if (active) setExcalidraw(module);
      })
      .catch((caught: unknown) => {
        if (active) {
          setEditorError(
            presentCoreError(messages, locale, caught, messages.inbox.loadFailedTitle),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [locale, messages]);

  return { editorError, excalidraw };
}

function WhiteboardCanvas({
  document,
  editorError,
  excalidraw,
  name,
  onApi,
  onChange,
  readOnly,
}: {
  document: WhiteboardDocument;
  editorError: string | null;
  excalidraw: ExcalidrawModule | null;
  name: string;
  onApi?: (api: ExcalidrawImperativeAPI) => void;
  onChange?: (elements: readonly NonDeletedExcalidrawElement[], appState: AppState) => void;
  readOnly: boolean;
}) {
  const locale = useCoreLocale();
  const Editor = excalidraw?.Excalidraw ?? null;

  return (
    <div
      className="h-full w-full bg-muted/20"
      data-read-only={readOnly ? "true" : "false"}
      data-whiteboard-canvas=""
    >
      {editorError ? (
        <div className="flex h-full items-center justify-center text-rejected-strong text-sm">
          {editorError}
        </div>
      ) : Editor ? (
        <Editor
          UIOptions={{
            canvasActions: { loadScene: false, saveToActiveFile: false },
            tools: { image: false },
          }}
          autoFocus={!readOnly}
          excalidrawAPI={onApi}
          handleKeyboardGlobally={false}
          initialData={{
            elements: document.elements as ExcalidrawInitialDataState["elements"],
            appState: document.appState as ExcalidrawInitialDataState["appState"],
            scrollToContent: true,
          }}
          langCode={locale}
          name={name}
          viewModeEnabled={readOnly}
          onChange={onChange}
        />
      ) : (
        <WhiteboardContentSkeleton />
      )}
    </div>
  );
}

interface WhiteboardDetailViewProps {
  orpc: BusabaseQueryUtils;
  slug: string | null;
  onNodeLoaded?: NodeDetailProps["onNodeLoaded"];
}

export function WhiteboardDetailView({ orpc, slug, onNodeLoaded }: WhiteboardDetailViewProps) {
  const messages = useCoreI18n();
  const isAnonymous = useIsAnonymousVisitor();
  const fullscreenState = usePreviewFullscreen({ syncWithUrl: true });
  const detailQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: slug ?? "", type: "whiteboard" } }),
    enabled: Boolean(slug),
  });
  const detail = asNodeDetail(detailQuery.isError ? undefined : detailQuery.data, "whiteboard");
  useReportLoadedNode(detail?.node, onNodeLoaded);
  const node = detail?.node ?? null;
  const initialScene = detail?.document ?? EMPTY_WHITEBOARD_DOCUMENT;
  const sceneRef = useRef<WhiteboardDocument>(initialScene);
  const savedSceneRef = useRef(JSON.stringify(initialScene));
  const sceneInitializedRef = useRef(false);
  // The whole module, not just the component: `restoreElements` below is what
  // makes an externally-written scene safe to hand to `updateScene`.
  const { editorError, excalidraw } = useExcalidrawModule();
  const [editorApi, setEditorApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const { error, markDirty, save, status } = useNodeContentSave(orpc, node, "whiteboard");

  // Excalidraw is uncontrolled — `initialData` below is read once, at mount —
  // so a scene that changed on the server (another tab, an agent's OpenAPI
  // `PATCH /nodes/{nodeId}/metadata`) has to be pushed in explicitly via
  // `updateScene`. `useServerDocumentSync` owns the "is this safe to apply"
  // decision; here we only re-baseline the local refs alongside it so the next
  // `onChange` doesn't immediately read as dirty against the old scene.
  useServerDocumentSync({
    apply: (scene: WhiteboardDocument) => {
      sceneRef.current = scene;
      savedSceneRef.current = JSON.stringify(scene);
      sceneInitializedRef.current = false;
      if (!editorApi || !excalidraw) return;
      editorApi.updateScene({
        appState: scene.appState as UpdateScenePayload["appState"],
        // `initialData` is normalized by Excalidraw itself at mount, but
        // `updateScene` takes elements verbatim — so a scene written through
        // the API with only the fields a human would bother typing
        // (`{id,type,x,y,width,height}`) has to be restored to full elements
        // here. Skipping this doesn't just look wrong, it corrupts the
        // viewport: verified live, the missing numeric props made
        // `scrollToContent` compute NaN and the zoom indicator read "NaN%".
        elements: excalidraw.restoreElements(
          scene.elements as ExcalidrawInitialDataState["elements"],
          null,
        ) as UpdateScenePayload["elements"],
      });
      // Re-fit the viewport onto the incoming drawing. `updateScene` swaps the
      // elements but leaves the scroll/zoom fitted to what USED to be on the
      // canvas, so without this the update lands off-screen and reads as "the
      // whiteboard just went blank" — verified: the canvas showed only
      // Excalidraw's own "Scroll back to content" button.
      if (scene.elements.length > 0) {
        requestAnimationFrame(() => {
          editorApi.scrollToContent(undefined, {
            animate: false,
            fitToViewport: true,
            viewportZoomFactor: 0.82,
          });
        });
      }
    },
    getLocalDocument: () => sceneRef.current,
    node,
    serverDocument: initialScene,
    status,
  });

  useEffect(() => {
    if (!editorApi || initialScene.elements.length === 0) return;
    const frame = requestAnimationFrame(() => {
      editorApi.scrollToContent(undefined, {
        animate: false,
        fitToViewport: true,
        viewportZoomFactor: 0.82,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [editorApi, initialScene.elements.length]);

  if (!detail) {
    return detailQuery.isLoading ? (
      <NodeDetailSkeleton />
    ) : (
      <RichNodeNotFound type={messages.nodeDetail.whiteboard} />
    );
  }

  const saveScene = async () => {
    if (await save(sceneRef.current)) savedSceneRef.current = JSON.stringify(sceneRef.current);
  };

  return (
    <RichNodeShell
      error={error ?? editorError}
      fullscreenState={fullscreenState}
      node={detail.node}
      nodeType="whiteboard"
      onSave={saveScene}
      orpc={orpc}
      status={status}
    >
      <WhiteboardCanvas
        document={initialScene}
        editorError={editorError}
        excalidraw={excalidraw}
        key={detail.node.id}
        name={detail.node.name}
        onApi={setEditorApi}
        readOnly={isAnonymous}
        onChange={(elements, appState) => {
          const nextScene: WhiteboardDocument = {
            version: 1,
            elements: elements.filter((element) => element.type !== "image"),
            appState: persistentAppState(appState),
          };
          sceneRef.current = nextScene;
          if (!sceneInitializedRef.current) {
            sceneInitializedRef.current = true;
            savedSceneRef.current = JSON.stringify(nextScene);
            return;
          }
          if (JSON.stringify(nextScene) !== savedSceneRef.current) markDirty();
        }}
      />
    </RichNodeShell>
  );
}

/** Read-only Excalidraw preview kept mounted by the Side Panel tab host. */
export function WhiteboardSidePanelPreview({ orpc, payload }: SidePanelTabProps) {
  const messages = useCoreI18n();
  const { nodeId } = payload as { nodeId: string };
  const fullscreenState = usePreviewFullscreen();
  const { editorError, excalidraw } = useExcalidrawModule();
  const detailQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId, type: "whiteboard" } }),
    enabled: Boolean(nodeId),
  });
  const detail = asNodeDetail(detailQuery.isError ? undefined : detailQuery.data, "whiteboard");

  if (!detail) {
    return detailQuery.isLoading ? (
      <NodeDetailSkeleton />
    ) : (
      <RichNodeNotFound type={messages.nodeDetail.whiteboard} />
    );
  }

  return (
    <FullscreenPreviewSurface
      aria-label={fmt(messages.richNodes.previewFrame, { name: detail.node.name })}
      data-visual-node-preview="whiteboard"
      exitLabel={messages.airapp.exitFullscreen}
      fullscreenState={fullscreenState}
      toolbar={
        <div className="flex min-h-11 items-center justify-between gap-2 border-border/60 border-b px-4 py-2">
          <span className="font-medium text-muted-foreground text-xs uppercase">
            {messages.nodeDetail.whiteboard}
          </span>
          <PreviewFullscreenButton
            fullscreenState={fullscreenState}
            label={messages.airapp.enterFullscreen}
          />
        </div>
      }
    >
      <WhiteboardCanvas
        document={detail.document}
        editorError={editorError}
        excalidraw={excalidraw}
        name={detail.node.name}
        readOnly
      />
    </FullscreenPreviewSurface>
  );
}
