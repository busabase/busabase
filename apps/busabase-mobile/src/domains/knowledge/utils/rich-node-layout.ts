import type { WorkflowDocument } from "busabase-contract/domains/rich-node/types";

export interface SceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkflowCanvasNode {
  id: string;
  x: number;
  y: number;
}

export interface WorkflowCanvasLayout {
  width: number;
  height: number;
  nodes: Map<string, WorkflowCanvasNode>;
}

export const WORKFLOW_NODE_WIDTH = 224;
export const WORKFLOW_NODE_HEIGHT = 78;

const SCENE_PADDING = 36;
const DEFAULT_SCENE_WIDTH = 640;
const DEFAULT_SCENE_HEIGHT = 420;
const WORKFLOW_PADDING = 32;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function getWhiteboardSceneBounds(elements: unknown[]): SceneBounds {
  const points: Array<{ x: number; y: number }> = [];

  for (const value of elements) {
    if (!isRecord(value) || value.isDeleted === true) continue;
    const x = finiteNumber(value.x);
    const y = finiteNumber(value.y);
    if (x === null || y === null) continue;

    const width = Math.max(0, finiteNumber(value.width) ?? 0);
    const height = Math.max(0, finiteNumber(value.height) ?? 0);
    points.push({ x, y }, { x: x + width, y: y + height });

    if (Array.isArray(value.points)) {
      for (const point of value.points) {
        if (!Array.isArray(point)) continue;
        const pointX = finiteNumber(point[0]);
        const pointY = finiteNumber(point[1]);
        if (pointX !== null && pointY !== null) points.push({ x: x + pointX, y: y + pointY });
      }
    }
  }

  if (points.length === 0) {
    return { x: 0, y: 0, width: DEFAULT_SCENE_WIDTH, height: DEFAULT_SCENE_HEIGHT };
  }

  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));

  return {
    x: minX - SCENE_PADDING,
    y: minY - SCENE_PADDING,
    width: Math.max(DEFAULT_SCENE_WIDTH, maxX - minX + SCENE_PADDING * 2),
    height: Math.max(DEFAULT_SCENE_HEIGHT, maxY - minY + SCENE_PADDING * 2),
  };
}

export function buildWorkflowCanvasLayout(document: WorkflowDocument): WorkflowCanvasLayout {
  if (document.nodes.length === 0) {
    return {
      width: WORKFLOW_NODE_WIDTH + WORKFLOW_PADDING * 2,
      height: WORKFLOW_NODE_HEIGHT + WORKFLOW_PADDING * 2,
      nodes: new Map(),
    };
  }

  const minX = Math.min(...document.nodes.map((node) => node.position.x));
  const minY = Math.min(...document.nodes.map((node) => node.position.y));
  const nodes = new Map(
    document.nodes.map((node) => [
      node.id,
      {
        id: node.id,
        x: node.position.x - minX + WORKFLOW_PADDING,
        y: node.position.y - minY + WORKFLOW_PADDING,
      },
    ]),
  );
  const maxX = Math.max(...[...nodes.values()].map((node) => node.x));
  const maxY = Math.max(...[...nodes.values()].map((node) => node.y));

  return {
    width: maxX + WORKFLOW_NODE_WIDTH + WORKFLOW_PADDING,
    height: maxY + WORKFLOW_NODE_HEIGHT + WORKFLOW_PADDING,
    nodes,
  };
}
