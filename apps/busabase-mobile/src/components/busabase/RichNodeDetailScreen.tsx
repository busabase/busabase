import { skipToken, useQuery } from "@tanstack/react-query";
import {
  parseHtmlDocument,
  parseWhiteboardDocument,
  parseWorkflowDocument,
  type WorkflowNode,
} from "busabase-contract/domains/rich-node/types";
import type { NodeVO } from "busabase-contract/types";
import { useLocalSearchParams } from "expo-router";
import { CircleCheck, CodeXml, Eye, GitBranch, Play, Timer, Workflow } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
  NativeSegmentedControl,
} from "~/components/native-screen";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

type RichNodeType = "whiteboard" | "workflow" | "html";

interface RichNodeDetailScreenProps {
  type: RichNodeType;
}

const findNodeById = (nodes: NodeVO[], nodeId: string): NodeVO | null => {
  for (const node of nodes) {
    if (node.id === nodeId || node.slug === nodeId) return node;
    const child = findNodeById(node.children, nodeId);
    if (child) return child;
  }
  return null;
};

const whiteboardText = (element: unknown): { id: string; text: string } | null => {
  if (!element || typeof element !== "object") return null;
  const candidate = element as Record<string, unknown>;
  if (candidate.type !== "text" || candidate.isDeleted === true) return null;
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  if (!text) return null;
  const id = typeof candidate.id === "string" ? candidate.id : text;
  return { id, text };
};

function WhiteboardPreview({ node }: { node: NodeVO }) {
  const tokens = useTokens();
  const document = useMemo(
    () => parseWhiteboardDocument(node.metadata.whiteboardDocument),
    [node.metadata.whiteboardDocument],
  );
  const labels = document.elements
    .map(whiteboardText)
    .filter((label): label is { id: string; text: string } => !!label);
  const [boardTitle, ...notes] = labels;

  return (
    <NativeSection title="Canvas" caption={`${document.elements.length} elements`}>
      {labels.length > 0 ? (
        <View style={styles.canvasGrid}>
          {boardTitle ? (
            <Text selectable style={[typography.h3, { color: tokens.foreground }]}>
              {boardTitle.text}
            </Text>
          ) : null}
          <View style={styles.canvasNotes}>
            {notes.map((label) => (
              <View
                key={label.id}
                style={[
                  styles.canvasNote,
                  { backgroundColor: tokens.surface, borderColor: tokens.border },
                ]}
              >
                <Text selectable style={[typography.bodyEm, { color: tokens.foreground }]}>
                  {label.text}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <NativeEmptyState title="Empty whiteboard" />
      )}
    </NativeSection>
  );
}

const workflowNodeMeta = (node: WorkflowNode): string => {
  switch (node.kind) {
    case "trigger":
      return node.eventName;
    case "webhook":
      return `${node.method} ${node.url || "Not configured"}`;
    case "function":
      return node.functionName || "Function not configured";
    case "condition":
      return node.expression || "Condition not configured";
    case "wait":
      return `${node.duration} ${node.unit}`;
    case "approval":
      return node.approver || "Approver not configured";
    case "action":
      return node.actionName || "Action not configured";
    case "end":
      return node.outcome;
  }
};

const workflowIcon = (kind: WorkflowNode["kind"]) => {
  if (kind === "trigger") return Play;
  if (kind === "condition") return GitBranch;
  if (kind === "wait") return Timer;
  if (kind === "end") return CircleCheck;
  return Workflow;
};

function WorkflowPreview({ node }: { node: NodeVO }) {
  const tokens = useTokens();
  const document = useMemo(
    () => parseWorkflowDocument(node.metadata.workflowDocument),
    [node.metadata.workflowDocument],
  );

  return (
    <NativeSection
      title="Flow"
      caption={`${document.nodes.length} · ${document.settings.executionMode}`}
    >
      {document.nodes.map((step, index) => {
        const Icon = workflowIcon(step.kind);
        return (
          <NativeRow
            key={step.id}
            title={step.label}
            subtitle={step.description || workflowNodeMeta(step)}
            meta={`${index + 1}`}
            leading={
              <View style={[styles.workflowMarker, { backgroundColor: tokens.primaryMuted }]}>
                <Icon size={16} color={tokens.foreground} />
              </View>
            }
            last={index === document.nodes.length - 1}
          />
        );
      })}
    </NativeSection>
  );
}

function HtmlPreview({ node }: { node: NodeVO }) {
  const tokens = useTokens();
  const [tab, setTab] = useState<"preview" | "source">("preview");
  const document = useMemo(
    () => parseHtmlDocument(node.metadata.htmlDocument),
    [node.metadata.htmlDocument],
  );

  return (
    <>
      <View style={styles.segmentWrap}>
        <NativeSegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { value: "preview", label: "Preview", Icon: Eye },
            { value: "source", label: "Source", Icon: CodeXml },
          ]}
        />
      </View>
      <NativeSection title={tab === "preview" ? "Page" : "HTML"} style={styles.htmlSection}>
        {tab === "preview" ? (
          <View style={[styles.webviewWrap, { borderColor: tokens.border }]}>
            {Platform.OS === "web" ? (
              <iframe
                sandbox="allow-forms allow-modals allow-scripts"
                srcDoc={document.source}
                style={{
                  width: "100%",
                  height: "100%",
                  border: 0,
                  backgroundColor: tokens.surface,
                }}
                title={`${node.name} preview`}
              />
            ) : (
              <WebView
                javaScriptEnabled
                originWhitelist={["*"]}
                source={{ html: document.source }}
                style={{ backgroundColor: tokens.surface }}
              />
            )}
          </View>
        ) : (
          <View style={[styles.sourceWrap, { backgroundColor: tokens.muted }]}>
            <Text selectable style={[styles.source, { color: tokens.foreground }]}>
              {document.source}
            </Text>
          </View>
        )}
      </NativeSection>
    </>
  );
}

const TYPE_LABELS: Record<RichNodeType, string> = {
  whiteboard: "Whiteboard",
  workflow: "Workflow",
  html: "HTML",
};

function RichNodeDetailContent({ type }: RichNodeDetailScreenProps) {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const buda = useBusabaseOrpc();
  const nodesQuery = useQuery(
    buda && nodeId
      ? buda.orpc.nodes.list.queryOptions()
      : { queryKey: ["no-connection", "rich-node", type, nodeId], queryFn: skipToken },
  );
  const node = useMemo(
    () => findNodeById(nodesQuery.data ?? [], nodeId),
    [nodeId, nodesQuery.data],
  );
  const validNode = node?.type === type ? node : null;

  return (
    <DrawerScaffold
      title={validNode?.name ?? TYPE_LABELS[type]}
      titleNumberOfLines={2}
      subtitle={validNode?.description || undefined}
      contentContainerStyle={type === "html" ? styles.htmlScreen : undefined}
      refreshing={nodesQuery.isRefetching}
      onRefresh={() => void nodesQuery.refetch()}
    >
      {nodesQuery.isLoading ? <NativeLoadingState label={`Loading ${TYPE_LABELS[type]}`} /> : null}
      {nodesQuery.error ? (
        <NativeErrorState
          message={nodesQuery.error.message}
          onRetry={() => void nodesQuery.refetch()}
        />
      ) : null}
      {!nodesQuery.isLoading && !nodesQuery.error && !validNode ? (
        <NativeEmptyState title={`${TYPE_LABELS[type]} not found`} />
      ) : null}
      {validNode && type === "whiteboard" ? <WhiteboardPreview node={validNode} /> : null}
      {validNode && type === "workflow" ? <WorkflowPreview node={validNode} /> : null}
      {validNode && type === "html" ? <HtmlPreview node={validNode} /> : null}
    </DrawerScaffold>
  );
}

export function RichNodeDetailScreen(props: RichNodeDetailScreenProps) {
  return (
    <ConnectionGuard>
      <RichNodeDetailContent {...props} />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  canvasGrid: { paddingHorizontal: spacing[5], paddingVertical: spacing[4], gap: spacing[3] },
  canvasNotes: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3] },
  canvasNote: {
    minWidth: 132,
    minHeight: 92,
    flexBasis: "46%",
    flexGrow: 1,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  workflowMarker: {
    width: 28,
    height: 28,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  htmlScreen: { flexGrow: 1 },
  htmlSection: { flex: 1 },
  segmentWrap: { paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  webviewWrap: {
    flex: 1,
    minHeight: 420,
    marginHorizontal: spacing[5],
    marginVertical: spacing[4],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  sourceWrap: {
    flex: 1,
    minHeight: 420,
    marginHorizontal: spacing[5],
    marginVertical: spacing[4],
    borderRadius: radius.md,
    padding: spacing[4],
  },
  source: { fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
});
