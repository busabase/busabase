import type { BaseVO } from "busabase-contract/types";
import { forceLink, forceManyBody, forceSimulation } from "d3-force";
import { iStringParse } from "openlib/i18n/i-string";

export interface GraphNode {
  id: string;
  name: string;
  slug: string;
  x: number;
  y: number;
}

export interface GraphLink {
  source: GraphNode;
  target: GraphNode;
  fieldName: string;
}

interface RawGraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  fieldName: string;
}

export interface BaseGraphLayout {
  nodes: GraphNode[];
  links: GraphLink[];
  edgeCount: number;
}

const HEADER_CLEARANCE = 56;
const FOOTER_CLEARANCE = 28;
const MIN_NODE_COLUMN_WIDTH = 84;
const MIN_NODE_ROW_HEIGHT = 82;

export interface BaseGraphGrid {
  columns: number;
  rows: number;
  minHeight: number;
}

export interface BaseGraphRelationSummary {
  edgeCount: number;
  relationCountByBaseId: Map<string, number>;
}

export const summarizeBaseGraphRelations = (bases: BaseVO[]): BaseGraphRelationSummary => {
  const baseIds = new Set(bases.map((base) => base.id));
  const relationCountByBaseId = new Map(bases.map((base) => [base.id, 0]));
  let edgeCount = 0;

  for (const base of bases) {
    for (const field of base.fields) {
      const targetBaseId = field.options.targetBaseId;
      if (field.type !== "relation" || !targetBaseId || !baseIds.has(targetBaseId)) continue;

      edgeCount += 1;
      relationCountByBaseId.set(base.id, (relationCountByBaseId.get(base.id) ?? 0) + 1);
      relationCountByBaseId.set(targetBaseId, (relationCountByBaseId.get(targetBaseId) ?? 0) + 1);
    }
  }

  return { edgeCount, relationCountByBaseId };
};

// The canvas is used on regular-width layouts. Fit dense iPad workspaces into
// a compact grid while keeping enough room for the node and its short label.
export const getBaseGraphGrid = (nodeCount: number, width: number): BaseGraphGrid => {
  const idealColumns = Math.max(1, Math.ceil(Math.sqrt(nodeCount)));
  const readableColumns = Math.max(1, Math.floor(width / MIN_NODE_COLUMN_WIDTH));
  const columns = Math.min(idealColumns, readableColumns);
  const rows = Math.max(1, Math.ceil(nodeCount / columns));

  return {
    columns,
    rows,
    minHeight: HEADER_CLEARANCE + FOOTER_CLEARANCE + rows * MIN_NODE_ROW_HEIGHT,
  };
};

export const buildBaseGraphLayout = (
  bases: BaseVO[],
  width: number,
  height: number,
): BaseGraphLayout => {
  if (bases.length === 0) return { nodes: [], links: [], edgeCount: 0 };

  const { columns, rows } = getBaseGraphGrid(bases.length, width);
  const nodes: GraphNode[] = bases.map((base, index) => ({
    id: base.id,
    name: base.name,
    slug: base.slug,
    x: ((index % columns) + 0.5) * (width / columns),
    y:
      HEADER_CLEARANCE +
      (Math.floor(index / columns) + 0.5) * ((height - HEADER_CLEARANCE - FOOTER_CLEARANCE) / rows),
  }));

  const baseIds = new Set(bases.map((base) => base.id));
  const rawLinks: RawGraphLink[] = [];
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
          fieldName: iStringParse(field.name),
        });
      }
    }
  }

  // Use a short force pass only to establish a useful topological ordering,
  // then snap to fixed cells so dense workspaces stay readable on a phone.
  forceSimulation(nodes)
    .force(
      "link",
      forceLink<GraphNode, RawGraphLink>(rawLinks)
        .id((node) => node.id)
        .distance(120),
    )
    .force("charge", forceManyBody().strength(-240))
    .stop()
    .tick(180);

  const orderedNodes = [...nodes].sort((left, right) => left.y - right.y || left.x - right.x);
  orderedNodes.forEach((node, index) => {
    node.x = ((index % columns) + 0.5) * (width / columns);
    node.y =
      HEADER_CLEARANCE +
      (Math.floor(index / columns) + 0.5) * ((height - HEADER_CLEARANCE - FOOTER_CLEARANCE) / rows);
  });

  const links = rawLinks as GraphLink[];
  return { nodes: orderedNodes, links, edgeCount: links.length };
};
