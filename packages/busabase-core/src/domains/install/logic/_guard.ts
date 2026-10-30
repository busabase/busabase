import "server-only";

import { ORPCError } from "@orpc/server";
import { isPublicVisitor } from "../../../context";
import { hasWorkspacePermission } from "../../../logic/node-acl";

/**
 * Installing a package needs `write` on the workspace — the same bar as the
 * transport policy for `install.fromGithub` (`api-key-level.ts`), which also
 * explains why it is `write` and not `manage`: every operation the five-pass
 * apply performs, skills and AirApps included, is one a writer can already do
 * by hand. A role check would gate convenience, not capability.
 *
 * The dry run is gated at the same bar, not left at `read`: `planFromGithub`
 * makes the server fetch an arbitrary caller-named GitHub repo and reports every
 * colliding node and base slug in the space — an outbound-request primitive plus
 * a space-contents oracle that a read-only member has no use for.
 *
 * This lives in busabase-core so every host that mounts the install router is
 * covered. The permission level is host-injected (cloud maps owner/admin →
 * `manage`, member → `write`, anything else → `read`); with nothing injected
 * (open-source single-user mode) the baseline is `manage`. A credential ceiling
 * below `write` refuses too.
 */
export const requireWriteForInstall = (): void => {
  if (isPublicVisitor() || !hasWorkspacePermission("write")) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Installing a template needs edit permission in this space. Ask a space owner or admin to raise your role, or to install it for you.",
    });
  }
};
