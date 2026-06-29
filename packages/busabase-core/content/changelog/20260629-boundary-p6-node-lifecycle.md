---
title: 2026-06-29 Boundary P6 — node lifecycle (base archive frees its slug)
---

# Boundary P6 — node lifecycle: base archive frees its slug

Date: 2026-06-29
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> 从 develop 开新分支。base/views/field/records 之外还有什么边界？现状 + 风险 + 推荐 + UI。然后「做」/「继续」。

**Refined Instructions:**
- After shipping the cross-entity P0 fixes (P5), do the node-lifecycle follow-up
  so a base slug can actually be reused after the base is archived.

## What Changed

Making `busabase_bases_space_slug_uniq` partial (P5 finding) is not enough on its
own: base archive **keeps** the `busabase_nodes` row (commits FK-restrict the
base), and that node's `(parentId, slug)` unique index then blocks slug reuse.
This change completes the lifecycle at the node level:

1. **Schema** (`db/schema.ts`, `domains/base/schema.ts`)
   - Add `archivedAt` to `busabase_nodes`.
   - Make `busabase_nodes_parent_slug_uniq` partial: `WHERE archived_at IS NULL`.
   - Make `busabase_bases_space_slug_uniq` partial: `WHERE archived_at IS NULL`.

2. **Archive wiring** (`domains/base/logic/merge/base.ts`, `logic/cr-lifecycle.ts`)
   - `mergeBaseArchive` and the `node_delete`-of-a-base path now also set the
     base **node's** `archivedAt`, releasing both slugs in tandem.
   - `mergeBaseRestore` clears the node's `archivedAt` and guards the
     restore-after-reuse collision: if a new active base took the slug while this
     one was archived, restore fails with a clear `CONFLICT` instead of a raw
     unique-constraint violation.

3. **Idempotent create** (`domains/base/logic/record-ops.ts`)
   - `createBase` now matches only an **active** base with the slug (an archived
     base no longer owns it), so a brand-new base may take a freed slug.

4. **Reads**
   - `listNodes` excludes archived nodes (archived base nodes leave the tree,
     matching how `bases.list` hides archived bases).
   - `loadNodesByIds` queries nodes directly (not via `listNodes`) so
     change-request hydration still resolves an archived base node.
   - `getBase(slug)` resolves the **active** base first (the id fallback stays
     unfiltered so archived bases remain reachable by id for restore / notices).

## Why

Completes the "base slug reuse after archive" gap flagged in P5. Without the node
half, the bases partial index alone could not deliver reuse.

## Files Affected

- `src/db/schema.ts` — `busabase_nodes.archivedAt` + partial slug index
- `src/domains/base/schema.ts` — partial bases slug index
- `src/domains/base/logic/merge/base.ts` — archive/restore node wiring + collision guard
- `src/logic/cr-lifecycle.ts` — node soft-archive in the base `node_delete` path
- `src/domains/base/logic/record-ops.ts` — active-only idempotent create
- `src/domains/base/logic/queries.ts` — `getBase` slug resolves active first
- `src/logic/nodes.ts` — `listNodes` excludes archived; `loadNodesByIds` direct query
- `apps/busabase`, `apps/busabase-cloud` migrations — `archived_at` + partial indexes
- `tests/boundary-p6.test.ts` — 4 PGLite tests

## Breaking Changes

None. Slug reuse is newly *allowed*; restore-after-reuse newly returns a clear error.

## Testing

- `vitest run` — 321 passed (incl. 4 new P6 tests), `tsc --noEmit` clean.

## Follow-up Tasks

- Full archive/restore UX for folder/doc/skill nodes (still hard-delete only).
- Conflict-CR escape hatch + 3-way-diff UI, unified Trash view, folder
  cascade-delete confirmation, asset where-used UI.
