---
title: 2026-06-29 Boundary P15 — base archive hides its records + views (no ghosts)
---

# Boundary P15 — base archive keeps records + views in lockstep

Date: 2026-06-29
Author: AI Assistant
AI Agent: Claude

## What Changed

`base_archive` (the UI "archive base" path → `mergeBaseArchive`) only set
`busabase_bases.archivedAt` + the node, leaving the base's records `status="active"`
and its views active. Since `records.list` / `listRecordsByFieldText` / search
filter by `records.status` (not the parent base's archived state), an archived
base's records (and views via `listViews(baseId)`) leaked into listings while the
base itself was hidden — ghost rows. The node-delete path already archived records;
the two base-removal paths diverged.

- `mergeBaseArchive` now archives the base's active records + views in lockstep.
- `mergeBaseRestore` un-archives the records + views that were archived by THIS
  base archive (matched on the base's `archivedAt` timestamp, so individually
  deleted rows keep their own state).
- `search.ts`: the base-name search and the field→base follow-up fetch now filter
  `isNull(archivedAt)` (+ spaceId on the follow-up) so archived bases never appear
  in search.

## Files Affected

- `src/domains/base/logic/merge/base.ts` — archive/restore records + views
- `src/logic/search.ts` — exclude archived bases from search
- `tests/boundary-p15.test.ts`

## Testing

- `vitest run --no-file-parallelism` — 333 passed (incl. new P15 test: archive a
  base → its record leaves `records.list`, its view leaves `listViews`, and it
  leaves search; restore → both return). `tsc` + biome clean. Fails pre-fix.

## Follow-up

- A couple of low-severity merge-engine node-state guards (node_rename/move on an
  archived node; view_restore requiring an archived target) ship separately.
