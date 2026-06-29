---
title: 2026-06-29 Boundary P14 — space-scope cross-tenant get-by-id lookups
---

# Boundary P14 — cross-tenant get-by-id is space-scoped

Date: 2026-06-29
Author: AI Assistant
AI Agent: Claude

## What Changed

A multi-subagent audit found several lookups that resolved a record / view / node
purely by id with **no `spaceId` filter** — so a leaked/guessed id from another
space could be read, or targeted by a change request. All now filter by
`getContextSpaceId()`:

- `record-ops.ts` — the record lookup in createDelete / createUpdate (revise) /
  createRestore change-request creators (3 sites).
- `view-ops.ts` — the view lookup in createUpdate / createDelete / createRestore
  view change-request creators (3 sites).
- `getDocNode` / `getFolderNode` / `getSkillNode` — node lookups (by id and by
  slug) now space-scoped (cross-tenant READ of docs/folders/skills).
- Defense-in-depth: `mergeChangeRequest`'s result record/view fetch and the
  asset-usage deletes (`syncRecordAssetUsages` / `removeRecordAssetUsages`).

## Why

Cross-tenant isolation: every get-by-id on a `busabase_*` table reachable from a
user-supplied id must be space-scoped (mirrors the P5 comment-subject fix).

## Files Affected

- `src/domains/base/logic/record-ops.ts`, `.../view-ops.ts`
- `src/domains/doc/handlers.ts`, `src/domains/folder/handlers.ts`,
  `src/domains/skill/logic/storage.ts`
- `src/domains/assets/handlers.ts`, `src/logic/cr-lifecycle.ts`
- `tests/boundary-p14.test.ts`

## Testing

- `vitest run --no-file-parallelism` — 333 passed (incl. new P14 test that
  creates a record/view/doc in one space and asserts another space cannot
  resolve them), `tsc` + biome clean. P14 fails on the pre-fix code.

## Follow-up

- Base-archive lockstep (ghost records) and a couple of merge-engine node-state
  guards are tracked in separate PRs.
