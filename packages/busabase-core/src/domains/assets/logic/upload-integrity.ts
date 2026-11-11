import "server-only";

import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { ConfirmUploadDTO } from "open-domains/attachments/types";
import { isLocalStorageProvider, isSafeStorageKey, storage } from "openlib/storage";

/** Confirm local single-PUT bytes before any attachment or Asset is registered. */
export const assertLocalUploadIntegrity = async (input: ConfirmUploadDTO, userId: string) => {
  if (!isLocalStorageProvider()) return;

  // Keep the shared attachment confirmation's owner/key boundary before any
  // storage read. Invalid keys must not become a local filesystem read oracle.
  const owner = userId.replace(/[^A-Za-z0-9_-]/g, "_");
  if (
    !isSafeStorageKey(input.storageKey) ||
    !input.storageKey.startsWith(`attachments/${owner}/`)
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "storageKey must be an attachment upload under attachments/ issued to you by createUploadUrl.",
    });
  }

  await assertLocalStoredUploadIntegrity(input);
};

/** The caller must resolve this key from an attachment row in the current space. */
export const assertLocalStoredUploadIntegrity = async (
  input: Pick<ConfirmUploadDTO, "storageKey" | "sizeBytes" | "contentHash">,
) => {
  if (!isLocalStorageProvider()) return;
  if (!isSafeStorageKey(input.storageKey) || !input.storageKey.startsWith("attachments/")) {
    throw new ORPCError("BAD_REQUEST", { message: "Invalid stored attachment key" });
  }

  const object = await storage.getObjectMetadata(input.storageKey);
  if (!object) {
    throw new ORPCError("BAD_REQUEST", { message: "Uploaded attachment was not found" });
  }
  if (object.size !== input.sizeBytes) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Uploaded attachment size does not match the confirmed size",
    });
  }

  const keyHash = /\/blobs\/sha256\/[0-9a-f]{2}\/([0-9a-f]{64})(?:\.[^/]+)?$/.exec(
    input.storageKey,
  )?.[1];
  const declaredHash = input.contentHash?.replace(/^sha256:/, "");
  if (declaredHash && !/^[0-9a-f]{64}$/.test(declaredHash)) {
    throw new ORPCError("BAD_REQUEST", { message: "contentHash must be a hex SHA-256 digest" });
  }
  const expectedHash = keyHash ?? declaredHash;
  if (!expectedHash) return;

  // Range reads keep verification bounded even for multi-GB local attachments.
  const digest = createHash("sha256");
  const chunkBytes = 8 * 1024 * 1024;
  for (let offset = 0; offset < object.size; offset += chunkBytes) {
    const end = Math.min(offset + chunkBytes, object.size) - 1;
    const bytes = await storage.getObjectRange(input.storageKey, offset, end);
    if (bytes.length !== end - offset + 1) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Uploaded attachment changed during confirmation",
      });
    }
    digest.update(bytes);
  }
  const actualHash = digest.digest("hex");
  if (actualHash !== expectedHash || (declaredHash && actualHash !== declaredHash)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Uploaded attachment SHA-256 does not match the confirmed content",
    });
  }
};
