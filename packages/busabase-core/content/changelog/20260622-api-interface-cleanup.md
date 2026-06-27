---
title: 2026-06-22 API interface cleanup
---

# API interface cleanup

Date: 2026-06-22
Author: Kelly Peilin Chan
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> go, 改。全部接口都整理下 包括/api/v1，和/api/rpc?

**Refined Instructions:**
- Replace verb-in-path patterns with proper HTTP method + canonical sub-resource path
- Move record change-request procedures out of `changeRequests` namespace into `records`
- Rename attachment endpoints to REST-idiomatic nouns
- Use PUT instead of POST for doc body update

## What Changed

- **Attachments contract** (`open-domains/attachments`): `requestUploadUrl` → `createUploadUrl` (path `/attachments/upload-urls`), `confirmUpload` → `confirm` (path `/attachments/confirmations`)
- **Records contract**: `listByFieldText` → `search` (path `/records/search`); added `updateChangeRequest` (`PUT /records/{recordId}/change-requests`) and `deleteChangeRequest` (`DELETE /records/{recordId}/change-requests`)
- **Doc contract**: `updateBody` method POST → PUT
- **busabase.ts**: removed `changeRequests.createDelete` and `changeRequests.createUpdate` (now live under `records.*`)
- **route.ts**: updated `legacyPayloadRoutes` docs body entry from POST to PUT
- **Routers** (busabase-core, busabase-cloud): updated all handler key names to match new contract
- **api-client**: renamed `listRecordsByFieldText` → `searchRecords`, `requestAttachmentUploadUrl` → `createAttachmentUploadUrl`, `confirmAttachmentUpload` → `confirmAttachment`; updated internal oRPC calls
- **dashboard/index.tsx**: updated attachment upload method calls
- **busabase-mobile**: updated record CR calls to new `records.*` namespace
- **Tests**: updated all test files to use new contract key names

## Files Affected

- `packages/open-domains/attachments/contract.ts`
- `packages/busabase-core/src/domains/base/contract/routes.ts`
- `packages/busabase-core/src/domains/doc/contract.ts`
- `packages/busabase-core/src/contract/busabase.ts`
- `packages/busabase-core/src/router.ts`
- `packages/busabase-core/src/router-demo.ts`
- `packages/busabase-core/src/domains/base/router.ts`
- `packages/busabase-core/src/domains/attachments/router.ts`
- `packages/busabase-core/src/api-client/index.ts`
- `packages/busabase-core/src/api-client/react-query.ts`
- `packages/busabase-core/src/dashboard/index.tsx`
- `packages/busabase-core/tests/base-lifecycle.test.ts`
- `packages/busabase-core/tests/cr-collaboration.test.ts`
- `packages/busabase-core/tests/merge.test.ts`
- `apps/busabase/src/app/api/v1/[[...rest]]/route.ts`
- `apps/busabase/tests/busabase-pglite.test.ts` (reverted accidental change)
- `apps/busabase-cloud/src/domains/attachments/router.ts`
- `apps/busabase-cloud/src/domains/attachments/router-demo.ts`
- `apps/busabase-cloud/src/hooks/upload/upload-to-s3.ts`
- `apps/busabase-cloud/tests/trpc-attachments.test.ts`
- `apps/busabase-mobile/app/records/[id]/index.tsx`
- `apps/busabase-mobile/app/records/[id]/edit.tsx`

## Breaking Changes

- `/api/v1` REST paths changed: `/attachments/request-upload-url` → `/attachments/upload-urls`, `/attachments/confirm-upload` → `/attachments/confirmations`, `/records/by-field-text` → `/records/search`, doc body endpoint now requires `PUT` not `POST`
- `/api/rpc` procedure keys changed: `changeRequests.createDelete/createUpdate` → `records.deleteChangeRequest/updateChangeRequest`, `attachments.requestUploadUrl/confirmUpload` → `attachments.createUploadUrl/confirm`, `records.listByFieldText` → `records.search`
- `BusabaseDashboardApiClient` methods renamed: `listRecordsByFieldText` → `searchRecords`, `requestAttachmentUploadUrl` → `createAttachmentUploadUrl`, `confirmAttachmentUpload` → `confirmAttachment`

## Testing

- `make typecheck` passes with no errors
- All busabase-core, busabase, busabase-cloud, busabase-mobile typechecks pass
