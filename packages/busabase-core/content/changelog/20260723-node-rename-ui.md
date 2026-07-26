---
title: 2026-07-23 Node Rename UI for Folder/Drive/Doc/File/Skill/AirApp
---

# Node Rename UI for Folder/Drive/Doc/File/Skill/AirApp

Date: 2026-07-23
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> An API audit of busabase found that `nodes.createChangeRequest` with a
> `rename` operation already exists, but the UI only used it for Base nodes
> (via the Design Tab). Folder/Drive/Doc/File/Skill/AirApp had no rename
> entry point at all.

**Refined Instructions:**
- Add a "Rename" item to the sidebar "•••" menu for every non-Base node type.
- Detail pages should not get a standalone Rename button sitting next to
  Permissions — instead, a single "..." trigger in the topbar should open a
  shared dropdown (Rename + Permissions) reusing the exact same dialogs as
  the sidebar.
- Reuse the existing `nodes.createChangeRequest` (`kind: "rename"`) endpoint
  and its permission-aware auto-merge semantics — no new backend logic.

## What Changed
- New `NodeRenameDialog` (rename form + submit, permission-aware immediate-vs-review
  choice via `SplitSubmitButton`) and `NodeActionsMenu` (single "..." dropdown
  shared by every node-detail topbar, containing Rename + Permissions).
- Sidebar "•••" menu (`buildNavItem` in `dashboard-shell.tsx`) gained a Rename
  action, excluded for `node.type === "base"` (Base keeps its own Design Tab
  rename path, untouched).
- `FileTreeDetailView`/`FileNodeDetailView`/`DocDetailView`/`FolderDetailView`
  (`node-detail-views.tsx`) and `AirAppDetailView.tsx` topbars now render one
  `NodeActionsMenu` instead of a standalone `NodePermissionsButton`.
- Fixed a stale-title bug found during verification: detail-page queries
  (`folders.get`/`docs.get`/`files.get`/`skills.get`/`drives.get`/`airapp.get`)
  are keyed by route **slug**, not the database node id, so the rename
  dialog's cache invalidation now matches on both `nodeId` and `nodeSlug` —
  previously only the sidebar refreshed live, and a detail page's own header
  stayed stale until a full page reload.
- i18n: added a `rename` message namespace (EN/zh-CN/ja; zh-TW inherits from
  zh-CN) and `common.moreActions` for the new "..." button's a11y label.

## Why
- Backend capability existed and was fully unused for 6 of 7 node types —
  users had no way to rename a Folder, Drive, Doc, File, Skill, or AirApp
  from the UI at all.

## Files Affected
- `packages/busabase-core/src/domains/dashboard/components/node-rename-dialog.tsx` — new
- `packages/busabase-core/src/domains/dashboard/components/node-actions-menu.tsx` — new
- `packages/busabase-core/src/domains/dashboard/components/dashboard-shell.tsx` — sidebar Rename action wiring
- `packages/busabase-core/src/domains/dashboard/components/node-detail-views.tsx` — 4 detail views switched to `NodeActionsMenu`
- `packages/busabase-core/src/domains/airapp/components/AirAppDetailView.tsx` — switched to `NodeActionsMenu`
- `packages/busabase-core/src/i18n/messages.ts`, `zh-CN.ts`, `ja.ts` — new `rename` + `common.moreActions` strings

## Breaking Changes
None.

## Testing
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter busabase-core exec tsc --noEmit` — 0 errors, verified against a stashed baseline (also 0) so no new errors were introduced.
- `biome check` on all touched files — clean.
- Manual verification with a real local `apps/busabase` dev server (PGLite, non-demo data): renamed a Folder via the sidebar menu (name updated, toast shown, Merged count incremented, name persisted after a full reload) and via the new detail-page "..." menu (menu shows exactly Rename + Permissions, dialog pre-fills the current name, and — after the cache-key fix — the detail page's own header updates immediately without a reload).

## Follow-up Tasks (Optional)
- Only Folder was manually clicked through in the browser; Doc/File/Drive/Skill/AirApp share the exact same `NodeActionsMenu`/`NodeRenameDialog` code path but weren't individually re-clicked.
