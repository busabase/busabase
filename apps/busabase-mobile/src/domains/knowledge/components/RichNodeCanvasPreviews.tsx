import type {
  WhiteboardDocument,
  WorkflowDocument,
  WorkflowNode,
} from "busabase-contract/domains/rich-node/types";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  Marker,
  Path,
  Pattern,
  Polygon,
  Polyline,
  Rect,
  Text as SvgText,
  TSpan,
} from "react-native-svg";
import { getAppNavigationLayout } from "~/domains/workspace/utils/responsive-layout";
import { mobile, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import {
  buildWorkflowCanvasLayout,
  getWhiteboardSceneBounds,
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
} from "../utils/rich-node-layout";

const MIN_CANVAS_HEIGHT = 420;
const MAX_CANVAS_HEIGHT = 680;
const WHITEBOARD_ARROW_SIZE = 8;
const WORKFLOW_ARROW_SIZE = 7;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberValue = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const stringValue = (value: unknown, fallback: string): string =>
  typeof value === "string" && value ? value : fallback;

const shapeColor = (value: unknown, fallback: string): string => {
  const color = stringValue(value, fallback);
  return color === "transparent" ? "none" : color;
};

const linePoints = (element: Record<string, unknown>): string => {
  const x = numberValue(element.x);
  const y = numberValue(element.y);
  if (!Array.isArray(element.points)) return "";
  return element.points
    .filter((point): point is unknown[] => Array.isArray(point))
    .map((point) => `${x + numberValue(point[0])},${y + numberValue(point[1])}`)
    .join(" ");
};

function WhiteboardElement({ value, fallbackColor }: { value: unknown; fallbackColor: string }) {
  if (!isRecord(value) || value.isDeleted === true) return null;
  const id = stringValue(value.id, `${numberValue(value.x)}:${numberValue(value.y)}`);
  const type = stringValue(value.type, "unknown");
  const x = numberValue(value.x);
  const y = numberValue(value.y);
  const width = Math.max(0, numberValue(value.width));
  const height = Math.max(0, numberValue(value.height));
  const stroke = shapeColor(value.strokeColor, fallbackColor);
  const fill = shapeColor(value.backgroundColor, "none");
  const strokeWidth = Math.max(1, numberValue(value.strokeWidth, 1.5));
  const opacity = Math.min(1, Math.max(0, numberValue(value.opacity, 100) / 100));

  if (type === "text") {
    const fontSize = Math.max(10, numberValue(value.fontSize, 16));
    const lines = stringValue(value.text, "").split("\n");
    const lineCounts = new Map<string, number>();
    const labeledLines = lines.map((line) => {
      const occurrence = lineCounts.get(line) ?? 0;
      lineCounts.set(line, occurrence + 1);
      return { key: `${id}:${line}:${occurrence}`, line };
    });
    return (
      <SvgText
        key={id}
        x={x}
        y={y + fontSize}
        fill={stroke}
        fontFamily="System"
        fontSize={fontSize}
        opacity={opacity}
      >
        {labeledLines.map((entry, index) => (
          <TSpan key={entry.key} x={x} dy={index === 0 ? 0 : fontSize * 1.3}>
            {entry.line}
          </TSpan>
        ))}
      </SvgText>
    );
  }

  if (type === "ellipse") {
    return (
      <Ellipse
        key={id}
        cx={x + width / 2}
        cy={y + height / 2}
        rx={width / 2}
        ry={height / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
      />
    );
  }

  if (type === "diamond") {
    return (
      <Polygon
        key={id}
        points={`${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
      />
    );
  }

  if (type === "line" || type === "arrow") {
    return (
      <Polyline
        key={id}
        points={linePoints(value)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
        markerEnd={type === "arrow" ? "url(#whiteboard-arrow)" : undefined}
      />
    );
  }

  if (type === "freedraw") {
    return (
      <Polyline
        key={id}
        points={linePoints(value)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
      />
    );
  }

  return (
    <Rect
      key={id}
      x={x}
      y={y}
      width={width}
      height={height}
      rx={value.roundness ? 10 : 0}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={opacity}
    />
  );
}

export function WhiteboardCanvasPreview({ document }: { document: WhiteboardDocument }) {
  const tokens = useTokens();
  const { width, height } = useWindowDimensions();
  const navigationLayout = getAppNavigationLayout(width, height);
  const canvasWidth = Math.max(320, width - navigationLayout.sidebarWidth);
  const canvasHeight = Math.max(
    MIN_CANVAS_HEIGHT,
    Math.min(MAX_CANVAS_HEIGHT, height - (mobile.headerHeight ?? 52) - spacing[6]),
  );
  const bounds = useMemo(() => getWhiteboardSceneBounds(document.elements), [document.elements]);
  const backgroundColor = stringValue(document.appState.viewBackgroundColor, tokens.background);

  return (
    <View
      accessibilityLabel={`Whiteboard canvas, ${document.elements.length} elements`}
      style={[styles.canvas, { width: canvasWidth, height: canvasHeight, backgroundColor }]}
    >
      <Svg
        width={canvasWidth}
        height={canvasHeight}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
        preserveAspectRatio="xMidYMin meet"
      >
        <Defs>
          <Pattern id="whiteboard-grid" width={20} height={20} patternUnits="userSpaceOnUse">
            <Circle cx={1} cy={1} r={1} fill={tokens.mutedForeground} opacity={0.22} />
          </Pattern>
          <Marker
            id="whiteboard-arrow"
            markerWidth={WHITEBOARD_ARROW_SIZE}
            markerHeight={WHITEBOARD_ARROW_SIZE}
            refX={WHITEBOARD_ARROW_SIZE}
            refY={WHITEBOARD_ARROW_SIZE / 2}
            orient="auto"
          >
            <Path
              d={`M0,0 L0,${WHITEBOARD_ARROW_SIZE} L${WHITEBOARD_ARROW_SIZE},${WHITEBOARD_ARROW_SIZE / 2} z`}
              fill={tokens.foreground}
            />
          </Marker>
        </Defs>
        <Rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          fill="url(#whiteboard-grid)"
        />
        {document.elements.map((element, index) => (
          <WhiteboardElement
            key={isRecord(element) && typeof element.id === "string" ? element.id : index}
            value={element}
            fallbackColor={tokens.foreground}
          />
        ))}
      </Svg>
      {document.elements.length === 0 ? (
        <View style={styles.emptyCanvas}>
          <Text style={[typography.body, { color: tokens.mutedForeground }]}>Empty whiteboard</Text>
        </View>
      ) : null}
    </View>
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

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

export function WorkflowCanvasPreview({ document }: { document: WorkflowDocument }) {
  const tokens = useTokens();
  const { width, height } = useWindowDimensions();
  const navigationLayout = getAppNavigationLayout(width, height);
  const viewportWidth = Math.max(320, width - navigationLayout.sidebarWidth);
  const viewportHeight = Math.max(420, height - (mobile.headerHeight ?? 52) - spacing[6]);
  const layout = useMemo(() => buildWorkflowCanvasLayout(document), [document]);
  const canvasWidth = Math.max(viewportWidth, layout.width);
  const canvasHeight = Math.max(viewportHeight, layout.height);

  return (
    <View
      style={[
        styles.workflowViewport,
        { height: viewportHeight, backgroundColor: tokens.background },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        contentContainerStyle={{ width: canvasWidth, height: canvasHeight }}
      >
        <Svg width={canvasWidth} height={canvasHeight}>
          <Defs>
            <Pattern id="workflow-grid" width={20} height={20} patternUnits="userSpaceOnUse">
              <Circle cx={1} cy={1} r={1} fill={tokens.mutedForeground} opacity={0.2} />
            </Pattern>
            <Marker
              id="workflow-arrow"
              markerWidth={WORKFLOW_ARROW_SIZE}
              markerHeight={WORKFLOW_ARROW_SIZE}
              refX={WORKFLOW_ARROW_SIZE}
              refY={WORKFLOW_ARROW_SIZE / 2}
              orient="auto"
            >
              <Path
                d={`M0,0 L0,${WORKFLOW_ARROW_SIZE} L${WORKFLOW_ARROW_SIZE},${WORKFLOW_ARROW_SIZE / 2} z`}
                fill={tokens.mutedForeground}
              />
            </Marker>
          </Defs>
          <Rect width={canvasWidth} height={canvasHeight} fill="url(#workflow-grid)" />
          {document.edges.map((edge) => {
            const source = layout.nodes.get(edge.source);
            const target = layout.nodes.get(edge.target);
            if (!source || !target) return null;
            const sourceX = source.x + WORKFLOW_NODE_WIDTH;
            const sourceY = source.y + WORKFLOW_NODE_HEIGHT / 2;
            const targetX = target.x;
            const targetY = target.y + WORKFLOW_NODE_HEIGHT / 2;
            const controlOffset = Math.max(48, Math.abs(targetX - sourceX) / 2);
            return (
              <G key={edge.id}>
                <Path
                  d={`M ${sourceX} ${sourceY} C ${sourceX + controlOffset} ${sourceY}, ${targetX - controlOffset} ${targetY}, ${targetX} ${targetY}`}
                  fill="none"
                  stroke={tokens.mutedForeground}
                  strokeWidth={1.5}
                  opacity={0.55}
                  markerEnd="url(#workflow-arrow)"
                />
                {edge.label ? (
                  <SvgText
                    x={(sourceX + targetX) / 2}
                    y={(sourceY + targetY) / 2 - spacing[2]}
                    textAnchor="middle"
                    fill={tokens.mutedForeground}
                    fontFamily="System"
                    fontSize={11}
                  >
                    {truncate(edge.label, 22)}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
          {document.nodes.map((node) => {
            const position = layout.nodes.get(node.id);
            if (!position) return null;
            return (
              <G
                key={node.id}
                accessible
                accessibilityLabel={`${node.label}, ${node.kind}, ${node.description || workflowNodeMeta(node)}`}
              >
                <Rect
                  x={position.x}
                  y={position.y}
                  width={WORKFLOW_NODE_WIDTH}
                  height={WORKFLOW_NODE_HEIGHT}
                  fill={tokens.card}
                  stroke={tokens.border}
                  strokeWidth={1}
                />
                <Line
                  x1={position.x}
                  y1={position.y + 36}
                  x2={position.x + WORKFLOW_NODE_WIDTH}
                  y2={position.y + 36}
                  stroke={tokens.border}
                  strokeWidth={1}
                />
                <SvgText
                  x={position.x + spacing[3]}
                  y={position.y + 23}
                  fill={tokens.foreground}
                  fontFamily="System"
                  fontSize={13}
                  fontWeight="600"
                >
                  {truncate(node.label, 25)}
                </SvgText>
                <SvgText
                  x={position.x + WORKFLOW_NODE_WIDTH - spacing[3]}
                  y={position.y + 22}
                  textAnchor="end"
                  fill={tokens.mutedForeground}
                  fontFamily="System"
                  fontSize={9}
                >
                  {node.kind.toUpperCase()}
                </SvgText>
                <SvgText
                  x={position.x + spacing[3]}
                  y={position.y + 59}
                  fill={tokens.mutedForeground}
                  fontFamily="System"
                  fontSize={11}
                >
                  {truncate(node.description || workflowNodeMeta(node), 34)}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </ScrollView>
      <View style={[styles.workflowBadge, { backgroundColor: tokens.background }]}>
        <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
          {document.nodes.length} steps · {document.edges.length} connections
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { overflow: "hidden" },
  emptyCanvas: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  workflowViewport: { position: "relative", overflow: "hidden" },
  workflowBadge: {
    position: "absolute",
    left: spacing[4],
    top: spacing[3],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
});
