import "server-only";

import { ORPCError } from "@orpc/server";

/** Node identities are one storage segment, including when reading older database rows. */
export function assertNodeStorageId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  )
    throw new ORPCError("BAD_REQUEST", {
      message: "Node storage identity must be a single safe segment",
    });
}
