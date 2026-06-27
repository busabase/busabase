---
title: 2026-06-22 Split store.ts into kernel + skill storage modules
---

# Split store.ts into kernel + skill storage modules

Date: 2026-06-22
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> 那分拆一下不？

**Refined Instructions:**
- Extract pure kernel utilities (no DB) from `store.ts` into `logic/kernel.ts`
- Extract skill file storage helpers into `domains/skill/logic/storage.ts`
- Update all 4 domain handlers to import from new locations
- No re-export shims — move modules and rewrite imports directly

## What Changed

- **NEW** `src/logic/kernel.ts` — pure kernel utilities: `id()`, `now()`, `hashText()`, `requireBaseId()`, `CURRENT_USER_ID`, `ROOT_NODE_ID`, `rootNodeIdForSpace()`
- **NEW** `src/domains/skill/logic/storage.ts` — skill file storage helpers: `normalizeSkillFilePath`, `skillStoragePrefix`, `resolveSkillStoragePrefix`, `getSkillNode`, `readSkillTextFile`, `writeSkillTextFile`, `deleteSkillFile`, `listSkillStorageFiles`
- **MODIFIED** `src/logic/store.ts` — removed ~625 lines (kernel utils + skill storage + agent-rules seed); imports from new modules
- **MODIFIED** `src/domains/skill/handlers.ts` — updated imports to kernel + storage
- **MODIFIED** `src/domains/doc/handlers.ts` — updated imports to kernel
- **MODIFIED** `src/domains/folder/handlers.ts` — updated imports to kernel
- **MODIFIED** `src/domains/base/handlers.ts` — updated imports to kernel

Also in this session:
- **NEW** `apps/busabase/scripts/demo-skills.ts` — end-to-end OpenAPI skill creation demo script
- Removed `seedAgentRulesSkillIfMissing` from seed (agent-rules no longer auto-seeded; use OpenAPI instead)

## Why

`store.ts` had grown to ~3000 lines mixing concerns: pure utilities, DB/storage helpers, and all the CR/merge/audit infrastructure. Splitting it makes each module independently testable and reduces import surface for handlers that only need id/now/hashText.

## Files Affected

- `packages/busabase-core/src/logic/kernel.ts` — NEW: pure kernel utils
- `packages/busabase-core/src/domains/skill/logic/storage.ts` — NEW: skill storage helpers
- `packages/busabase-core/src/logic/store.ts` — removed kernel + storage fns
- `packages/busabase-core/src/domains/skill/handlers.ts` — updated imports
- `packages/busabase-core/src/domains/doc/handlers.ts` — updated imports
- `packages/busabase-core/src/domains/folder/handlers.ts` — updated imports
- `packages/busabase-core/src/domains/base/handlers.ts` — updated imports
- `apps/busabase/scripts/demo-skills.ts` — NEW: OpenAPI demo script

## Breaking Changes

None (internal refactor only, all exports from `store.ts` remain stable)

## Testing

- `pnpm --filter busabase-core exec tsc --noEmit` — passes (no output)
- `biome check` — passes (5 files formatted)
- Run `apps/busabase/scripts/demo-skills.ts` against a live server to verify skill CRUD flow
