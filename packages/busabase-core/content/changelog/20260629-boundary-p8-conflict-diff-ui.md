---
title: 2026-06-29 Boundary P8 — conflict diff UI on the CR detail page
---

# Boundary P8 — conflict diff UI

Date: 2026-06-29
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> 继续剩余的（边界审计 follow-up）。

**Refined Instructions:**
- Surface the P7 conflict data (`mergeSummary.conflict`) in the change-request
  detail UI so a human can see which fields collided and how to recover.

## What Changed

`domains/dashboard/components/change-request-review.tsx`:

1. **`getChangeRequestConflict(cr)`** — pure reader that parses
   `mergeSummary.conflict { recordId, fields, detectedAt }` (the exact shape P7
   persists) and tolerates malformed input.
2. **`ConflictDiffPanel`** — banner rendered on a `conflict` CR (above
   "What will change"): names the colliding fields as chips and explains the two
   exits (revise the proposed change to re-baseline + merge, or close to abandon).
3. **`FinishReviewComposer` conflict branch** — a `conflict` CR previously fell
   through to a passive "not reviewable" message with no action. It now shows a
   short explanation + a **Close change request** button (abandon). Resolving is
   done by revising the proposed change (the operation editor), per P7.

## Why

P7 made conflict CRs recoverable at the API level and persisted the conflicting
field list. This makes that visible and actionable in the reviewer UI instead of
a bare "conflict" status badge.

## Files Affected

- `src/domains/dashboard/components/change-request-review.tsx` — conflict reader,
  `ConflictDiffPanel`, composer conflict branch

## Breaking Changes

None — additive UI, gated on `status === "conflict"`.

## Testing

- `tsc --noEmit` clean, biome clean.
- Presentational component reading an existing VO field; the data shape it reads
  is produced and asserted by the P7 backend tests (`tests/boundary-p7.test.ts`).
- Not exercised in a live browser: seeing the panel requires manufacturing a
  conflict CR in a running host app (two CRs editing one field, merge one then
  the other), and the busabase preview is environment-flaky. The render path is
  status-gated and follows the existing panels in the same file.

## Follow-up Tasks

- Optionally fetch base/ours/theirs values to show a true side-by-side field diff
  (currently names the conflicting fields + relies on the operation diff below).
- Folder/doc/skill archive-restore UX, unified Trash view, folder cascade-delete
  confirmation, asset where-used UI.
