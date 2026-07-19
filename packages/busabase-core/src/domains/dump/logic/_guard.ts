import "server-only";

import { ORPCError } from "@orpc/server";
import { getContextIsSpaceManager } from "../../../context";

/**
 * Full-fidelity dump — a raw, whole-space row export and an id-preserving import
 * — is an ADMIN operation, and must be gated on the space owner/admin role.
 *
 * The export path (`exportTableRows`) is a raw `SELECT … WHERE spaceId = …`
 * table scan: it deliberately ignores the node-level ACLs (`effectiveVisibility`
 * / `nodePrincipals`) that restrict what an ordinary member sees in the UI. So
 * without this guard, any space member — including a read-only one — could call
 * `dump.exportTables` and exfiltrate every private node/base/record in the space
 * they were never allowed to see. Import is likewise a privileged whole-space
 * write. Both are backup/restore operations that only an admin should run.
 *
 * This lives in busabase-core (not the cloud host) on purpose: the guard travels
 * with the domain, so every host that mounts the dump router is covered without
 * having to remember to gate it. It reuses the existing auth-agnostic seam —
 * `isSpaceManager` is host-injected and defaults to "manager" when unset, so the
 * open-source single-user app, the `busabase-dump` CLI, and the local dev/test
 * harness are unaffected; busabase-cloud injects the real owner/admin role,
 * where this actually bites.
 */
export const requireSpaceManagerForDump = (): void => {
  if (!getContextIsSpaceManager()) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Full-fidelity backup/restore is a space owner/admin operation. Your role does not have access.",
    });
  }
};
