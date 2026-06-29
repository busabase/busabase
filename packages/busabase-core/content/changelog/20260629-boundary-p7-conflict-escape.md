---
title: 2026-06-29 Boundary P7 — conflict-CR escape hatch
---

# Boundary P7 — conflict-CR escape hatch

Date: 2026-06-29
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> 继续剩余的（边界审计的 follow-up 列表）。

**Refined Instructions:**
- A change request that hits a 3-way merge conflict (`status="conflict"`) was a
  dead end — `reviseOperation`, `closeChangeRequest`, and `mergeChangeRequest`
  all rejected the conflict status, leaving the CR permanently stuck.

## What Changed

`logic/cr-lifecycle.ts`:

1. **Persist conflict detail** — when a merge throws `CONFLICT`, the catch block
   now also writes `mergeSummary.conflict = { recordId, fields, detectedAt }`
   (the conflicting field list comes from the `ORPCError.data.conflicts`), so the
   UI can render which fields collided instead of just a status badge.

2. **Revise is the resolve path** — `reviseOperation` now accepts a `conflict`
   CR. For a `record_update` op it re-baselines `operation.baseCommitId` to the
   target record's **current** head, so the next merge skips the 3-way branch
   (no stale divergence) and applies the revised fields cleanly. The CR resets to
   `in_review` and its stale `mergeSummary` conflict is cleared.

3. **Close is the abandon path** — `closeChangeRequest` now accepts a `conflict`
   CR (→ `rejected`), so an author can give up on an unresolvable conflict.

## Why

The conflict state had no exit. Authors hitting a concurrent-edit conflict could
neither resolve nor abandon the CR. Revise (resolve) + close (abandon) give both
exits, and the persisted conflict detail makes the conflict inspectable.

## Files Affected

- `src/logic/cr-lifecycle.ts` — conflict summary persistence, revise re-baseline +
  conflict status allowance, close conflict allowance
- `tests/boundary-p7.test.ts` — 3 PGLite tests (summary persisted, revise resolves
  + merges clean, close abandons)

## Breaking Changes

None. Only previously-stuck transitions are newly permitted.

## Testing

- `vitest run` — 320 passed (incl. 3 new P7 tests), `tsc --noEmit` clean.
- No migration: `mergeSummary` is an existing jsonb column.

## Follow-up Tasks

- UI: conflict 3-way diff panel (base / ours / theirs) on the CR detail page,
  driven by `mergeSummary.conflict.fields`, with "revise to resolve" + "close".
- Full archive/restore UX for folder/doc/skill nodes, unified Trash view, folder
  cascade-delete confirmation, asset where-used UI.
