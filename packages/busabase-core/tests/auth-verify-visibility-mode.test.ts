import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { getAuthInfo } from "../src/logic/auth";
import { demoGetAuthInfo } from "../src/logic/demo-store";
import { busabaseRouter } from "../src/router";

/**
 * `auth.verify` carries the space's default content visibility.
 *
 * Why it matters to a user: a client (the mobile app) has no other way to learn
 * whether the space it is connected to defaults to Open or Restricted, and
 * without it a node's Permissions screen claims "everyone in this space can see
 * this" in a Restricted space and hides the grants list even when grants exist.
 *
 * The host injects the flag as `restrictedVisibility` (busabase-cloud's
 * `withBusabaseContext` reads `spaces.nodeVisibilityMode`); the open-source app
 * never sets it, so it stays `open` exactly as before.
 */
describe("auth.verify — space nodeVisibilityMode", () => {
  it("reports `open` with no host context (open-source single-tenant default)", () => {
    const info = getAuthInfo();
    expect(info.space.nodeVisibilityMode).toBe("open");
    expect(info.spaces[0]?.nodeVisibilityMode).toBe("open");
  });

  it("reports `open` when the host context leaves the flag unset", async () => {
    await runWithBusabaseContext({ spaceId: "org_open" }, async () => {
      expect(getAuthInfo().space.nodeVisibilityMode).toBe("open");
    });
  });

  it("reports `restricted` when the host marks the space restricted", async () => {
    await runWithBusabaseContext(
      { spaceId: "org_restricted", restrictedVisibility: true },
      async () => {
        expect(getAuthInfo().space.nodeVisibilityMode).toBe("restricted");
      },
    );
  });

  it("survives the contract's output validation on the real router", async () => {
    const client = createRouterClient(busabaseRouter);
    // Output validation strips unknown keys, so a field missing from
    // `authSpaceSchema` would silently never reach the client — this asserts it
    // actually crosses the procedure boundary.
    const restricted = await runWithBusabaseContext(
      { spaceId: "org_restricted", restrictedVisibility: true },
      () => client.auth.verify(),
    );
    expect(restricted.space.nodeVisibilityMode).toBe("restricted");

    const open = await runWithBusabaseContext({ spaceId: "org_open" }, () => client.auth.verify());
    expect(open.space.nodeVisibilityMode).toBe("open");
  });

  it("reports `open` in demo mode (the demo store has no ACL layer)", () => {
    const info = demoGetAuthInfo();
    expect(info.space.nodeVisibilityMode).toBe("open");
    expect(info.spaces[0]?.nodeVisibilityMode).toBe("open");
  });
});
