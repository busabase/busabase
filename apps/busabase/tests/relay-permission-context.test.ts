import { describe, expect, it } from "vitest";
import { resolveRelayPermissionContext } from "../src/lib/relay-permission";

describe("relay permission context", () => {
  it("keeps direct local OpenAPI calls on the backward-compatible local default", () => {
    expect(resolveRelayPermissionContext(new Headers())).toEqual({});
    expect(
      resolveRelayPermissionContext(
        new Headers({ "x-busabase-relay-permission-level": "not-a-level" }),
      ),
    ).toEqual({});
  });

  it("turns a restricted Cloud key into a hard permission ceiling", () => {
    expect(
      resolveRelayPermissionContext(
        new Headers({ "x-busabase-relay-permission-level": "changeRequest" }),
      ),
    ).toEqual({
      isSpaceManager: false,
      permissionLevel: "changeRequest",
      permissionLevelIsCeiling: true,
    });
  });

  it("keeps a manage-level Cloud caller as the remote workspace manager", () => {
    expect(
      resolveRelayPermissionContext(new Headers({ "x-busabase-relay-permission-level": "manage" })),
    ).toEqual({
      isSpaceManager: true,
      permissionLevel: "manage",
      permissionLevelIsCeiling: true,
    });
  });
});
