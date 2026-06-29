---
title: 2026-06-29 Boundary P9 — node soft-delete + restore (folder/doc/skill)
---

# Boundary P9 — node soft-delete + restore

Date: 2026-06-29
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> 继续剩余的 → (方向选择) Node 软删+恢复+Trash。

**Refined Instructions:**
- Folder/doc/skill nodes hard-deleted (cascade), asymmetric with base archive.
  Make node deletion recoverable: soft-archive + restore, building on the
  `busabase_nodes.archivedAt` infrastructure added in P6. (This is the backend
  half; the Trash UI follows in a later PR.)

## What Changed

1. **Soft-delete instead of hard-delete** (`logic/cr-lifecycle.ts`)
   - `mergeNodeDelete` for non-base nodes now sets `archivedAt` instead of
     `DELETE`. Folders archive their whole **active subtree** in one batch
     (shared timestamp) so children leave the tree too.

2. **`node_restore` operation**
   - New operation kind (`schema.ts` enum + `domains/registry.ts` + both
     contract + runtime `nodeOperationInputSchema` "restore" kinds).
   - `mergeNodeRestore` un-archives the same batch (nodes sharing the deleted
     node's `archivedAt`), guards the slug-reuse collision (active sibling took
     the slug → `CONFLICT`), and un-archives an owned base.

3. **`nodes.listArchived`** — flat list of archived folder/doc/skill nodes for
   the Trash view (base nodes excluded; they surface via `bases.listArchived`).

4. **Archived-filtering on reads** — `listFolders/listDocs/listSkills`,
   `getFolder/getDoc/getSkill` (slug + id), and the folder children query all
   exclude `archivedAt IS NOT NULL`. Idempotent create now ignores archived
   same-slug nodes, so a freed slug is reusable (mirrors `createBase`).

## Why

Completes the node-lifecycle started in P6 (base). Folder/doc/skill deletions are
now recoverable and consistent with base archive/restore, and archived nodes free
their slug for reuse.

## Files Affected

- `src/db/schema.ts` — `node_restore` operation enum value
- `src/domains/registry.ts` — `node_restore` operation definition
- `src/logic/cr-lifecycle.ts` — soft-delete (recursive), `mergeNodeRestore`, dispatch
- `src/logic/nodes.ts` — `restore` op mapping, `listArchivedNodes`
- `src/domains/{folder,doc,skill}/...` — archived-filtering on reads
- `src/contract/{schemas,busabase}.ts`, `src/router.ts`, `src/router-demo.ts` —
  `restore` kind + `nodes.listArchived` route
- `apps/busabase`, `apps/busabase-cloud` migrations — `node_restore` enum
- `tests/boundary-p9.test.ts` — 3 PGLite tests

## Breaking Changes

None at the API level. Behavioral: deleting a folder/doc/skill now soft-archives
(recoverable) instead of hard-deleting.

## Testing

- `vitest run` — 329 passed (incl. 3 new P9 tests), `tsc --noEmit` clean.

## Follow-up Tasks

- **Trash UI**: a `/trash` view aggregating `bases.listArchived` +
  `nodes.listArchived` with per-item Restore (next PR).
- Folder cascade-delete confirmation, asset where-used UI.
