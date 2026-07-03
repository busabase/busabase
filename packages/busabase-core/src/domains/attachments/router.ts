/**
 * Attachments oRPC handler slice — thin adapter over `open-domains/attachments`.
 *
 * The schema/logic/contract/types live in the shared `open-domains` package
 * (also used by `apps/busabase-cloud`); this only wires them to busabase-core's request
 * context (db, actor, space) and mounts under the kernel router as `attachments`
 * (see `../../router.ts`). Auth-agnostic — hosts add auth at the transport edge.
 */

import { implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { confirmUpload, requestUploadUrl } from "open-domains/attachments/logic";
import { attachments } from "open-domains/attachments/schema";
import { getContextSpaceId, resolveActorId } from "../../context";
import { db } from "../../db";
import { ensureAsset } from "../assets/handlers";

const os = implement(busabaseContract);

const sanitizeUploadError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\/\/([^:@/\s]+):([^@/\s]+)@/g, "//***:***@");
};

const attachmentServerError = (action: string, error: unknown) => {
  if (error instanceof ORPCError) return error;
  const detail = sanitizeUploadError(error);
  return new ORPCError("INTERNAL_SERVER_ERROR", {
    message: `Failed to ${action}: ${detail}`,
    data: { error: `Failed to ${action}: ${detail}` },
  });
};

export const attachmentsRouter = {
  createUploadUrl: os.attachments.createUploadUrl.handler(async ({ input }) => {
    // Inject the active space (like `confirm` does) so request-time dedup scopes by
    // the same space the row is stored under — not by the caller-supplied spaceId.
    try {
      return await requestUploadUrl(
        { ...input, spaceId: input.spaceId ?? getContextSpaceId() },
        resolveActorId("local"),
        db,
        attachments,
      );
    } catch (error) {
      throw attachmentServerError("create attachment upload URL", error);
    }
  }),
  confirm: os.attachments.confirm.handler(async ({ input }) => {
    try {
      const result = await confirmUpload(
        { ...input, spaceId: input.spaceId ?? getContextSpaceId() },
        resolveActorId("local"),
        db,
        attachments,
      );
      // Surface every uploaded (deduped) file in the Asset library. Idempotent:
      // a deduped re-upload maps back to the same attachment → same asset.
      await ensureAsset(result.attachmentId, input.fileName);
      return result;
    } catch (error) {
      throw attachmentServerError("confirm attachment upload", error);
    }
  }),
};
