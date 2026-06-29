---
title: 2026-06-29 Boundary P10 — unified Trash view
---

# Boundary P10 — unified Trash view

Date: 2026-06-29
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> 接着做（方向：Node 软删+恢复+Trash → Trash UI）。

**Refined Instructions:**
- Surface the archived items from P6 (bases) and P9 (folder/doc/skill nodes) in a
  single Trash page with per-item Restore.

## What Changed

1. **api-client** (`api-client/index.ts`)
   - `listArchivedNodes()` → `client.nodes.listArchived()`.
   - `createNodeChangeRequest` operations union gains `{ kind: "restore"; nodeId }`.

2. **Trash view** (`dashboard/components/archived-bases.tsx`)
   - The existing `ArchivedBasesView` is now a unified **Trash** with two sections:
     **Bases** (from `bases.listArchived`) and **Folders, docs & skills** (from
     `nodes.listArchived`). Each row has a Restore button with inline error +
     per-row spinner. Extracted a shared `TrashRow`. The node section only renders
     when an `onRestoreNode` handler is provided (backward-compatible).

3. **Dashboard wiring** (`dashboard/index.tsx`)
   - `archivedNodesQuery` (`nodes.listArchived`) + a `submitRestoreNode` callback
     that creates a `node_restore` change request, approve-merges it, invalidates
     the archived-nodes + node-tree queries, and toasts. Passed to the Trash view
     on the archived route.

## Why

Closes the loop on the node-lifecycle work: P6/P9 made bases + nodes recoverable
at the API level; this gives users one place to see and restore everything they
archived.

## Files Affected

- `src/api-client/index.ts` — `listArchivedNodes` + `restore` node op
- `src/domains/dashboard/components/archived-bases.tsx` — unified Trash + `TrashRow`
- `src/domains/dashboard/index.tsx` — archived-nodes query + `submitRestoreNode`

## Breaking Changes

None. Additive; the bases section is unchanged for callers that don't pass nodes.

## Testing

- `tsc --noEmit` clean, biome clean.
- The `nodes.listArchived` endpoint + `node_restore` flow this UI calls are
  covered by `tests/boundary-p9.test.ts`.
- **Not browser-verified**: the Trash route is hosted by `apps/busabase` (preview
  is environment-flaky and needs a seeded host app). The view mirrors the proven
  `ArchivedBasesView` pattern and is typecheck-clean.

## Follow-up Tasks

- Permanent-delete (purge) action in Trash once a retention/purge path exists.
- Folder cascade-delete confirmation, asset where-used UI.
