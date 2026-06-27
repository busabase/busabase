/**
 * Attachments oRPC contract (transport-neutral, client-safe).
 *
 * Pure leaf: imports only zod (via `./types`) — never logic / db / drizzle.
 * Mounted into the kernel contract by busabase-core, and re-implemented standalone
 * by `apps/busabase-cloud` (with its own billing-aware handlers + auth middleware).
 */

import { oc } from "@orpc/contract";
import {
  ConfirmUploadInputSchema,
  ConfirmUploadVOSchema,
  RequestUploadUrlInputSchema,
  RequestUploadUrlVOSchema,
} from "./types/attachments";

export const attachmentsContract = oc.router({
  createUploadUrl: oc
    .route({
      method: "POST",
      path: "/attachments/upload-urls",
      tags: ["Attachments"],
      summary: "Request upload URL",
      successDescription:
        "Presigned (or dev) upload URL plus the public URL the file will resolve to.",
    })
    .input(RequestUploadUrlInputSchema)
    .output(RequestUploadUrlVOSchema),
  confirm: oc
    .route({
      method: "POST",
      path: "/attachments/confirmations",
      tags: ["Attachments"],
      summary: "Confirm upload",
      successDescription: "Recorded attachment row and its public URL.",
    })
    .input(ConfirmUploadInputSchema)
    .output(ConfirmUploadVOSchema),
});
