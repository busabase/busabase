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
const MIN_NODE_COLUMN_WIDTH = 132;
const MIN_NODE_ROW_HEIGHT = 112;

export interface BaseGraphGrid {
  columns: number;
  rows: number;
  minHeight: number;
}

// Desktop can keep the compact square-ish graph. On a phone, cap the number
// of columns by the readable node width and let the normal page scroll own the
// extra height. This avoids opening a 7-column canvas with five columns hidden
// offscreen and no obvious spatial anchor.
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
