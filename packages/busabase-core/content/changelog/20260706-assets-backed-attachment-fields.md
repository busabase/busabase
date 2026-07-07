---
title: 2026-07-06 Assets-Backed Attachment Fields
---

# Assets-Backed Attachment Fields

Date: 2026-07-06
Author: AI Assistant
AI Agent: Codex

## Prompts & Instructions

**Original Request:**
> apps/busabase，现在还会有用“attachment”吗？应该避免使用了吧？全部要基于assets。因为我发现个问题，我上传了数据表的附件字段，附件是有了，点击界面的Assets 没东西。

**Refined Instructions:**
- Treat `attachments` as the lower-level upload registry only.
- Keep Busabase's user-facing file library and where-used behavior based on `assets`.
- Fix table attachment-field uploads and legacy/imported attachment refs so Assets is populated and refreshed.
- Preserve backward compatibility for existing `{ id: attachmentId }` and `{ attachmentId }` field values.

## What Changed
- Attachment upload responses now include the Busabase `assetId` created for the uploaded file.
- Duplicate upload-url responses also ensure and return the existing asset, so clients that skip confirm still populate Assets.
- Dashboard attachment-field uploads now store asset-backed refs while retaining `attachmentId` for compatibility.
- Busabase's public contract now exposes `AssetAttachmentRef` for Base attachment field values, while keeping the lower-level `AttachmentRef` for non-library uploads.
- Base attachment field validation and dashboard parsing now accept `assetId`, `attachmentId`, and legacy `id` refs.
- Asset where-used sync now indexes asset-backed refs directly and self-heals legacy attachment refs via `ensureAsset`.
- Upload completion invalidates the Assets list query so the library updates immediately.
- Regression tests cover asset ids on upload, legacy `attachmentId` refs, and dashboard ref normalization.

## Why
- Users expect an uploaded table attachment to appear in Assets immediately.
- The old shape made `attachment` visible as a business concept and allowed some flows to create/store file refs without an Asset library row or usage.
- Assets should be the stable Busabase object; attachments remain the physical storage/dedup layer.

## Files Affected
- `packages/busabase-core/src/domains/attachments/router.ts` - Returns/ensures `assetId` for confirm and duplicate upload responses.
- `packages/busabase-core/src/domains/assets/handlers.ts` - Syncs where-used rows from asset-backed and legacy attachment refs.
- `packages/busabase-core/src/domains/base/field-types.ts` - Accepts new and legacy attachment field ref shapes.
- `packages/busabase-core/src/domains/dashboard/hooks/use-attachment-upload.ts` - Stores asset-backed inline refs from uploads.
- `packages/busabase-core/src/domains/dashboard/components/record-views.tsx` - Types attachment field uploads as asset-backed refs.
- `packages/busabase-core/src/domains/dashboard/helpers/field.ts` - Normalizes attachment refs for UI rendering.
- `packages/busabase-core/src/domains/dashboard/index.tsx` - Invalidates Assets after upload.
- `packages/busabase-contract/src/domains/base/types.ts` - Adds `AssetAttachmentRef` for Base attachment fields.
- `packages/busabase-contract/src/types/index.ts` - Re-exports asset-backed and lower-level attachment ref types separately.
- `packages/open-domains/attachments/types/attachments.ts` - Adds optional `assetId` to shared upload VOs.
- `packages/busabase-core/tests/assets-orpc.test.ts` - Adds upload/legacy-ref regression coverage.
- `packages/busabase-core/tests/dashboard-field-helpers.test.ts` - Adds ref normalization coverage.

## Breaking Changes
- None. Existing attachment refs remain accepted.

## Testing
- `../../node_modules/.bin/vitest run tests/assets-orpc.test.ts tests/dashboard-field-helpers.test.ts` from `packages/busabase-core` - 50 tests passed.
- `../../node_modules/.bin/tsc --noEmit -p tsconfig.json --types node` from `packages/busabase-core` - passed.
- `../../node_modules/.bin/tsc --noEmit -p tsconfig.json --types node` from `packages/busabase-contract` - passed.
- `./node_modules/.bin/biome check ... --diagnostic-level=error` on modified files - passed.
- `make typecheck && pnpm lint:err` was attempted but pnpm stopped during dependency status/install with `ERR_PNPM_IGNORED_BUILDS`; the command did not reach TypeScript compilation.
