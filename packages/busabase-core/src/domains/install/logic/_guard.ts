import "server-only";

import { ORPCError } from "@orpc/server";
import { getContextIsSpaceManager } from "../../../context";

/**
 * Installing a package is an ADMIN operation, and must be gated on the space
 * owner/admin role.
 *
 * The reason is not the write volume — it is *what* a package can carry. A
 * `busabase-package@1` can contain skill and AirApp nodes, and those are code
 * this space's agents will execute. "Any member can install a GitHub repo" is
 * therefore "any member can introduce agent-executed code into the space",
 * which is a privilege-escalation path dressed up as a content import. The
 * approval-first model narrows the blast radius (content lands as change
 * requests) but does not close it: an install with `autoMerge` skips review
 * entirely, and structure is materialized immediately by design.
 *
 * The dry-run path is gated too, not just the write. `planFromGithub` makes the
 * server fetch an arbitrary caller-named GitHub repo and reports back what
 * already exists in the space (every colliding node and base slug) — an
 * outbound-request primitive plus a space-contents oracle. Neither belongs to a
 * read-only member.
 *
 * This lives in busabase-core (not the cloud host) on purpose, exactly like
 * `dump`'s guard: the guard travels with the domain, so every host that mounts
 * the install router is covered without having to remember to gate it. It reuses
 * the same auth-agnostic seam — `isSpaceManager` is host-injected and defaults to
 * "manager" when unset, so the open-source single-user app and the local
 * dev/test harness are unaffected; busabase-cloud injects the real owner/admin
 * role, where this actually bites.
 */
export const requireSpaceManagerForInstall = (): void => {
  if (!getContextIsSpaceManager()) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Installing a package is a space owner/admin operation — a package can carry skills and AirApps, which are code this space's agents will execute. Your role does not have access.",
    });
  }
};
