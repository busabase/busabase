---
title: 2026-07-12 AirApp Runner Store, Side Panel, Nodepod Watermark, Fullscreen Preview
---

# AirApp Runner Store, Side Panel, Nodepod Watermark, Fullscreen Preview

Date: 2026-07-12
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> Implement 4 related changes in packages/busabase-core: (1) fix the AirApp
> run-state bug where switching between two AirApp nodes and back kills a
> running app, by lifting run state into a zustand store keyed by node id;
> (2) remove the Nodepod preview watermark; (3) add a fullscreen button to
> the AirApp preview; (4) add a generic, net-new right-hand "side panel" that
> lets a user pin an AirApp's live preview so it survives canvas navigation.

**Refined Instructions:**
- Add `zustand` as a `busabase-core` dependency (workspace already resolves
  `zustand@5.0.12` via `apps/buda`).
- Move `useAirAppRunner`'s run state (status/logLines/previewUrl/error/runner)
  out of component-local `useState`/`useRef` into a zustand store keyed by
  node id, and delete the two `useEffect`s that disposed the runner on
  unmount and on every node-id change — disposal now only happens via an
  explicit `disposeEntry` action.
- Wire `NodeDeleteButton`'s new optional `onDeleted` callback so deleting an
  AirApp node actually calls `disposeEntry` instead of leaking the runner.
- Pass `watermark: false` to `Nodepod.boot()`.
- Add a `Maximize2` fullscreen toggle to `AirAppRunPreview`, modeled on
  `MultilineFieldPreview` in `field-preview.tsx`.
- Add a net-new generic side-panel system (store + registry + `SidePanel`
  component) mirroring the existing `node-detail-registry.tsx` pattern, mount
  it in `dashboard/index.tsx` next to the main canvas, register an
  `"airapp-preview"` tab renderer, and add a "pin to side panel" button next
  to the Run button.

## What Changed
- Added `zustand` (`5.0.12`) to `packages/busabase-core/package.json`.
- New `airapp-runner-store.ts`: a zustand store keyed by node id holding
  `{status, logLines, previewUrl, error, runner}` per AirApp node, with
  `beginRun`/`setStatus`/`appendLog`/`setPreviewUrl`/`setError`/`disposeEntry`
  actions and the existing 2000-line log cap.
- Rewrote `useAirAppRunner` (`RunPanel.tsx`) to read/write through that store
  instead of local `useState`/`useRef`, and removed both disposal
  `useEffect`s — switching between AirApp nodes (and back) no longer tears
  down a running or in-flight app. External return shape (`status, logLines,
  previewUrl, error, run, isBusy`) is unchanged.
- `NodeDeleteButton` (`file-tree-browser.tsx`) gained an optional `onDeleted`
  callback, fired after a successful delete; `AirAppDetailView` wires it to
  `disposeEntry` so deleting an AirApp node tears down its runner. No-op for
  every other node type that uses this shared button.
- `NodepodRunner.mount()` now passes `watermark: false` to `Nodepod.boot()`,
  removing the "nodepod" watermark link from preview iframes.
- `AirAppRunPreview` gained a fullscreen toggle (Maximize2 button + `kui`
  `Dialog`) showing the same running iframe at `h-[90vh] w-[95vw]
  max-w-[1040px]`, and a "pin to side panel" button (`PanelRightOpen`) that
  opens/activates an `"airapp-preview"` tab in the new side panel. Both
  buttons require the (now-threaded) `airapp` prop.
- New generic side-panel system: `side-panel-store.ts` (isOpen/activeTabId/
  tabs, `openTab`/`closeTab`/`setActiveTab`/`setOpen` — tabs persist across
  `setOpen(false)`), `side-panel-registry.tsx` (Map-based tab-type →
  renderer registry mirroring `node-detail-registry.tsx`), and
  `side-panel.tsx` (the UI: renders `null` with no open tabs, a tab strip
  with per-tab close buttons, a collapse/expand rail, and every open tab kept
  mounted simultaneously via CSS-hide-when-inactive so a pinned AirApp
  preview never unmounts).
- Registered `"airapp-preview"` → `AirAppSidePanelPreview` (new component in
  `RunPanel.tsx`, fetches the same airapp record `AirAppDetailView` does and
  renders `AirAppRunPreview` — automatically shares live run state with the
  main detail view via the node-id-keyed store).
- Mounted `<SidePanel orpc={orpc} />` beside `activeView` in
  `dashboard/index.tsx`.
- Added `airapp.pinToSidePanel` and a new `sidePanel` (`open`/`collapse`/
  `closeTab`) i18n namespace to `messages.ts` (English), `zh-CN.ts`, and
  `ja.ts`. `zh-TW.ts` was intentionally left unchanged — it spreads
  `...dashboardZhCN` and only overrides specific namespaces, per its
  documented convention, so it inherits these new strings from `zh-CN.ts`
  automatically.

## Why
- The node-detail registry (`node-detail-registry.tsx`) is a `Map<type,
  renderer>`, so `AirAppDetailView` is the same function reference across
  every AirApp node — React never unmounts it on node switch, only the
  `slug` prop changes. The old `useAirAppRunner` reset/disposed its
  component-local run state on every `airapp?.node.id` change specifically
  to avoid state bleeding across nodes, which had the side effect of killing
  a still-running app the moment the user switched away and back. Keying the
  state by node id in a store removes the need for that reset entirely.
- A visible "nodepod" watermark on every AirApp preview looks unpolished in
  product; the SDK has an official flag to turn it off.
- Long-running or actively-being-demoed AirApp previews benefit from staying
  reachable (pinned) while the user does something else on the canvas, and
  from a larger fullscreen view for presenting/reviewing.

## Files Affected
- `packages/busabase-core/package.json` - Added `zustand` dependency.
- `packages/busabase-core/src/domains/airapp/store/airapp-runner-store.ts` - New: node-id-keyed run-state store.
- `packages/busabase-core/src/domains/airapp/components/RunPanel.tsx` - Store-backed `useAirAppRunner`, fullscreen + pin-to-side-panel buttons, new `AirAppSidePanelPreview`.
- `packages/busabase-core/src/domains/airapp/components/AirAppDetailView.tsx` - Threaded `airapp` into `AirAppRunPreview`; wired `NodeDeleteButton`'s `onDeleted` to `disposeEntry`.
- `packages/busabase-core/src/domains/airapp/components/runners/nodepod-runner.ts` - `watermark: false`.
- `packages/busabase-core/src/domains/dashboard/store/side-panel-store.ts` - New: side-panel tabs/visibility store.
- `packages/busabase-core/src/domains/dashboard/side-panel-registry.tsx` - New: tab-type → renderer registry.
- `packages/busabase-core/src/domains/dashboard/components/side-panel.tsx` - New: side-panel UI.
- `packages/busabase-core/src/domains/dashboard/components/node-detail-views.tsx` - Registered `"airapp-preview"` side-panel tab.
- `packages/busabase-core/src/domains/dashboard/components/file-tree-browser.tsx` - `NodeDeleteButton` gained optional `onDeleted`.
- `packages/busabase-core/src/domains/dashboard/index.tsx` - Mounted `<SidePanel>` beside `activeView`.
- `packages/busabase-core/src/i18n/messages.ts`, `zh-CN.ts`, `ja.ts` - New `airapp.pinToSidePanel` + `sidePanel` strings.
- `pnpm-lock.yaml` - Regenerated via `pnpm install` for the new `zustand` dependency.

## Breaking Changes
- None. `AirAppRunPreview` gained a required `airapp` prop, but it is an
  internal (non-exported-via-`package.json`) component only used by
  `AirAppDetailView` and the new `AirAppSidePanelPreview`, both updated in
  this change. `NodeDeleteButton`'s new `onDeleted` prop is optional.

## Testing
- `pnpm --filter busabase-core exec tsc --noEmit` — pass.
- `pnpm --filter busabase typecheck` — pass.
- `pnpm --filter busabase-cloud typecheck` — pass.
- `pnpm lint:err` (full repo) — pass, 0 errors.
- Manual reasoning walkthrough of the switch-away-and-back scenario against
  the new store-keyed design (no automated e2e added in this change).

## Follow-up Tasks
- Add an e2e/integration test that runs an AirApp, switches to a different
  AirApp node, switches back, and asserts the preview iframe/log stream is
  still alive (not currently covered by any existing test suite).
- Consider persisting side-panel tabs (e.g. `localStorage`) across a page
  reload, similar to `use-git-tab-repo-store.ts`'s `persist` middleware — not
  done here since it wasn't requested and pinned tabs reference live,
  non-serializable runner state anyway.
