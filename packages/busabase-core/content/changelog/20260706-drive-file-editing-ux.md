---
title: 2026-07-06 Drive File Editing UX
---

# Drive File Editing UX

Date: 2026-07-06
Author: AI Assistant
AI Agent: Codex

## Prompts & Instructions

**Original Request:**
> Drive 用起来都正常吗？对 Drive 工程做全方位测试，apps/busabase-cli、apps/busabase-sdk、apps/busabase 等；create pr.

**Refined Instructions:**
- Test Drive through CLI, SDK, API, and the Busabase dashboard.
- Fix the highest-impact Drive usability gaps found during testing.
- Open a PR with focused validation.

## What Changed
- Added Drive/Skill web file editing in the shared file-tree detail view.
- Defaulted file-tree detail pages to open the configured entry file, usually `README.md`.
- Submitted web file edits as reviewable file-tree Change Requests with `baseContentHash`.
- Returned explicit `BAD_REQUEST` for invalid file paths and `CONFLICT` for stale file merges.
- Added Drive oRPC integration coverage for update merge, stale hash conflicts, and invalid paths.

## Why
- The Drive backend, CLI, and SDK already supported file CRUD, but the web dashboard only allowed reading files.
- Stale file writes and invalid paths were functionally blocked but surfaced as generic server errors.

## Files Affected
- `packages/busabase-core/src/domains/dashboard/components/node-detail-views.tsx` - Entry-file auto-open and file edit actions.
- `packages/busabase-core/src/domains/filetree/handlers.ts` - Stale hash conflict error mapping.
- `packages/busabase-core/src/domains/filetree/logic/storage.ts` - Invalid path error mapping.
- `packages/busabase-core/tests/drives-orpc.test.ts` - Drive-specific integration coverage.

## Breaking Changes
- None.

## Testing
- `npx -y pnpm@10.15.1 --filter busabase-core test -- tests/drives-orpc.test.ts tests/skills-orpc.test.ts`
- `npx -y pnpm@10.15.1 --filter busabase-core exec tsc --noEmit --pretty false --skipLibCheck` currently fails because the workspace overrides `@types/minimatch` to `-` while TypeScript still asks for that implicit type package.

## Follow-up Tasks
- Add create/delete/upload file actions to the web Drive UI.
- Add `baseContentHash` to mobile Drive and Skill file edits.
