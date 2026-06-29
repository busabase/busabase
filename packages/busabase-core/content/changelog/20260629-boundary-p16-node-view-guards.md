---
title: 2026-06-29 Boundary P16 — merge-engine node/view state guards
---

# Boundary P16 — node/view merge state guards

Date: 2026-06-29
Author: AI Assistant
AI Agent: Claude

## What Changed

The "Cannot merge into an archived base" guard only runs for base-targeted CRs
(`changeRequest.baseId`). **Node** CRs have no baseId, so node operations skipped
it — `node_rename` / `node_move` could mutate an archived node (e.g. a folder
soft-archived while a rename CR was open), leaving a corrupt half-active state.

- `mergeNodeRename` / `mergeNodeMove` now throw `CONFLICT` if `node.archivedAt`.
- `mergeViewRestore` now also requires the target view to be archived
  (defense-in-depth mirroring `record_restore`; the change-request creation path
  `createRestoreViewChangeRequest` already blocked restoring an active view, which
  the test locks).

## Files Affected

- `src/logic/cr-lifecycle.ts` — archived-node guards in node_rename / node_move
- `src/domains/base/logic/merge/view.ts` — view_restore archived-target guard
- `tests/boundary-p16.test.ts`

## Testing

- `vitest run --no-file-parallelism` — 334 passed (incl. 2 new P16 tests:
  renaming an archived node rejected; restoring an active view rejected).
  `tsc` + biome clean.

## Notes

This closes the audit. The field-op / view_create / record_create "no archived
base check" findings were **false positives** — those are base-targeted CRs,
already covered by the top-level archived-base guard. The FK/orphan audit came
back clean.
