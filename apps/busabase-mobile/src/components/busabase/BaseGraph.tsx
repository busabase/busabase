import type { BaseVO } from "busabase-contract/types";
import { Network } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, G, Line, Marker, Path, Text as SvgText } from "react-native-svg";
import { buildBaseGraphLayout } from "~/lib/base-graph-layout";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const NODE_R = 18;
const ARROW_SIZE = 6;
const NODE_HIT_SIZE = 48;

interface BaseGraphProps {
  bases: BaseVO[];
  width: number;
  height: number;
  onNodePress: (slug: string) => void;
}

export function BaseGraph({ bases, width, height, onNodePress }: BaseGraphProps) {
  const tokens = useTokens();
  const { nodes, links, edgeCount } = useMemo(
    () => buildBaseGraphLayout(bases, width, height),
    [bases, width, height],
  );

  // Strictly monochrome, theme-following canvas — no brand accent. Nodes use
  // the primary/foreground scale; edges and labels use border/muted tokens.
  const nodeColor = tokens.primary;
  const nodeColorIsolated = tokens.mutedForeground;
  const edgeColor = tokens.mutedForeground;
  const labelColor = tokens.mutedForeground;

  return (
    <View style={[styles.container, { width, height, backgroundColor: tokens.background }]}>
      {/* Header badge */}
      <View style={styles.badge}>
        <Network size={15} color={nodeColor} />
        <Text style={[typography.caption, { color: labelColor }]}>
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
                fill={edgeColor}
                fillOpacity={0.8}
              />
            </Marker>
          </Defs>

          {/* Edges */}
          {links.map((link) => {
            const sx = link.source.x;
            const sy = link.source.y;
            const tx = link.target.x;
            const ty = link.target.y;
            return (
              <Line
                key={`${link.source.id}-${link.target.id}-${link.fieldName}`}
                x1={sx}
                y1={sy}
                x2={tx}
                y2={ty}
                stroke={edgeColor}
                strokeWidth={1.5}
                strokeOpacity={0.4}
                markerEnd="url(#arrow)"
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const isConnected = links.some(
              (l) => l.source.id === node.id || l.target.id === node.id,
            );
            const cx = node.x;
            const cy = node.y;
            const label = node.name.length > 13 ? `${node.name.slice(0, 12)}…` : node.name;
            return (
              <G key={node.id}>
                <Circle cx={cx} cy={cy} r={NODE_R + 5} fill={nodeColor} fillOpacity={0.1} />
                <Circle
                  cx={cx}
                  cy={cy}
                  r={NODE_R}
                  fill={isConnected ? nodeColor : nodeColorIsolated}
                  fillOpacity={0.9}
                />
                <SvgText
                  x={cx}
                  y={cy + NODE_R + 14}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight="500"
                  fontFamily="System"
                  fill={labelColor}
                >
                  {label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      )}

      {nodes.map((node) => (
        <Pressable
          key={node.id}
          accessibilityLabel={`Open ${node.name}`}
          accessibilityRole="button"
          hitSlop={4}
          style={[
            styles.nodeHit,
            {
              left: node.x - NODE_HIT_SIZE / 2,
              top: node.y - NODE_HIT_SIZE / 2,
            },
          ]}
          onPress={() => onNodePress(node.slug)}
        />
      ))}
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
  nodeHit: {
    position: "absolute",
    width: NODE_HIT_SIZE,
    height: NODE_HIT_SIZE,
    borderRadius: NODE_HIT_SIZE / 2,
    zIndex: 2,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
