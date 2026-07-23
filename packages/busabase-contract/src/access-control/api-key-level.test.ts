import { describe, expect, it } from "vitest";
import {
  capApiKeyLevel,
  hasApiKeyLevel,
  permissionLevelForSpaceRole,
  resolveRequiredLevel,
} from "./api-key-level";

describe("hasApiKeyLevel", () => {
  it("null (legacy/unset) stored level always allows — zero behavior change for existing keys", () => {
    expect(hasApiKeyLevel(null, "read")).toBe(true);
    expect(hasApiKeyLevel(null, "changeRequest")).toBe(true);
    expect(hasApiKeyLevel(null, "write")).toBe(true);
    expect(hasApiKeyLevel(null, "manage")).toBe(true);
    expect(hasApiKeyLevel(undefined, "manage")).toBe(true);
  });

  it("ordinal comparison: a level includes everything at or below it", () => {
    expect(hasApiKeyLevel("changeRequest", "read")).toBe(true);
    expect(hasApiKeyLevel("changeRequest", "changeRequest")).toBe(true);
    expect(hasApiKeyLevel("changeRequest", "write")).toBe(false);
    expect(hasApiKeyLevel("changeRequest", "manage")).toBe(false);
    expect(hasApiKeyLevel("manage", "read")).toBe(true);
    expect(hasApiKeyLevel("manage", "manage")).toBe(true);
    expect(hasApiKeyLevel("read", "changeRequest")).toBe(false);
  });
});

describe("capApiKeyLevel", () => {
  it("a restricted key caps a higher space role — the owner-holds-a-changeRequest-key gap", () => {
    expect(capApiKeyLevel("manage", "changeRequest")).toBe("changeRequest");
    expect(capApiKeyLevel("manage", "read")).toBe("read");
    expect(capApiKeyLevel("write", "changeRequest")).toBe("changeRequest");
  });

  it("a restricted key at or above the space role is a no-op (the role is already the binding constraint)", () => {
    expect(capApiKeyLevel("changeRequest", "manage")).toBe("changeRequest");
    expect(capApiKeyLevel("read", "write")).toBe("read");
  });

  it("null/undefined stored level (legacy/unset key) applies no cap", () => {
    expect(capApiKeyLevel("manage", null)).toBe("manage");
    expect(capApiKeyLevel("changeRequest", undefined)).toBe("changeRequest");
  });
});

describe("permissionLevelForSpaceRole", () => {
  it.each([
    ["owner", "manage"],
    ["admin", "manage"],
    ["member", "changeRequest"],
    ["viewer", "read"],
    [undefined, "read"],
  ] as const)("maps %s to %s", (role, expected) => {
    expect(permissionLevelForSpaceRole(role)).toBe(expected);
  });
});

describe("resolveRequiredLevel", () => {
  it("a changeRequest-level key's covered procedures resolve to changeRequest", () => {
    expect(resolveRequiredLevel(["workbench", "nodes", "createChangeRequest"], "POST")).toBe(
      "changeRequest",
    );
    expect(resolveRequiredLevel(["workbench", "assets", "createUploadUrl"], "POST")).toBe(
      "changeRequest",
    );
  });

  it("denies changeRequests.merge and bases.create at higher-than-changeRequest levels", () => {
    const mergeLevel = resolveRequiredLevel(["workbench", "changeRequests", "merge"], "POST");
    const createBaseLevel = resolveRequiredLevel(["workbench", "bases", "create"], "POST");
    expect(mergeLevel).toBe("write");
    expect(createBaseLevel).toBe("write");
    // The actual gate an agent would hit: a changeRequest-level key must not
    // be able to review/merge its own proposal (the reported bug) or create
    // live data directly.
    expect(hasApiKeyLevel("changeRequest", mergeLevel)).toBe(false);
    expect(hasApiKeyLevel("changeRequest", createBaseLevel)).toBe(false);
  });

  it("classifies direct node metadata updates as write", () => {
    const level = resolveRequiredLevel(["workbench", "nodes", "updateMetadata"], "PATCH");
    expect(level).toBe("write");
    expect(hasApiKeyLevel("changeRequest", level)).toBe(false);
    expect(hasApiKeyLevel("write", level)).toBe(true);
  });

  it("an unclassified new mutation path defaults to manage (fail-closed)", () => {
    expect(resolveRequiredLevel(["workbench", "someFutureDomain", "doSomething"], "POST")).toBe(
      "manage",
    );
    expect(resolveRequiredLevel(["workbench", "someFutureDomain", "doSomething"], "DELETE")).toBe(
      "manage",
    );
    // No `.route()` at all (e.g. an RPC-only procedure) → no method → still fails closed.
    expect(resolveRequiredLevel(["workbench", "live", "subscribe"], undefined)).toBe("manage");
  });

  it("an unclassified GET path defaults to read (always allowed)", () => {
    expect(resolveRequiredLevel(["workbench", "someFutureDomain", "list"], "GET")).toBe("read");
    expect(hasApiKeyLevel("read", "read")).toBe(true);
  });

  it("strips the 'workbench' mount-key prefix seen at runtime, and also accepts a bare path", () => {
    expect(resolveRequiredLevel(["workbench", "bases", "create"], "POST")).toBe("write");
    expect(resolveRequiredLevel(["bases", "create"], "POST")).toBe("write");
  });

  it("explicit manage overrides win regardless of route method", () => {
    // dump.exportTables is a POST route (not GET, despite the design doc's
    // prose) but is force-classified to manage either way.
    expect(resolveRequiredLevel(["workbench", "dump", "exportTables"], "POST")).toBe("manage");
    expect(resolveRequiredLevel(["workbench", "nodes", "purge"], "DELETE")).toBe("manage");
  });
});
