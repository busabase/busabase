---
title: 2026-06-26 Graph View → React Flow + elkjs (layered orthogonal ERD)
---

# Graph View → React Flow + elkjs (layered orthogonal ERD)

Date: 2026-06-26
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> The Graph View edges/layout looked messy — was it just alphabetical? Make the
> layout and connectors look more professional. After comparing options
> (curved-edge polish vs. a full layout engine), the user chose the "ultimate"
> route: switch to React Flow + elkjs with a layered + orthogonal ERD layout.

**Refined Instructions:**
- Replace the canvas-based `react-force-graph-2d` graph with React Flow (`@xyflow/react`).
- Use `elkjs` `layered` layout with orthogonal edge routing for a professional ERD look.
- Anchor edges to the exact relation-field row (source + bidirectional target rows).
- Theme-aware cards (design tokens, light/dark) instead of a hardcoded dark canvas.
- Add hover highlight: focus a table's neighbourhood, fade the rest.
- Preserve existing behaviour: click a table → navigate to `/base/:slug`.

## What Changed

- Rewrote `dashboard/components/graph-view.tsx`:
  - `react-force-graph-2d` canvas → `@xyflow/react` (`ReactFlowProvider`, custom
    `baseTable` node, `Background`, `Controls`).
  - A single `elkjs` `layered` + `ORTHOGONAL` pass (`elk.bundled.js`, main-thread) both
    places the cards AND routes every edge **around** the cards. The routed polyline ELK
    returns (`edge.sections` → start/bend/end points) is drawn by a tiny custom
    `OrthogonalEdge` (`BaseEdge` with the ELK path), so lines travel through the gaps
    between cards and never overlap or hide behind a node. Cards carry hidden
    source/target handles purely so React Flow attaches the edges.
  - Bidirectional links fold A→B / B→A into one edge with arrowheads on both ends;
    one-way = muted neutral, bidirectional = brand indigo. Legend kept.
  - Hover a node → dim non-adjacent nodes (`data.faded`) and non-incident edges (opacity).
  - Cards use design tokens (`bg-card`, `border-border`, `text-primary`,
    `text-muted-foreground`) and adapt to light/dark via React Flow `colorMode="system"`.
  - **Folder shown as a small label, not a container.** Each base resolves its folder from
    the `nodes` tree (nearest `type:"folder"` ancestor) and renders it as a `folder`-icon
    chip in the card header. (Compound folder containers were tried but conflict with edge
    routing — a single flat layered pass packs the components compactly *and* routes edges,
    which folder-grouping could not do at once.)
  - Auto-fit via `fitView` on init + a `ResizeObserver` (the panel can mount at zero size),
    backing off once the user pans/zooms (`onMoveStart`).
- `dashboard/index.tsx`: thread the existing `nodes` prop through to `<BaseGraphView>`.
- `packages/busabase-core/package.json`: removed `react-force-graph-2d`; added
  `@xyflow/react@^12.10.0` (matches buda/kui) and `elkjs@^0.9.3`.

## Why

- The old layout pinned nodes to a fixed degree-sorted grid that ignored topology, so
  the most-connected table landed in a corner and edges fanned out as crossing diagonals.
- A real layout engine (ELK layered) places related tables in adjacent layers and
  minimizes crossings; React Flow gives orthogonal routing, field-row handles, hover
  interaction, and theme-aware HTML nodes for free — the professional ERD baseline used
  by tools like dbdiagram / Prisma editor.

## Files Affected

- `packages/busabase-core/src/domains/dashboard/components/graph-view.tsx` — full rewrite.
- `packages/busabase-core/src/domains/dashboard/index.tsx` — pass `nodes` to `BaseGraphView`.
- `packages/busabase-core/package.json` — swapped graph deps.

## Breaking Changes

- None. `BaseGraphView({ bases })` keeps the same public signature and call site.

## Testing

- `pnpm exec biome check graph-view.tsx` — clean.
- `cd packages/busabase-core && npx tsc --noEmit` — no errors in `graph-view.tsx`
  (pre-existing unrelated `openlib/*` / `open-domains/*` module-resolution errors in this
  worktree only).
- Manual: `busabase` dev server, `/dashboard/graph?demo=1` — 20 demo bases / 7 relations /
  13 folders render as ERD cards with a folder-label chip each, laid out in a compact
  landscape (~1.4 aspect), with ELK-routed orthogonal edges that thread the gaps between
  cards (no edge overlaps or hides behind a node), arrowheads, legend, hover highlight, and
  auto-fit on load; no app console errors.

## Follow-up Tasks (Optional)

- Tokenize edge colors (currently literal `#6366f1` / `#94a3b8`) into CSS variables.
- Optional minimap for very large schemas.
