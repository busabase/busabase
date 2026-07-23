---
title: 2026-07-23 Pin Any Node to Side Panel, Persistent Side Panel Toggle
---

# Pin Any Node to Side Panel, Persistent Side Panel Toggle

Date: 2026-07-23
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> Every node detail view in apps/busabase should have a Pin button in its
> top-right corner — today only AirApp content can be pinned to the side
> panel. Also align the side panel's expand/collapse toggle with how
> apps/buda does it (persistently present in every page's top-right header),
> instead of the toggle disappearing entirely whenever nothing is pinned.

**Refined Instructions:**
- Reuse the existing, already type-agnostic `useSidePanelStore` +
  `side-panel-registry.tsx` infrastructure (built for AirApp) — no new
  cross-realm state needed for the 6 remaining node types.
- Add a shared `NodePinButton` following the existing `NodePermissionsButton`/
  `NodeDeleteButton` precedent (one small component, manually imported into
  each of the 7 node-detail headers) rather than inventing a header-slot
  abstraction.
- Give `DocDetailView`, `FolderDetailView`, `FileNodeDetailView`,
  `FileTreeDetailView` (Skill/Drive) a `hideActions` prop so the same
  component can render inside the side panel without its node-level
  Pin/Permissions/Delete actions (Doc additionally can't enter edit mode when
  `hideActions` is set, to avoid two concurrent drafts of the same doc).
- Base needed its own lightweight, read-only `BaseSidePanelPreview` instead of
  reusing `BaseDetailView`, since that view depends on a page's worth of
  mutation callbacks wired up in `dashboard/index.tsx` that don't exist in an
  independently-mounted side-panel tab.
- Decouple the side panel's open/collapse toggle from whether anything is
  pinned: move it into the dashboard's persistent topbar as a
  `SidePanelToggle` button that's always rendered (disabled, not hidden, when
  nothing is pinned yet), mirroring apps/buda's always-present panel toggle.
- No `localStorage` persistence for pinned tabs or panel open state — not
  requested, and the prior AirApp-only side panel changelog already declined
  this for the same reason.

## What Changed
- New `packages/busabase-core/src/domains/dashboard/components/node-pin-button.tsx`:
  a stateless `NodePinButton` (icon-only, styled like `NodePermissionsButton`)
  that calls `useSidePanelStore.getState().openTab(...)`, plus a
  `nodeSidePanelTabId(nodeType, nodeId)` helper (AirApp's own
  `airAppSidePanelTabId` is unchanged, still `airapp-${nodeId}`).
- Added a Pin button to all 6 remaining node-detail headers: `FileTreeDetailView`
  (shared by Skill/Drive), `FileNodeDetailView`, `DocDetailView` (view mode
  only), `FolderDetailView` (all in `node-detail-views.tsx`), and
  `BaseDetailHeader` (`base-views.tsx`).
- `DocDetailView`, `FolderDetailView`, `FileNodeDetailView`,
  `FileTreeDetailView` (and its `SkillDetailView`/`DriveDetailView` wrappers)
  gained an optional `hideActions?: boolean` prop that hides the
  Pin/Permissions/Delete cluster; Skill/Drive's own file-tree browsing and
  inline file editing stay available in the side panel (content operations,
  not node-level ones).
- Registered 5 new side-panel tab renderers in `node-detail-views.tsx`
  (`doc-preview`, `file-preview`, `folder-preview`, `skill-preview`,
  `drive-preview`), each a thin adapter rendering the matching DetailView with
  `hideActions`.
- New `BaseSidePanelPreview` in `base-views.tsx`: reads `orpc.bases.list`
  (already-warm cache), shows name/description/field-count, and an "Open full
  base" link — registered as `base-preview`.
- Moved `pinToSidePanel` from the `airapp` i18n namespace to the shared
  `nodeDetail` namespace (`messages.ts`, `zh-CN.ts`, `ja.ts`; `zh-TW.ts`
  inherits via its `...dashboardZhCN` spread, unchanged) and reworded it from
  "Open in side panel" to "Pin to side panel" to match the action name used
  everywhere else. `RunPanel.tsx`'s two references updated accordingly. Also
  added `nodeDetail.baseNotFoundTitle`/`baseNotFoundBody`/`openFullBase`
  (Base had no side-panel-facing strings before).
- New `SidePanelToggle` export in `side-panel.tsx`: always rendered in the
  dashboard topbar (`dashboard/index.tsx`, next to `topbarActions`),
  `disabled` (not hidden) when nothing is pinned. `SidePanel` itself now
  returns `null` when `tabs.length === 0 || !isOpen` (previously just
  `tabs.length === 0`, with its own collapsed-state entry stub) — the
  collapsed-state stub button was removed since `SidePanelToggle` now owns
  that job from the topbar.

## Why
Pin-to-side-panel was built for AirApp's "keep a live dev-server preview
reachable while you work elsewhere" use case, but the underlying mechanism
(`useSidePanelStore` + `side-panel-registry.tsx`) was already fully
type-agnostic — nothing about it was AirApp-specific except that no other
node type had a Pin button or a registered renderer. The same "glance at this
while I'm doing something else" need applies to a Base, Doc, or file just as
much as an AirApp. Separately, the old "no tabs → nothing renders at all"
design meant the panel's own open/collapse affordance only existed once
something was already pinned, so there was no persistent, discoverable entry
point — apps/buda's pattern of an always-present (enabled-when-relevant)
toggle in the topbar fixes that.

## Files Affected
- `packages/busabase-core/src/domains/dashboard/components/node-pin-button.tsx` - New: shared `NodePinButton` + `nodeSidePanelTabId`.
- `packages/busabase-core/src/domains/dashboard/components/node-detail-views.tsx` - Pin buttons + `hideActions` on Skill/Drive/File/Doc/Folder headers; 5 new `registerSidePanelTab` calls.
- `packages/busabase-core/src/domains/dashboard/components/base-views.tsx` - Pin button on `BaseDetailHeader`; new `BaseSidePanelPreview` + registration.
- `packages/busabase-core/src/domains/dashboard/components/side-panel.tsx` - New `SidePanelToggle`; `SidePanel` early-return and collapsed-stub removal.
- `packages/busabase-core/src/domains/dashboard/index.tsx` - Mounted `<SidePanelToggle />` in the persistent topbar.
- `packages/busabase-core/src/domains/airapp/components/RunPanel.tsx` - `airapp.pinToSidePanel` → `nodeDetail.pinToSidePanel`.
- `packages/busabase-core/src/i18n/messages.ts`, `zh-CN.ts`, `ja.ts` - Moved/reworded `pinToSidePanel`; added Base not-found + open-full-base strings.

## Breaking Changes
None. `hideActions` is optional and defaults to `false` on every component
that gained it; existing full-page node-detail usage is unaffected.

## Testing
- `pnpm --filter busabase-core exec tsc --noEmit` — pass.
- `pnpm --filter busabase exec tsc --noEmit` — pass.
- `pnpm --filter busabase-cloud exec tsc --noEmit` — pass.
- `pnpm biome check` on all touched files — pass, 0 errors.
- Real browser verification against `apps/busabase` with the full demo
  dataset (`pnpm db:seed && pnpm demo`, real Folders/Bases/Docs/Files/
  Skills/Drives/AirApps, no mocks): pinned one node of each of the 7 types
  from its detail header and confirmed the side panel opened the correct
  read-only/reduced preview (Base showed name + field count + "Open full
  base"; Doc/Folder/File showed content with Permissions/Delete hidden;
  Skill/Drive kept their file browser and inline editor). Confirmed the
  topbar toggle starts disabled with zero pins, enables and toggles
  open/collapsed correctly after pinning, and returns to disabled after
  closing every pinned tab. Regression-checked AirApp's own pin flow (still
  shares live runner state between the main view and the pinned copy,
  unaffected by the i18n key rename). Zero browser console errors across all
  of the above.

## Follow-up Tasks
- No `localStorage` persistence for pinned tabs or panel open/collapsed
  state — same rationale as the original AirApp-only implementation; revisit
  if users want pins to survive a page reload.
