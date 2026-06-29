---
title: 2026-06-29 Boundary P11 — node delete UI + folder cascade confirmation
---

# Boundary P11 — node delete UI (folder/doc/skill)

Date: 2026-06-29
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> 继续做（边界审计 follow-up）。

**Refined Instructions:**
- P9 soft-deletes folder/doc/skill nodes and P10 lists/restores them in Trash —
  but the dashboard had **no UI to delete a node in the first place**, so the
  Trash node section was unreachable in practice. Add a delete affordance, with
  the folder cascade-delete confirmation from the follow-up list.

## What Changed

`domains/dashboard/components/node-detail-views.tsx`:

1. **`NodeDeleteButton`** — a reusable Delete action used by the folder, doc, and
   skill detail headers. It creates a `node_delete` change request, approve-merges
   it (soft-archive → recoverable), invalidates the node tree + archived-nodes
   queries, toasts, and navigates home.
2. **Cascade confirmation** — uses the existing `ConfirmActionDialog`. For a
   folder with children it warns: "moves the folder and its N items to Trash. You
   can restore them later." Other nodes get the single-item copy.

This makes the P9/P10 node-lifecycle reachable end-to-end from the UI: delete a
folder/doc/skill → it lands in Trash → restore it there.

## Why

Closes the UX gap: deletion + restore existed at the API level but had no entry
point in the app. Also delivers the folder cascade-delete confirmation follow-up.

## Files Affected

- `src/domains/dashboard/components/node-detail-views.tsx` — `NodeDeleteButton`
  + delete actions in the folder/doc/skill headers

## Breaking Changes

None. Additive UI; deletion is the recoverable soft-archive from P9.

## Testing

- `tsc --noEmit` clean, biome clean.
- The `node_delete` flow this UI drives is covered by `tests/boundary-p9.test.ts`
  (soft-delete + subtree + restore). The confirm dialog reuses the proven
  `ConfirmActionDialog`; the mutation pattern mirrors the existing
  `DocDetailView` change-request flow.
- **Not browser-verified**: the route is hosted by `apps/busabase` (preview is
  environment-flaky and seeing the button needs a seeded host app + navigation to
  a node-detail page).

## Follow-up Tasks

- Trash permanent-delete (purge) once a retention/purge backend exists.
- (Asset where-used UI is already implemented in `components/assets.tsx`.)
