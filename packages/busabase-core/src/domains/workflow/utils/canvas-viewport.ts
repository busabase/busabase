interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface CanvasNode {
  id: string;
  position: Point;
  measured?: Partial<Size>;
}

interface Viewport extends Point {
  zoom: number;
}

// Matches the w-56 step card; measurements take over after the first render.
const STEP_SIZE: Size = { width: 224, height: 78 };
const STEP_GAP = 48;
const VIEWPORT_PADDING = 24;

/** Insert beside the selected step, skipping occupied rectangles in one sweep. */
export const getNewWorkflowNodePosition = (
  nodes: CanvasNode[],
  selectedId: string | null,
  viewportCenter: Point,
): Point => {
  const selected = nodes.find((node) => node.id === selectedId);
  const position = selected
    ? {
        x: selected.position.x + (selected.measured?.width ?? STEP_SIZE.width) + STEP_GAP,
        y: selected.position.y,
      }
    : {
        x: viewportCenter.x - STEP_SIZE.width / 2,
        y: viewportCenter.y - STEP_SIZE.height / 2,
      };
  const occupied = nodes
    .map((node) => ({
      ...node.position,
      width: node.measured?.width ?? STEP_SIZE.width,
      height: node.measured?.height ?? STEP_SIZE.height,
    }))
    .filter(
      (rect) =>
        rect.y < position.y + STEP_SIZE.height + STEP_GAP &&
        rect.y + rect.height + STEP_GAP > position.y,
    )
    .sort((a, b) => a.x - b.x);
  for (const rect of occupied) {
    if (rect.x >= position.x + STEP_SIZE.width + STEP_GAP) break;
    if (rect.x + rect.width + STEP_GAP > position.x) {
      position.x = rect.x + rect.width + STEP_GAP;
    }
  }
  return position;
};

/** Pan only as far as necessary to reveal the new card, preserving its scale. */
export const getWorkflowNodeViewport = (
  node: Point & Size,
  viewport: Viewport,
  canvas: Size,
): Viewport | null => {
  // A narrow canvas may need to zoom out for the whole card to fit. Never
  // zoom in or fit the entire graph just because one step was added.
  const padding = Math.min(VIEWPORT_PADDING, canvas.width / 4, canvas.height / 4);
  const zoom = Math.min(
    viewport.zoom,
    (canvas.width - padding * 2) / node.width,
    (canvas.height - padding * 2) / node.height,
  );
  const x = Math.min(
    Math.max(viewport.x, padding - node.x * zoom),
    canvas.width - padding - (node.x + node.width) * zoom,
  );
  const y = Math.min(
    Math.max(viewport.y, padding - node.y * zoom),
    canvas.height - padding - (node.y + node.height) * zoom,
  );
  return x === viewport.x && y === viewport.y && zoom === viewport.zoom ? null : { x, y, zoom };
};
