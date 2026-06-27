---
title: 2026-06-22 Add "Create & Merge" option to Create Node modal
---

# Add "Create & Merge" option to Create Node modal

Date: 2026-06-22
Author: Kelly
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> 测试跑一下，创建Base，创建的时候可以选择 Create & Merge 或 Create Change Request。创建完毕后，要在左边看到新建的Base

**Refined Instructions:**
- Replace the single "Create" button with two: "Create Change Request" and "Create & Merge"
- "Create & Merge" creates the CR, auto-approves it, and merges it so the base appears immediately in the sidebar
- Update callers in busabase and busabase-cloud to handle the new `mode` parameter

## What Changed

- `packages/busabase-core/src/dashboard/create-node-modal.tsx`:
  - Changed `onCreated` signature: `(changeRequestId, mode: "change-request" | "merged") => void`
  - Added `submitAsChangeRequest()` — existing behavior, calls `createNodeChangeRequest`
  - Added `submitAndMerge()` — creates CR, then `approveChangeRequest` + `mergeChangeRequest`
  - Split footer into two action buttons side-by-side: "Create Change Request" (outline) + "Create & Merge" (primary)
  - Updated dialog description to explain the two modes

- `apps/busabase-cloud/src/domains/busabase-dashboard/components/dashboard-view.tsx`:
  - Updated `onCreated` handler: `mode === "merged"` → `router.refresh()` + navigate to `/dashboard`; `"change-request"` → navigate to inbox CR

- `apps/busabase/src/app/dashboard/client.tsx`:
  - Same `mode`-aware handler update

## Why

Previously all node creation went through the change-request → review → merge flow, meaning the new base wouldn't appear in the sidebar until manually approved and merged. "Create & Merge" bypasses review for cases where the user wants the base immediately available.

## Files Affected

- `packages/busabase-core/src/dashboard/create-node-modal.tsx` — two-button UI + merge path
- `apps/busabase-cloud/src/domains/busabase-dashboard/components/dashboard-view.tsx` — mode-aware callback
- `apps/busabase/src/app/dashboard/client.tsx` — mode-aware callback

## Breaking Changes

`onCreated` now receives a second `mode` argument — callers using the old single-arg signature get `mode` as `undefined` which is falsy, so existing TS callers that ignore it won't break at runtime, but TypeScript will error. Both callers are updated.

## Testing

1. Open the dashboard sidebar, click "+" next to BASES
2. Select "Base", type a name
3. Click "Create Change Request" → navigates to the CR in the inbox (base not in sidebar yet)
4. Click "Create & Merge" → modal closes, base appears immediately in the BASES sidebar section; "Merged" tab increments
