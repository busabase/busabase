import { skipToken, useQuery } from "@tanstack/react-query";
import type {
  HtmlDocument,
  WhiteboardDocument,
  WorkflowDocument,
  WorkflowNode,
} from "busabase-contract/domains/rich-node/types";
import type { NodeVO } from "busabase-contract/types";
import { asNodeDetail } from "busabase-core/dashboard/node-detail";
import { useLocalSearchParams } from "expo-router";
import { CircleCheck, CodeXml, Eye, GitBranch, Play, Timer, Workflow } from "lucide-react-native";
import { useState } from "react";
import { Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { WebView } from "react-native-webview";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
  NativeSegmentedControl,
} from "~/components/native-screen";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { getAppNavigationLayout } from "~/domains/workspace/utils/responsive-layout";
import { mobile, radius, spacing } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { WhiteboardCanvasPreview, WorkflowCanvasPreview } from "./RichNodeCanvasPreviews";

type RichNodeType = "whiteboard" | "workflow" | "html";

interface RichNodeDetailScreenProps {
  type: RichNodeType;
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

function WorkflowListPreview({ document }: { document: WorkflowDocument }) {
  const tokens = useTokens();

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

function HtmlPreview({ node, document }: { node: NodeVO; document: HtmlDocument }) {
  const tokens = useTokens();
  const { height } = useWindowDimensions();
  const [tab, setTab] = useState<"preview" | "source">("preview");
  const workspaceHeight = Math.max(
    420,
    height - (mobile.headerHeight ?? 52) - spacing[10] - spacing[6],
  );

  return (
    <View style={styles.htmlWorkspace}>
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
      {tab === "preview" ? (
        <View style={[styles.webviewWrap, { height: workspaceHeight, borderColor: tokens.border }]}>
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
        <View
          style={[styles.sourceWrap, { minHeight: workspaceHeight, backgroundColor: tokens.muted }]}
        >
          <Text selectable style={[styles.source, { color: tokens.foreground }]}>
            {document.source}
          </Text>
        </View>
      )}
    </View>
  );
}

const TYPE_LABELS: Record<RichNodeType, string> = {
  whiteboard: "Whiteboard",
  workflow: "Workflow",
  html: "HTML",
};

function RichNodeDetailContent({ type }: RichNodeDetailScreenProps) {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const { width, height } = useWindowDimensions();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const buda = useBusabaseOrpc();
  const detailQuery = useQuery(
    buda && nodeId
      ? buda.orpc.nodes.get.queryOptions({ input: { nodeId, type } })
      : { queryKey: ["no-connection", "rich-node", type, nodeId], queryFn: skipToken },
  );
  // `nodes.get` answers for every node type, so narrow before reading `.document`.
  // A non-matching result (a slug shared with another type) must NOT render a
  // preview seeded with the wrong document shape.
  const detail = asNodeDetail(detailQuery.data, type);
  const navigationLayout = getAppNavigationLayout(width, height);

  return (
    <DrawerScaffold
      title={detail?.node.name ?? TYPE_LABELS[type]}
      titleNumberOfLines={2}
      subtitle={detail?.node.description || undefined}
      contentContainerStyle={
        type === "workflow" && !navigationLayout.persistentSidebar ? undefined : styles.canvasScreen
      }
      refreshing={detailQuery.isRefetching}
      onRefresh={() => void detailQuery.refetch()}
    >
      {detailQuery.isLoading ? <NativeLoadingState label={`Loading ${TYPE_LABELS[type]}`} /> : null}
      {detailQuery.error ? (
        <NativeErrorState
          message={detailQuery.error.message}
          onRetry={() => void detailQuery.refetch()}
        />
      ) : null}
      {!detailQuery.isLoading && !detailQuery.error && !detail ? (
        <NativeEmptyState title={`${TYPE_LABELS[type]} not found`} />
      ) : null}
      {/* `detail` was resolved via `asNodeDetail(data, type)` where `type` is this
          component's runtime prop, not a literal — so `detail.document` stays the
          full whiteboard|workflow|html union here even under a sibling
          `type === "…"` check; TS cannot correlate a later comparison of `type`
          back to the union member `detail` was already built from. Each branch's
          cast narrows to the member the surrounding `type === "…"` check already
          guarantees at runtime. */}
      {detail && type === "whiteboard" ? (
        <WhiteboardCanvasPreview document={detail.document as WhiteboardDocument} />
      ) : null}
      {detail && type === "workflow" ? (
        navigationLayout.persistentSidebar ? (
          <WorkflowCanvasPreview document={detail.document as WorkflowDocument} />
        ) : (
          <WorkflowListPreview document={detail.document as WorkflowDocument} />
        )
      ) : null}
      {detail && type === "html" ? (
        <HtmlPreview document={detail.document as HtmlDocument} node={detail.node} />
      ) : null}
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
  canvasScreen: { flexGrow: 1, paddingBottom: 0 },
  workflowMarker: {
    width: 28,
    height: 28,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  htmlWorkspace: { flex: 1 },
  segmentWrap: { paddingHorizontal: spacing[5], paddingVertical: spacing[3] },
  webviewWrap: {
    marginHorizontal: spacing[5],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  sourceWrap: {
    marginHorizontal: spacing[5],
    padding: spacing[4],
  },
  source: { fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
});
