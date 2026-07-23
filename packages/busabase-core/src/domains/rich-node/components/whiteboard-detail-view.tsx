"use client";

import "@excalidraw/excalidraw/index.css";

import type {
  AppState,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  parseWhiteboardDocument,
  type WhiteboardDocument,
} from "busabase-contract/domains/rich-node/types";
import type { NodeVO } from "busabase-contract/types";
import { PenTool } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { useReportLoadedNode } from "../../dashboard/hooks/use-report-loaded-node";
import type { NodeDetailProps } from "../../dashboard/node-detail-registry";
import { findNode, RichNodeNotFound, RichNodeShell, useNodeMetadataSave } from "./rich-node-shell";

type ExcalidrawComponent = typeof import("@excalidraw/excalidraw").Excalidraw;

const persistentAppState = (appState: AppState): Record<string, unknown> => ({
  gridSize: appState.gridSize,
  gridStep: appState.gridStep,
  theme: appState.theme,
  viewBackgroundColor: appState.viewBackgroundColor,
});

interface WhiteboardDetailViewProps {
  nodes?: NodeVO[];
  orpc: BusabaseQueryUtils;
  slug: string | null;
  onNodeLoaded?: NodeDetailProps["onNodeLoaded"];
}

export function WhiteboardDetailView({
  nodes,
  orpc,
  slug,
  onNodeLoaded,
}: WhiteboardDetailViewProps) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const node = useMemo(() => findNode(nodes ?? [], "whiteboard", slug), [nodes, slug]);
  useReportLoadedNode(node, onNodeLoaded);
  const initialScene = useMemo(
    () => parseWhiteboardDocument(node?.metadata.whiteboardDocument),
    [node?.metadata.whiteboardDocument],
  );
  const sceneRef = useRef<WhiteboardDocument>(initialScene);
  const savedSceneRef = useRef(JSON.stringify(initialScene));
  const sceneInitializedRef = useRef(false);
  const [Editor, setEditor] = useState<ExcalidrawComponent | null>(null);
  const [editorApi, setEditorApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const { error, markDirty, save, status } = useNodeMetadataSave(orpc, node, "whiteboardDocument");

  useEffect(() => {
    let active = true;
    import("@excalidraw/excalidraw")
      .then((module) => {
        if (active) setEditor(() => module.Excalidraw);
      })
      .catch((caught: unknown) => {
        if (active) {
          setEditorError(
            caught instanceof Error ? caught.message : messages.richNodes.whiteboardLoading,
          );
        }
      });
    return () => {
      active = false;
    };
  }, [messages.richNodes.whiteboardLoading]);

  useEffect(() => {
    sceneRef.current = initialScene;
    savedSceneRef.current = JSON.stringify(initialScene);
    sceneInitializedRef.current = false;
  }, [initialScene]);

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

  if (!node) return <RichNodeNotFound type="Whiteboard" />;

  const saveScene = async () => {
    if (await save(sceneRef.current)) savedSceneRef.current = JSON.stringify(sceneRef.current);
  };

  return (
    <RichNodeShell
      error={error ?? editorError}
      icon={PenTool}
      node={node}
      nodeType="whiteboard"
      onSave={saveScene}
      orpc={orpc}
      status={status}
    >
      <div className="h-full w-full bg-muted/20">
        {Editor ? (
          <Editor
            UIOptions={{
              canvasActions: { loadScene: false, saveToActiveFile: false },
              tools: { image: false },
            }}
            autoFocus
            excalidrawAPI={setEditorApi}
            handleKeyboardGlobally={false}
            initialData={{
              elements: initialScene.elements as ExcalidrawInitialDataState["elements"],
              appState: initialScene.appState as ExcalidrawInitialDataState["appState"],
              scrollToContent: true,
            }}
            key={node.id}
            langCode={locale}
            name={node.name}
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
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            {editorError ?? messages.richNodes.whiteboardLoading}
          </div>
        )}
      </div>
    </RichNodeShell>
  );
}
