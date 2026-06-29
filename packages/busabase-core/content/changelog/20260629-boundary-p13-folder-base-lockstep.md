---
title: 2026-06-29 Boundary P13 — folder delete/restore keeps the Base table in lockstep
---

# Boundary P13 — folder delete keeps the Base table in lockstep

Date: 2026-06-29
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> 继续检查（边界审计的进一步核查）。

**Refined Instructions:**
- Re-audit the node-lifecycle work (P9–P12). Verify the latent issue flagged
  during P12 analysis: deleting a folder that contains a Base.

## What Changed

**Bug:** `mergeNodeDelete` archived a folder's whole subtree at the **node** level
(`busabase_nodes.archivedAt`), but for any **Base node** in that subtree it left
`busabase_bases.archivedAt` null and its records active. Result: a ghost base —
gone from the node tree, but still listed by `bases.list` with active records.
`mergeNodeRestore` had the mirror gap (only un-archived the base when the
restored root itself was a base, not when a base rode along in a folder subtree).

**Fix** (`logic/cr-lifecycle.ts`):
- New `setBasesArchivedForNodes(ctx, nodeIds, archivedAt)` helper sets/clears
  `busabase_bases.archivedAt` + archives/unarchives records for every Base node
  among `nodeIds`.
- `mergeNodeDelete` calls it (archive) over the folder subtree.
- `mergeNodeRestore` calls it (restore) over the un-archived batch.

The single-base delete path (`node.type === "base"`) was already correct and is
unchanged.

## Why

Keeps the base table + record queries consistent with the node tree when a folder
containing a Base is archived/restored — no ghost bases, and a folder restore
brings its Base (and records) fully back.

## Files Affected

- `src/logic/cr-lifecycle.ts` — `setBasesArchivedForNodes` + delete/restore calls
- `tests/boundary-p13.test.ts` — regression test (delete folder → base leaves
  `bases.list` + records archived; restore → both come back)

## Breaking Changes

None — fixes an inconsistent state that should never have been observable.

## Testing

- `vitest run --no-file-parallelism` — 333 passed (incl. 1 new P13 test),
  `tsc --noEmit` clean, biome clean.
- The P13 test fails on the pre-fix code (the base lingers in `bases.list`).

## Follow-up Tasks

- (None new.) Base purge with full history remains the only open design item.
