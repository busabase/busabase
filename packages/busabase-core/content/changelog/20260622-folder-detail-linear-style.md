---
title: 2026-06-22 Folder Detail – Linear Style
---

# Folder Detail – Linear Style

Date: 2026-06-22
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> 路由：/dashboard/folder/personal-knowledge。这个 folder detail 页面。优化一下，Linear 风格一点，比如没有框线

**Refined Instructions:**
- Remove the `rounded-xl border bg-background p-5` card wrapper — content sits directly on the page
- Remove `divide-y` list dividers — use hover row highlight instead
- Replace bordered badge `(type)` with a small muted text label and a leading icon per node type
- Move item count above the list as a small uppercase section label
- Increase title size to `text-2xl` for a document-header feel

## What Changed

- **Modified**: `packages/busabase-core/src/dashboard/index.tsx`
  - `FolderDetailView`: removed outer card (`rounded-xl border`); flat `px-6 py-8` layout
  - Item list: `div` with `flex flex-col` + per-row `hover:bg-muted/50 rounded-md` instead of `ul.divide-y`
  - Each row: node-type icon (Folder / Table2 / FileText / Sparkles) + name + muted type label
  - Count: small `11px uppercase tracking-widest` label above the list
  - Added `FOLDER_CHILD_ICONS` map (folder → Folder, base → Table2, doc → FileText, skill → Sparkles)
  - Added `FileText`, `Folder`, `Table2` to lucide-react imports

## Why

The previous layout wrapped content in a bordered card box, which adds visual noise and feels more "form-like" than document-like. Linear's style is fully flat — just typography and subtle hover states — which suits a folder listing better.

## Files Affected

- `packages/busabase-core/src/dashboard/index.tsx` — FolderDetailView redesign

## Breaking Changes

None

## Testing

1. Navigate to `/dashboard/folder/personal-knowledge` (or any folder route)
2. Verify: no border box around the content
3. Verify: large flat title, no card chrome
4. Verify: items show icon + name + muted type label; no dividers between rows
5. Verify: hovering an item shows subtle `bg-muted/50` background
6. Verify: empty folder shows EmptyState without the card wrapper
