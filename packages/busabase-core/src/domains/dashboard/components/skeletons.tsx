import { Skeleton } from "kui/skeleton";

/**
 * Loading placeholders for the workbench detail panes. These replace the old
 * centered "Loading …" text so opening a node/base shows a layout-shaped
 * shimmer that matches what finishes loading, instead of a jump from text to
 * full content.
 *
 * Row/cell shapes are described by static arrays with stable string ids (used as
 * React keys) and preset widths, so the skeletons are deterministic and don't
 * key off the array index.
 */

const SKILL_TREE_ROWS = [
  { id: "skill-tree-1", width: "72%" },
  { id: "skill-tree-2", width: "60%" },
  { id: "skill-tree-3", width: "85%" },
  { id: "skill-tree-4", width: "68%" },
  { id: "skill-tree-5", width: "78%" },
  { id: "skill-tree-6", width: "64%" },
];

const DOC_LINES = [
  { id: "doc-line-1", width: "96%" },
  { id: "doc-line-2", width: "88%" },
  { id: "doc-line-3", width: "92%" },
  { id: "doc-line-4", width: "80%" },
  { id: "doc-line-5", width: "94%" },
  { id: "doc-line-6", width: "76%" },
  { id: "doc-line-7", width: "90%" },
  { id: "doc-line-8", width: "70%" },
];

const FOLDER_ROWS = [
  { id: "folder-row-1", width: "48%" },
  { id: "folder-row-2", width: "40%" },
  { id: "folder-row-3", width: "62%" },
  { id: "folder-row-4", width: "52%" },
  { id: "folder-row-5", width: "44%" },
];

const BASE_COLUMNS = [
  { id: "base-col-1", cellWidth: "80%" },
  { id: "base-col-2", cellWidth: "60%" },
  { id: "base-col-3", cellWidth: "72%" },
  { id: "base-col-4", cellWidth: "55%" },
  { id: "base-col-5", cellWidth: "66%" },
];

const BASE_ROWS = [
  "base-row-1",
  "base-row-2",
  "base-row-3",
  "base-row-4",
  "base-row-5",
  "base-row-6",
  "base-row-7",
  "base-row-8",
];

const baseGridTemplate = `minmax(200px,1fr) repeat(${BASE_COLUMNS.length - 1}, minmax(120px,1fr))`;

/**
 * Skeleton for a node-detail pane (folder / doc / skill). `variant` mirrors the
 * loaded layout so the shimmer lands where the real content will:
 * - `folder` → title + a short list of child rows
 * - `doc`    → title + paragraph lines
 * - `skill`  → top metadata bar + two-column file rail / code work area
 */
export function NodeDetailSkeleton({
  variant = "folder",
}: {
  variant?: "folder" | "doc" | "skill";
}) {
  if (variant === "skill") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col bg-background" aria-hidden>
        <div className="border-border/60 border-b px-4 py-4 md:px-6">
          <div className="flex items-start gap-3">
            <Skeleton className="size-8 rounded-md" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-7 w-56" />
              <Skeleton className="mt-2 h-4 w-80 max-w-full" />
            </div>
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
          <div className="mt-4 flex gap-5">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="border-border/60 border-b bg-muted/20 lg:border-r lg:border-b-0">
            <div className="flex min-h-11 items-center justify-between border-border/50 border-b px-4">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-5 w-7 rounded-md" />
            </div>
            <div className="space-y-2 p-4">
              {SKILL_TREE_ROWS.map((row) => (
                <Skeleton className="h-4" style={{ width: row.width }} key={row.id} />
              ))}
            </div>
          </div>
          <div className="min-h-0">
            <div className="flex min-h-11 items-center justify-between border-border/60 border-b px-4">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-7 w-12 rounded-md" />
            </div>
            <div className="space-y-3 p-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-10/12" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (variant === "doc") {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-10" aria-hidden>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="mt-2 h-4 w-1/3" />
        <div className="mt-8 space-y-3">
          {DOC_LINES.map((line) => (
            <Skeleton className="h-4" style={{ width: line.width }} key={line.id} />
          ))}
        </div>
      </div>
    );
  }

  // folder
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8" aria-hidden>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
      <Skeleton className="mb-2 h-3 w-16" />
      <div className="-mx-2 flex flex-col gap-1">
        {FOLDER_ROWS.map((row) => (
          <div className="flex items-center gap-3 px-2 py-2" key={row.id}>
            <Skeleton className="size-4 shrink-0 rounded" />
            <Skeleton className="h-4" style={{ width: row.width }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton for the base table pane — a header strip and a grid of rows/cells —
 * shown while a base's data is still loading (cold cache / direct link), so the
 * base route shimmers into shape instead of flashing an empty/not-found state.
 */
export function BaseTableSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-auto" aria-hidden>
      <div className="border-border/60 border-b px-6 py-4">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <div className="px-6 py-5">
        {/* view tabs / toolbar */}
        <div className="mb-4 flex items-center gap-2">
          <Skeleton className="h-7 w-24 rounded-md" />
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="ml-auto h-7 w-28 rounded-md" />
        </div>
        {/* header row */}
        <div
          className="grid gap-3 border-border/60 border-b pb-2"
          style={{ gridTemplateColumns: baseGridTemplate }}
        >
          {BASE_COLUMNS.map((column) => (
            <Skeleton className="h-4 w-24" key={column.id} />
          ))}
        </div>
        {/* body rows */}
        <div className="divide-y divide-border/30">
          {BASE_ROWS.map((rowId) => (
            <div
              className="grid items-center gap-3 py-3"
              style={{ gridTemplateColumns: baseGridTemplate }}
              key={rowId}
            >
              {BASE_COLUMNS.map((column) => (
                <Skeleton className="h-4" style={{ width: column.cellWidth }} key={column.id} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
