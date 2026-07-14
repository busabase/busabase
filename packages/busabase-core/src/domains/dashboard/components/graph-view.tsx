"use client";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  type Edge,
  type EdgeProps,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { BaseVO } from "busabase-contract/domains/base/types";
import type { NodeVO } from "busabase-contract/types";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { Folder, Network } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { type CoreLocale, fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { fieldDisplayName, fieldLabel } from "../../base/field-types";
import { mergeSearchIntoHref } from "../helpers/link-search";

// Card geometry (px). Node height is exactly HEADER_H + rows * ROW_H.
const HEADER_H = 36;
const ROW_H = 24;
const MIN_W = 200;
const MAX_W = 320;

// One-way edges read as a muted neutral; bidirectional ones use the brand indigo.
const EDGE_ONE_WAY = "#94a3b8";
const EDGE_BIDIRECTIONAL = "#6366f1";

const elk = new ELK();

// A single layered pass with orthogonal routing: ELK places every card and
// routes each edge AROUND the cards, so lines never overlap a node.
const ELK_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.aspectRatio": "1.7",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.spacing.nodeNode": "44",
  "elk.spacing.edgeNode": "24",
  "elk.spacing.edgeEdge": "14",
  "elk.spacing.componentComponent": "56",
};

interface FieldRow {
  name: string;
  typeLabel: string;
  /** Set only for relation fields whose target base is in the graph. */
  targetName?: string;
}

interface BaseNodeData extends Record<string, unknown> {
  name: string;
  slug: string;
  /** Folder the base lives under (shown as a small label, not a container). */
  folderName?: string;
  width: number;
  height: number;
  fields: FieldRow[];
  faded: boolean;
}

interface OrthoEdgeData extends Record<string, unknown> {
  points: { x: number; y: number }[];
}

type BaseNode = Node<BaseNodeData, "baseTable">;

interface BaseGraphViewProps {
  bases: BaseVO[];
  /** Full node tree (folders + bases); used to label each base with its folder. */
  nodes?: NodeVO[];
}

function measureWidth(
  ctx: CanvasRenderingContext2D,
  name: string,
  folder: string,
  fields: FieldRow[],
) {
  ctx.font = "600 13px Inter, system-ui, sans-serif";
  let header = ctx.measureText(name).width;
  if (folder) {
    ctx.font = "10px Inter, system-ui, sans-serif";
    header += ctx.measureText(folder).width + 26; // gap + folder icon + tag
  }
  let max = header;
  ctx.font = "11px Inter, system-ui, sans-serif";
  for (const f of fields) {
    const text = f.targetName ? `◆ ${f.name} → ${f.targetName}` : `• ${f.name}    ${f.typeLabel}`;
    max = Math.max(max, ctx.measureText(text).width);
  }
  return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(max) + 32));
}

/** Walk the node tree → map each base id to its nearest ancestor folder name. */
function indexBaseFolders(nodes: NodeVO[], baseIds: Set<string>) {
  const result = new Map<string, string>();
  const walk = (node: NodeVO, folder: string | null) => {
    const here = node.type === "folder" ? node.name : folder;
    if (node.baseId && baseIds.has(node.baseId) && folder) result.set(node.baseId, folder);
    for (const child of node.children ?? []) walk(child, here);
  };
  for (const n of nodes) walk(n, null);
  return result;
}

interface EdgeMeta {
  id: string;
  source: string;
  target: string;
  bidirectional: boolean;
}

interface BuiltGraph {
  baseNodes: BaseNode[];
  edgeMeta: EdgeMeta[];
  /** node id → set of adjacent node ids (including itself), for hover highlight. */
  adjacency: Map<string, Set<string>>;
  relationCount: number;
  oneWayCount: number;
  biCount: number;
  folderCount: number;
}

function buildGraph(bases: BaseVO[], nodes?: NodeVO[], locale?: CoreLocale): BuiltGraph {
  const baseMap = new Map(bases.map((b) => [b.id, b]));
  const baseIds = new Set(bases.map((b) => b.id));

  // Directed relation edges whose target base is also in the graph.
  type RawLink = { source: string; target: string };
  const rawLinks: RawLink[] = bases.flatMap((b) =>
    b.fields
      .filter(
        (f) =>
          f.type === "relation" && f.options.targetBaseId && baseIds.has(f.options.targetBaseId),
      )
      .map((f) => ({ source: b.id, target: f.options.targetBaseId as string })),
  );

  // Per-base field rows (schema order). Relation fields carry the target name.
  const fieldsMap = new Map<string, FieldRow[]>();
  for (const b of bases) {
    const sorted = b.fields.slice().sort((a, c) => a.position - c.position);
    fieldsMap.set(
      b.id,
      sorted.map((f) => {
        const linkedTarget =
          f.type === "relation" && f.options.targetBaseId && baseIds.has(f.options.targetBaseId)
            ? (baseMap.get(f.options.targetBaseId)?.name ?? f.options.targetBaseId)
            : undefined;
        return {
          name: fieldDisplayName(f, locale),
          typeLabel: fieldLabel(f.type),
          targetName: linkedTarget,
        };
      }),
    );
  }

  // Collapse A→B and B→A into a single bidirectional edge.
  const seen = new Set<string>();
  const pairs = new Set(rawLinks.map((l) => `${l.source}→${l.target}`));
  const edgeMeta: EdgeMeta[] = [];
  for (const l of rawLinks) {
    const fwd = `${l.source}→${l.target}`;
    const rev = `${l.target}→${l.source}`;
    if (seen.has(fwd) || seen.has(rev)) continue;
    seen.add(fwd);
    edgeMeta.push({
      id: `${l.source}__${l.target}`,
      source: l.source,
      target: l.target,
      bidirectional: pairs.has(rev),
    });
  }

  const folderOf = nodes ? indexBaseFolders(nodes, baseIds) : new Map<string, string>();
  const tmpCtx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
  const baseNodes: BaseNode[] = bases.map((b) => {
    const fields = fieldsMap.get(b.id) ?? [];
    const folderName = folderOf.get(b.id);
    return {
      id: b.id,
      type: "baseTable",
      position: { x: 0, y: 0 },
      data: {
        name: b.name,
        slug: b.slug,
        folderName,
        width: measureWidth(tmpCtx, b.name, folderName ?? "", fields),
        height: HEADER_H + fields.length * ROW_H,
        fields,
        faded: false,
      },
    };
  });

  const adjacency = new Map<string, Set<string>>();
  for (const b of bases) adjacency.set(b.id, new Set([b.id]));
  for (const e of edgeMeta) {
    adjacency.get(e.source)?.add(e.target);
    adjacency.get(e.target)?.add(e.source);
  }

  const biCount = edgeMeta.filter((e) => e.bidirectional).length;
  return {
    baseNodes,
    edgeMeta,
    adjacency,
    relationCount: edgeMeta.length,
    oneWayCount: edgeMeta.length - biCount,
    biCount,
    folderCount: new Set(folderOf.values()).size,
  };
}

function BaseTableNode({ data }: NodeProps<BaseNode>) {
  const { name, folderName, fields, width, faded } = data;
  return (
    <div
      className="relative transition-opacity duration-150"
      style={{ width, opacity: faded ? 0.18 : 1 }}
    >
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-md">
        <div
          className="relative flex items-center gap-2 border-b border-border px-3"
          style={{ height: HEADER_H }}
        >
          <span className="absolute inset-x-0 top-0 h-[3px] bg-primary" />
          <span className="flex-1 truncate text-[13px] font-medium text-card-foreground">
            {name}
          </span>
          {folderName ? (
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
              <Folder className="size-3 shrink-0" />
              <span className="max-w-[96px] truncate">{folderName}</span>
            </span>
          ) : null}
        </div>
        {fields.map((f, i) => (
          <div
            key={`${f.name}-${i}`}
            className="flex items-center gap-1.5 px-3 text-[11px]"
            style={{ height: ROW_H }}
          >
            {f.targetName ? (
              <>
                <span className="text-primary">◆</span>
                <span className="truncate text-card-foreground/85">{f.name}</span>
                <span className="text-primary">→</span>
                <span className="truncate text-muted-foreground">{f.targetName}</span>
              </>
            ) : (
              <>
                <span className="text-muted-foreground/40">•</span>
                <span className="truncate text-card-foreground/85">{f.name}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">{f.typeLabel}</span>
              </>
            )}
          </div>
        ))}
      </div>
      {/* Hidden ports — ELK owns the routing, these just let React Flow attach edges. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!opacity-0"
      />
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
    </div>
  );
}

/** Draws the orthogonal polyline ELK routed for this edge (points in flow coords). */
function OrthogonalEdge({ data, markerEnd, markerStart, style }: EdgeProps) {
  const points = (data as OrthoEdgeData | undefined)?.points;
  if (!points || points.length < 2) return null;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  return <BaseEdge path={path} markerEnd={markerEnd} markerStart={markerStart} style={style} />;
}

const nodeTypes = { baseTable: BaseTableNode };
const edgeTypes = { ortho: OrthogonalEdge };

function GraphInner({ bases, nodes: nodeTree }: BaseGraphViewProps) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const built = useMemo(() => buildGraph(bases, nodeTree, locale), [bases, nodeTree, locale]);
  const { baseNodes, edgeMeta, adjacency, relationCount, oneWayCount, biCount, folderCount } =
    built;

  const [nodes, setNodes, onNodesChange] = useNodesState<BaseNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  // Auto-fit on init and as the panel grows to its final size, backing off once
  // the user pans or zooms.
  const userMoved = useRef(false);
  const doFit = useCallback(() => {
    if (!userMoved.current) fitView({ padding: 0.12, duration: 300, maxZoom: 1.4 });
  }, [fitView]);
  const onInit = useCallback(() => doFit(), [doFit]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => doFit());
    obs.observe(el);
    return () => obs.disconnect();
  }, [doFit]);

  // Run the ELK layered + orthogonal-routing pass, then build the RF graph.
  useEffect(() => {
    let cancelled = false;

    const elkGraph: ElkNode = {
      id: "root",
      layoutOptions: ELK_OPTIONS,
      children: baseNodes.map((n) => ({ id: n.id, width: n.data.width, height: n.data.height })),
      edges: edgeMeta.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    };

    elk
      .layout(elkGraph)
      .then((laidOut) => {
        if (cancelled) return;

        const pos = new Map(
          (laidOut.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]),
        );
        const edgePoints = new Map<string, { x: number; y: number }[]>();
        for (const e of laidOut.edges ?? []) {
          const sec = e.sections?.[0];
          if (sec && e.id) {
            edgePoints.set(e.id, [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]);
          }
        }

        setNodes(baseNodes.map((n) => ({ ...n, position: pos.get(n.id) ?? { x: 0, y: 0 } })));
        setEdges(
          edgeMeta.map((e) => {
            const color = e.bidirectional ? EDGE_BIDIRECTIONAL : EDGE_ONE_WAY;
            return {
              id: e.id,
              source: e.source,
              target: e.target,
              type: "ortho",
              style: { stroke: color, strokeWidth: 1.5 },
              markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
              markerStart: e.bidirectional
                ? { type: MarkerType.ArrowClosed, width: 16, height: 16, color }
                : undefined,
              data: { points: edgePoints.get(e.id) ?? [] },
            };
          }),
        );
        requestAnimationFrame(() => {
          if (!cancelled) doFit();
        });
        setTimeout(() => {
          if (!cancelled) doFit();
        }, 320);
      })
      .catch(() => {
        if (cancelled) return;
        setNodes(baseNodes.map((n, i) => ({ ...n, position: { x: 0, y: i * 160 } })));
      });

    return () => {
      cancelled = true;
    };
  }, [baseNodes, edgeMeta, setNodes, setEdges, doFit]);

  const [, navigate] = useLocation();
  const currentSearch = useSearch();
  const onNodeClick = useCallback(
    (_: unknown, node: BaseNode) =>
      navigate(mergeSearchIntoHref(`/base/${node.data.slug}`, currentSearch)),
    [navigate, currentSearch],
  );

  const onNodeMouseEnter = useCallback(
    (_: unknown, node: BaseNode) => {
      const keep = adjacency.get(node.id) ?? new Set([node.id]);
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, faded: !keep.has(n.id) } })));
      setEdges((es) =>
        es.map((e) => ({
          ...e,
          style: { ...e.style, opacity: e.source === node.id || e.target === node.id ? 1 : 0.07 },
        })),
      );
    },
    [adjacency, setNodes, setEdges],
  );

  const onNodeMouseLeave = useCallback(() => {
    setNodes((ns) =>
      ns.map((n) => (n.data.faded ? { ...n, data: { ...n.data, faded: false } } : n)),
    );
    setEdges((es) => es.map((e) => ({ ...e, style: { ...e.style, opacity: 1 } })));
  }, [setNodes, setEdges]);

  return (
    <div ref={containerRef} className="relative h-full w-full bg-muted/20">
      {/* Header badge */}
      <div className="pointer-events-none absolute left-4 top-3 z-10 flex items-center gap-2">
        <Network className="size-4 text-primary" />
        <span className="text-sm font-medium text-muted-foreground">{messages.nav.graph}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {fmt(messages.graph.summary, { bases: bases.length, relations: relationCount })}
          {folderCount > 0 ? fmt(messages.graph.foldersSuffix, { folders: folderCount }) : ""}
        </span>
      </div>

      {/* Legend */}
      {relationCount > 0 && (
        <div className="pointer-events-none absolute right-4 top-3 z-10 flex items-center gap-4 text-xs text-muted-foreground">
          {oneWayCount > 0 && (
            <span className="flex items-center gap-1">
              <span style={{ color: EDGE_ONE_WAY }}>→</span>
              <span>{fmt(messages.graph.oneWay, { count: oneWayCount })}</span>
            </span>
          )}
          {biCount > 0 && (
            <span className="flex items-center gap-1">
              <span style={{ color: EDGE_BIDIRECTIONAL }}>⇄</span>
              <span>{fmt(messages.graph.bidirectional, { count: biCount })}</span>
            </span>
          )}
        </div>
      )}

      {/* Hint when no relations */}
      {relationCount === 0 && (
        <div className="pointer-events-none absolute bottom-6 left-0 right-0 z-10 text-center text-xs text-muted-foreground">
          {messages.graph.noRelationsHint}
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onInit={onInit}
        onMoveStart={(event) => {
          if (event) userMoved.current = true;
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        colorMode="system"
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function BaseGraphView({ bases, nodes }: BaseGraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphInner bases={bases} nodes={nodes} />
    </ReactFlowProvider>
  );
}
