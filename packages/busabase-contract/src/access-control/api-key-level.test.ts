import { describe, expect, it } from "vitest";
import { busabaseContractRoutes } from "../contract/busabase";
import {
  apiKeyPermissionsSchema,
  capApiKeyLevel,
  createApiKeyPermissionsSchema,
  hasApiKeyLevel,
  PROCEDURE_PERMISSION_POLICY,
  parseBusabaseRelayPermissionLevel,
  permissionLevelForSpaceRole,
  resolveProcedurePermissionPolicy,
  resolveRequiredLevel,
} from "./api-key-level";

describe("parseBusabaseRelayPermissionLevel", () => {
  it("accepts only the four permission levels", () => {
    expect(parseBusabaseRelayPermissionLevel("read")).toBe("read");
    expect(parseBusabaseRelayPermissionLevel("changeRequest")).toBe("changeRequest");
    expect(parseBusabaseRelayPermissionLevel("write")).toBe("write");
    expect(parseBusabaseRelayPermissionLevel("manage")).toBe("manage");
    expect(parseBusabaseRelayPermissionLevel("owner")).toBeNull();
    expect(parseBusabaseRelayPermissionLevel(null)).toBeNull();
  });
});

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
    ["member", "write"],
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
    expect(resolveRequiredLevel(["workbench", "records", "changeRequest"], "POST")).toBe(
      "changeRequest",
    );
    expect(
      resolveRequiredLevel(["workbench", "bases", "createBulkUpdateChangeRequest"], "POST"),
    ).toBe("changeRequest");
    expect(resolveRequiredLevel(["workbench", "views", "changeRequest"], "POST")).toBe(
      "changeRequest",
    );
    expect(resolveRequiredLevel(["workbench", "fileTrees", "createChangeRequest"], "POST")).toBe(
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

  it("classifies unified file-tree creation as write", () => {
    const level = resolveRequiredLevel(["workbench", "fileTrees", "create"], "POST");
    expect(level).toBe("write");
    expect(hasApiKeyLevel("changeRequest", level)).toBe(false);
    expect(hasApiKeyLevel("write", level)).toBe(true);
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

  it("an unclassified GET path also fails closed to manage", () => {
    expect(resolveRequiredLevel(["workbench", "someFutureDomain", "list"], "GET")).toBe("manage");
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

describe("procedure permission policy", () => {
  it("is exhaustive for every current Busabase contract procedure", () => {
    const paths: string[] = [];
    const visit = (value: unknown, parent: string[] = []) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        const path = [...parent, key];
        if (child && typeof child === "object" && "~orpc" in child) {
          paths.push(path.join("."));
        } else {
          visit(child, path);
        }
      }
    };
    visit(busabaseContractRoutes);
    expect(Object.keys(PROCEDURE_PERMISSION_POLICY).sort()).toEqual(paths.sort());
  });

  it("classifies known method mismatches by semantics", () => {
    expect(resolveProcedurePermissionPolicy(["grep"])).toEqual({ level: "read", scope: "node" });
    expect(resolveRequiredLevel(["workbench", "grep"], "POST")).toBe("read");
    expect(resolveProcedurePermissionPolicy(["forms", "submit"]).level).toBe("changeRequest");
    expect(resolveProcedurePermissionPolicy(["bases", "createField"]).level).toBe("write");
    expect(resolveProcedurePermissionPolicy(["webhooks", "list"])).toEqual({
      level: "manage",
      scope: "workspace",
    });
  });

  it("classifies the RPC-only Inbox snapshot like its list and count reads", () => {
    expect(resolveProcedurePermissionPolicy(["changeRequests", "inboxSnapshot"])).toEqual({
      level: "read",
      scope: "node",
    });
    expect(resolveRequiredLevel(["workbench", "changeRequests", "inboxSnapshot"], undefined)).toBe(
      "read",
    );
  });

  it("rejects nodeScope on creation while preserving legacy read parsing", () => {
    const legacy = { level: "read" as const, nodeScope: ["nod_private"] };
    expect(apiKeyPermissionsSchema.safeParse(legacy).success).toBe(true);
    expect(createApiKeyPermissionsSchema.safeParse(legacy).success).toBe(false);
  });
});
