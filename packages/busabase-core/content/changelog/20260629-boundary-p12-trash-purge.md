---
title: 2026-06-29 Boundary P12 — Trash permanent delete (purge)
---

# Boundary P12 — Trash permanent delete (purge)

Date: 2026-06-29
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> 继续剩余的（最后一项：Trash 永久删除 / purge）。

**Refined Instructions:**
- The Trash (P10) could restore archived nodes but had no way to permanently
  remove them. Add a manual purge (no auto-retention timer), with safe scoping
  given the FK constraints discovered during analysis.

## What Changed

1. **`purgeNode(nodeId)`** (`logic/nodes.ts`)
   - Permanently deletes an archived folder/doc/skill node **and its subtree**.
   - Refused unless the node is archived; refused if the subtree contains a
     **Base** (a Base's commit history is FK-restricted — a separate concern).
   - Deletes in dependency order — operations → commits → change-requests →
     nodes — because `operations.headCommitId` RESTRICTs commits, so a single
     cascade from `nodes` could evaluate the FKs out of order. (P12 tests run the
     purge for real, so a wrong order would fail there.)

2. **API surface** — `nodes.purge` (`DELETE /nodes/{nodeId}` → `{ purged }`) in
   the contract, router, demo stub (unsupported), and the dashboard api-client
   (`purgeNode`).

3. **Trash UI** (`dashboard/components/archived-bases.tsx`, `dashboard/index.tsx`)
   - Each archived folder/doc/skill row gets a **Delete forever** button next to
     Restore, gated behind a `ConfirmActionDialog` ("This cannot be undone").
   - `submitPurgeNode` calls `purgeNode`, invalidates the archived-nodes query,
     and toasts. Bases have no purge action (their history is restricted).

## Why

Closes the last node-lifecycle gap: items could pile up in Trash with no way to
permanently remove them. Purge is scoped to what can be safely hard-deleted.

## Files Affected

- `src/logic/nodes.ts` — `purgeNode` + `collectSubtreeIds`
- `src/contract/busabase.ts`, `src/router.ts`, `src/router-demo.ts`,
  `src/api-client/index.ts` — `nodes.purge` surface
- `src/domains/dashboard/components/archived-bases.tsx`, `.../index.tsx` —
  Delete-forever button + confirm + `submitPurgeNode`
- `tests/boundary-p12.test.ts` — 3 PGLite tests

## Breaking Changes

None. Additive. Purge is irreversible by design but gated (archived-only +
confirmation + no-Base-in-subtree).

## Testing

- `vitest run --no-file-parallelism` — 332 passed (incl. 3 new P12 tests),
  `tsc --noEmit` clean. (The default parallel run skips some DB suites due to a
  pre-existing PGLite global-singleton contention; they pass sequentially / in
  isolation.)
- Fix 1 executes a real purge, proving the operations→commits→CRs→nodes order.
- **UI not browser-verified**: the Trash route is hosted by `apps/busabase`
  (preview environment-flaky). Confirm dialog reuses the proven
  `ConfirmActionDialog`.

## Follow-up Tasks

- Base purge (delete a Base + its full commit history) needs a dedicated
  history-handling design — intentionally out of scope here.
