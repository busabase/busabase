---
title: 2026-06-22 SplitSubmitButton reusable component — unified CR/merge pattern
---

# SplitSubmitButton — unified CR/merge pattern

Date: 2026-06-22
Author: Kelly
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> 检查所有地方的 Create Change Request 和 Create & Merge 按钮，都做成复用组件，是一个按钮，默认都是 change request 而已，[Change Request][↓] 类似样式！全部复用

**Refined Instructions:**
- Extract a `SplitSubmitButton` component: left segment = primary CR action, right chevron = dropdown with merge-now option
- Replace all 4 call sites: Create Node modal, Record editor, View form, Add Field
- Copy pattern: `[Verb Noun Request]` (primary) → `[Verb Now]` (secondary)
- Secondary "...Now" = Create CR + approve + merge, so it resolves immediately

## What Changed

- **`split-submit-button.tsx`** (new): reusable split button with outside-click handler, dropdown rendered `bottom-full` (above button), optional hint line at top of dropdown

- **`create-node-modal.tsx`**: replaced two-button layout with `SplitSubmitButton`:
  - Primary: `"Create [Type] Request"` | Secondary: `"Create Now"`

- **`index.tsx`** — record editor (line ~4808): SplitSubmitButton
  - Primary: `mode === "new" ? "Submit Request" : "Update Request"`
  - Secondary: `mode === "new" ? "Submit Now" : "Update Now"`

- **`index.tsx`** — view form (line ~5948): SplitSubmitButton
  - Primary: `mode === "create" ? "Add View Request" : "Update View Request"`
  - Secondary: `mode === "create" ? "Add View Now" : "Update View Now"`

- **`index.tsx`** — Add Field (line ~4310): SplitSubmitButton
  - Primary: `"Add Field Request"` | Secondary: `"Add Field Now"`
  - **Note**: both paths call `submit()` directly — backend field schema CR not yet implemented

- **`index.tsx`** — `export { SplitSubmitButton }` added to dashboard barrel

## Why

Unifying all submit interactions into one pattern reduces cognitive load: users always know the left button is the safe review path, and the chevron reveals the bypass-review option. Consistent copy makes the mental model transferable across all creation flows.

## Files Affected

- `packages/busabase-core/src/dashboard/split-submit-button.tsx` — new component
- `packages/busabase-core/src/dashboard/create-node-modal.tsx` — updated
- `packages/busabase-core/src/dashboard/index.tsx` — 3 call sites updated

## Breaking Changes

None — `onCreated` signature change was already done in prior session.

## Follow-up Tasks

- Backend: implement field-schema change requests so "Add Field Request" can go through a real review flow
