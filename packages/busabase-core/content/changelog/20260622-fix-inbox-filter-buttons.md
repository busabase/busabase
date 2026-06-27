---
title: 2026-06-22 Fix inbox filter/tab buttons not responding
---

# Fix inbox filter/tab buttons not responding

Date: 2026-06-22
Author: Kelly
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> 新分支继续改。http://localhost:3061/dashboard/inbox?view=approved 打开这个网址，切换 filter 按钮，没有变化

**Refined Instructions:**
- Find why clicking inbox filter/tab buttons has no visual effect and no URL update
- Fix the underlying routing/state bug

## What Changed

- `packages/busabase-core/src/dashboard/index.tsx`:
  - Added `useSearch` import from `wouter`
  - Added `const search = useSearch()` in `BusabaseDashboardContent`
  - Changed `readInboxView(location)` → `readInboxView(search)`
  - Changed `readInboxView` parameter from parsing `location.split("?")[1]` to accepting the search string directly (as returned by `useSearch()`)

## Why

Wouter v3's `useLocation()` returns **only the pathname** (e.g. `/inbox`), never the query string. The `readInboxView` function was trying to extract `?view=approved` from the pathname, getting an empty string every time, and always defaulting to `"review"` — so all filter tabs appeared stuck.

The separate `useSearch()` hook from wouter returns the search string without the leading `?` (e.g. `"view=approved"`), which `new URLSearchParams(search).get("view")` parses correctly.

## Files Affected

- `packages/busabase-core/src/dashboard/index.tsx` — fixed inbox view key derived from URL search params

## Breaking Changes

None

## Testing

1. Open `http://localhost:3061/dashboard/inbox`
2. Click any filter tab (Approved, Merged, Changes, etc.)
3. URL updates to `?view=<tab>` and the list content filters accordingly
4. Navigating directly to `?view=approved` shows the correct active tab on load
