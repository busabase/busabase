import type { BaseVO } from "busabase-core/types";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, G, Line, Marker, Path, Text as SvgText } from "react-native-svg";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const GRAPH_BG = "#0d0d12";
const NODE_COLOR = "#6366f1";
const NODE_COLOR_ISOLATED = "#4b4b6b";
const EDGE_COLOR = "#4444aa";
const LABEL_COLOR = "#94a3b8";
const NODE_R = 18;
const ARROW_SIZE = 6;

interface SimNode {
  id: string;
  name: string;
  slug: string;
  x?: number;
  y?: number;
}

interface ResolvedLink {
  source: SimNode;
  target: SimNode;
  fieldName: string;
}

function buildLayout(
  bases: BaseVO[],
  width: number,
  height: number,
): { nodes: SimNode[]; links: ResolvedLink[]; edgeCount: number } {
  if (bases.length === 0) return { nodes: [], links: [], edgeCount: 0 };

  const cx = width / 2;
  const cy = height / 2;

  const nodes: SimNode[] = bases.map((b, i) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    // Spread initial positions around center to avoid degenerate start
    x: cx + Math.cos((2 * Math.PI * i) / bases.length) * 80,
    y: cy + Math.sin((2 * Math.PI * i) / bases.length) * 80,
  }));

  const baseIds = new Set(bases.map((b) => b.id));
  // d3-force mutates these link objects: source/target become node refs after tick
  const rawLinks: Array<{ source: string | SimNode; target: string | SimNode; fieldName: string }> =
    [];
  for (const base of bases) {
    for (const field of base.fields) {
      if (
        field.type === "relation" &&
        field.options.targetBaseId &&
        baseIds.has(field.options.targetBaseId)
      ) {
        rawLinks.push({
          source: base.id,
          target: field.options.targetBaseId,
          fieldName: field.name,
        });
      }
    }
  }

  const sim = forceSimulation(nodes)
    .force(
      "link",
      forceLink<SimNode, (typeof rawLinks)[0]>(rawLinks)
        .id((d) => d.id)
        .distance(120),
    )
    .force("charge", forceManyBody().strength(-320))
    .force("center", forceCenter(cx, cy))
    .force("collide", forceCollide(NODE_R + 18))
    .stop();
  sim.tick(350);

  // Clamp positions to canvas bounds
  const pad = NODE_R + 30;
  for (const node of nodes) {
    node.x = Math.max(pad, Math.min(width - pad, node.x ?? cx));
    node.y = Math.max(pad, Math.min(height - pad, node.y ?? cy));
  }

  // After tick, rawLinks[i].source / .target are SimNode objects (d3 resolved them)
  const links = (rawLinks as unknown as ResolvedLink[]).filter((l) => l.source && l.target);
  return { nodes, links, edgeCount: links.length };
}

interface BaseGraphProps {
  bases: BaseVO[];
  width: number;
  height: number;
  onNodePress: (slug: string) => void;
}

export function BaseGraph({ bases, width, height, onNodePress }: BaseGraphProps) {
  const tokens = useTokens();
  const { nodes, links, edgeCount } = useMemo(
    () => buildLayout(bases, width, height),
    [bases, width, height],
  );

  return (
    <View style={[styles.container, { width, height, backgroundColor: GRAPH_BG }]}>
      {/* Header badge */}
      <View style={styles.badge}>
        <View style={[styles.dot, { backgroundColor: NODE_COLOR }]} />
        <Text style={[typography.caption, { color: LABEL_COLOR }]}>
          {bases.length} bases · {edgeCount} relations
        </Text>
      </View>

      {bases.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[typography.body, { color: tokens.mutedForeground }]}>No bases yet</Text>
        </View>
      ) : (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            {/* Arrowhead marker for directed edges */}
            <Marker
              id="arrow"
              markerWidth={ARROW_SIZE}
              markerHeight={ARROW_SIZE}
              refX={NODE_R + ARROW_SIZE}
              refY={ARROW_SIZE / 2}
              orient="auto"
            >
              <Path
                d={`M0,0 L0,${ARROW_SIZE} L${ARROW_SIZE},${ARROW_SIZE / 2} z`}
                fill={EDGE_COLOR}
                fillOpacity={0.8}
              />
            </Marker>
          </Defs>

          {/* Edges */}
          {links.map((link) => {
            const sx = link.source.x ?? 0;
            const sy = link.source.y ?? 0;
            const tx = link.target.x ?? 0;
            const ty = link.target.y ?? 0;
            return (
              <Line
                key={`${link.source.id}-${link.target.id}-${link.fieldName}`}
                x1={sx}
                y1={sy}
                x2={tx}
                y2={ty}
                stroke={EDGE_COLOR}
                strokeWidth={1.5}
                strokeOpacity={0.55}
                markerEnd="url(#arrow)"
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const isConnected = links.some(
              (l) => l.source.id === node.id || l.target.id === node.id,
            );
            const cx = node.x ?? 0;
            const cy = node.y ?? 0;
            const label = node.name.length > 13 ? `${node.name.slice(0, 12)}…` : node.name;
            return (
              <G key={node.id} onPress={() => onNodePress(node.slug)}>
                {/* Outer glow ring */}
                <Circle cx={cx} cy={cy} r={NODE_R + 5} fill={NODE_COLOR} fillOpacity={0.15} />
                <Circle
                  cx={cx}
                  cy={cy}
                  r={NODE_R}
                  fill={isConnected ? NODE_COLOR : NODE_COLOR_ISOLATED}
                  fillOpacity={0.9}
                />
                <SvgText
                  x={cx}
                  y={cy + NODE_R + 14}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight="500"
                  fill={LABEL_COLOR}
                >
                  {label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      )}

      {/* Hint */}
      {bases.length > 0 ? (
        <View style={styles.hint}>
          <Text style={[typography.caption, { color: "#44446688" }]}>Tap a node to open</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  badge: {
    position: "absolute",
    top: 14,
    left: 16,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  hint: {
    position: "absolute",
    bottom: 14,
    right: 16,
    zIndex: 10,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
