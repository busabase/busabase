---
title: 2026-07-19 Compact Header for Drive/Skill/File Node Detail
---

# Compact Header for Drive/Skill/File Node Detail

Date: 2026-07-19
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> busabase，参考AirApp Detail页面的排版，上面部分已经占据位置少了很多。现在Drive Node Detail, Files Node Detail，ui界面还是不好看，希望重新排版。

**Refined Instructions:**
- Redesign the Drive Node Detail and Files Node Detail top sections to match `AirAppDetailView`'s compact single toolbar-row pattern, which already replaced a stacked title-block/properties header with a ~48px bar.
- `FileTreeDetailView` (the component behind Drive) is shared with the Skill node type via a `nodeType` prop — after confirming with the user, redesign the shared component so Drive and Skill both get the compact header rather than forking a Drive-only copy.
- Move each page's secondary info (description, files/visibility/version/entry-file properties, or backing-asset metadata) into an `Info` popover, mirroring AirApp's pattern, so the header stays a single row and content gets the reclaimed vertical space.

## What Changed
- `FileTreeDetailView` (Drive + Skill): replaced the 3-row stacked header (icon+label+title+description block, actions row, separate properties `<dl>` strip) with a single `h-12` toolbar — icon + name + an `Info` popover (description + files/visibility/version/entry-file) on the left, Permissions/Delete on the right.
- `FileNodeDetailView` (Files/`file` node type): same toolbar pattern. Removed the right-hand metadata `<aside>` sidebar; its contents (backing-asset file/type/size/asset/hash/url + `AssetMetadataBlock`) moved into the `Info` popover, so the file/image preview now gets the full width below the header instead of sharing a grid with a sidebar.
- Added a `nodeDetail.details` i18n key (en/zh-CN/ja; zh-TW inherits it via its zh-CN spread) for the popover trigger's `aria-label`/`title`.

## Why
The previous stacked headers on Drive/Skill/File took up 3 rows of vertical space before any real content appeared, while AirApp's node detail already had a single compact toolbar. Moving secondary metadata into a popover (as AirApp already does) makes the four node-detail views visually consistent and gives the actual content — file tree/code, skill file browser, asset preview — more room.

## Files Affected
- `packages/busabase-core/src/domains/dashboard/components/node-detail-views.tsx` - Compact header for `FileTreeDetailView` (Drive+Skill) and `FileNodeDetailView` (Files); metadata moved into `Info` popovers.
- `packages/busabase-core/src/i18n/messages.ts`, `zh-CN.ts`, `ja.ts` - Added `nodeDetail.details` key.

## Breaking Changes
None — purely a layout change; no props, routes, or data shape changed.

## Testing
- `pnpm exec tsc --noEmit -p .` in `packages/busabase-core` — clean.
- `pnpm exec tsc --noEmit -p .` in `apps/busabase` — same 86 pre-existing errors before and after this change (all in unrelated `busabase-cli/src/package/*` files, confirmed via `git stash`), zero new errors.
- Ran the app locally (`db:migrate` → `db:seed:all` → `pnpm dev`) and drove Drive (`/dashboard/drive/team-files`), Skill (`/dashboard/skill/ai-research-editor`), and File (`/dashboard/file/product-brief`) with Playwright: confirmed the compact header renders on all three, the `Info` popover opens and shows the expected description/properties/metadata, and the visual result (bar height, icon+name+info layout, action button placement) matches a screenshot of an existing AirApp Detail page.

## Follow-up Tasks (Optional)
- Doc/Folder node detail views still use their own (different, already fairly compact) header style — out of scope for this request, not touched.
