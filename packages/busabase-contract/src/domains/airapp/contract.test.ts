import { describe, expect, it } from "vitest";
import { resolveProcedurePermissionPolicy } from "../../access-control/api-key-level";
import {
  airAppPreviewStartInputSchema,
  airAppPreviewStateSchema,
  airAppSiteDomainInputSchema,
  airAppSiteEnvironmentDeploymentLockSchema,
  airAppSiteEnvironmentSchema,
  airAppSiteLogsInputSchema,
  airAppSiteLogsSchema,
  airAppSitePrimaryDomainInputSchema,
  airAppSiteReleasesSchema,
  airAppSiteRollbackInputSchema,
  airAppSiteSaveEnvironmentInputSchema,
} from "./contract";

describe("agent runtime preview boundary", () => {
  it("requires an explicit server-side engine rather than defaulting to host execution", () => {
    expect(airAppPreviewStartInputSchema.safeParse({ nodeId: "app" }).success).toBe(false);
    expect(
      airAppPreviewStartInputSchema.safeParse({ nodeId: "app", engine: "browser" }).success,
    ).toBe(false);
    expect(airAppPreviewStartInputSchema.parse({ nodeId: "app", engine: "remote" })).toEqual({
      nodeId: "app",
      engine: "remote",
    });
  });

  it("keeps readiness and failed diagnostics distinct without exporting internal owner state", () => {
    expect(
      airAppPreviewStateSchema.parse({
        status: "starting",
        engine: "local",
        previewUrl: null,
        logs: ["Dependencies installed; waiting for the server."],
        error: null,
        exitCode: null,
        owner: "internal-owner",
        abort: {},
      }),
    ).toEqual({
      status: "starting",
      engine: "local",
      previewUrl: null,
      logs: ["Dependencies installed; waiting for the server."],
      error: null,
      exitCode: null,
    });
  });

  it("lets read-level credentials inspect their preview without starting or stopping execution", () => {
    expect(resolveProcedurePermissionPolicy(["airapps", "previewState"])).toEqual({
      level: "read",
      scope: "node",
    });
    for (const name of ["previewStart", "previewStop"]) {
      expect(resolveProcedurePermissionPolicy(["airapps", name])).toEqual({
        level: "write",
        scope: "node",
      });
    }
  });
});

describe("Site Space Vault boundary", () => {
  const binding = { envName: "PAYMENT_TOKEN", vaultItemId: "vault-payment" };

  it("exposes a value-free deployment lock reason for Space Vault management", () => {
    expect(
      airAppSiteEnvironmentDeploymentLockSchema.parse({
        reason: "SPACE_VAULT_MANAGE_REQUIRED",
        secret: "must-not-cross",
      }),
    ).toEqual({ reason: "SPACE_VAULT_MANAGE_REQUIRED" });
    expect(
      airAppSiteEnvironmentDeploymentLockSchema.safeParse({ reason: "arbitrary-provider-message" })
        .success,
    ).toBe(false);
  });

  it("keeps direct values input-only and distinguishes omitted, empty, and retained input", () => {
    const parse = (directValues?: unknown[]) =>
      airAppSiteSaveEnvironmentInputSchema.safeParse({
        nodeId: "app",
        bindings: [],
        ...(directValues === undefined ? {} : { directValues }),
      });
    expect(parse().data).not.toHaveProperty("directValues");
    expect(parse([]).data?.directValues).toEqual([]);
    expect(parse([{ envName: "TOKEN", kind: "secret" }]).success).toBe(false);
    expect(parse([{ envName: "TOKEN", kind: "secret", value: "" }]).success).toBe(true);
    expect(parse([{ vaultItemId: "stored", envName: "TOKEN", kind: "variable" }]).success).toBe(
      true,
    );
    expect(parse([{ envName: "lowercase", kind: "secret", value: "private" }]).success).toBe(false);
    expect(
      parse([{ envName: "TOKEN", kind: "secret", value: "private", apiKeyId: "foreign" }]).success,
    ).toBe(false);
    expect(
      airAppSiteSaveEnvironmentInputSchema.safeParse({
        nodeId: "app",
        bindings: [binding],
        directValues: [{ envName: binding.envName, kind: "variable", value: "duplicate" }],
      }).success,
    ).toBe(false);
    const output = airAppSiteEnvironmentSchema.parse({
      available: true,
      sources: [],
      bindings: [],
      directValues: [
        {
          vaultItemId: "stored",
          envName: "TOKEN",
          kind: "secret",
          hasValue: true,
          status: "ready",
          value: "private",
        },
      ],
      unboundDirectValues: [
        {
          vaultItemId: "unbound",
          envName: "BLOG_DATE",
          kind: "secret",
          hasValue: true,
          status: "ready",
          value: "unbound-private",
        },
      ],
      vaultLinks: { space: "/vault?scope=space", apiKey: "/vault?scope=key" },
    });
    expect(JSON.stringify(output)).not.toContain("private");
    expect(output.unboundDirectValues?.[0]).toEqual({
      vaultItemId: "unbound",
      envName: "BLOG_DATE",
      kind: "secret",
      hasValue: true,
      status: "ready",
    });
  });

  it("accepts references and removes input plaintext and unscoped fields", () => {
    expect(
      airAppSiteSaveEnvironmentInputSchema.parse({
        nodeId: "app",
        spaceId: "another-space",
        bindings: [{ ...binding, value: "must-not-cross", kind: "variable" }],
      }),
    ).toEqual({ nodeId: "app", bindings: [binding] });
  });

  it("rejects invalid, duplicate and platform-owned target names", () => {
    for (const envName of [
      "",
      "1TOKEN",
      "TOKEN-NAME",
      "TOKEN.NAME",
      "a".repeat(129),
      "ASSETS",
      "assets",
      "BUSABASE_API_KEY",
      "busabase_base_url",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_CUSTOM",
      "BUDA_KEY",
      "SANDBOX_TOKEN",
      "SANDOCK_TOKEN",
      "AGENT_KEY",
      "BASH_ENV",
      "ENV",
      "LD_LIBRARY_PATH",
      "LD_PRELOAD",
      "NODE_OPTIONS",
      "NODE_PATH",
      "PATH",
      "PNPM_HOME",
    ]) {
      expect(
        airAppSiteSaveEnvironmentInputSchema.safeParse({
          nodeId: "app",
          bindings: [{ ...binding, envName }],
        }).success,
        envName,
      ).toBe(false);
    }
    expect(
      airAppSiteSaveEnvironmentInputSchema.safeParse({
        nodeId: "app",
        bindings: [binding, { ...binding, vaultItemId: "different-item" }],
      }).success,
    ).toBe(false);
    expect(
      airAppSiteSaveEnvironmentInputSchema.safeParse({
        nodeId: "app",
        bindings: Array.from({ length: 101 }, (_, i) => ({ ...binding, envName: `TOKEN_${i}` })),
      }).success,
    ).toBe(false);
  });

  it("keeps aliasing one source to different names valid and permits clearing", () => {
    expect(
      airAppSiteSaveEnvironmentInputSchema.parse({
        nodeId: "app",
        bindings: [binding, { ...binding, envName: " ALIAS_token " }],
      }).bindings,
    ).toEqual([binding, { ...binding, envName: "ALIAS_token" }]);
    expect(
      airAppSiteSaveEnvironmentInputSchema.parse({ nodeId: "app", bindings: [] }).bindings,
    ).toEqual([]);
  });

  it("returns only source metadata and binding health, stripping resolved values", () => {
    const parsed = airAppSiteEnvironmentSchema.parse({
      available: true,
      sources: [{ id: "vault-payment", key: "PAYMENT_TOKEN", kind: "secret", value: "private" }],
      bindings: [
        {
          ...binding,
          sourceKey: "PAYMENT_TOKEN",
          kind: "secret",
          status: "ready",
          value: "private",
        },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain("private");
    expect(resolveProcedurePermissionPolicy(["airapps", "siteEnvironment"])).toEqual({
      level: "write",
      scope: "node",
    });
    expect(resolveProcedurePermissionPolicy(["airapps", "siteSaveEnvironment"])).toEqual({
      level: "write",
      scope: "node",
    });
  });
});

describe("custom website domain inputs", () => {
  it("normalizes the hostname without accepting URLs or other routing syntax", () => {
    expect(
      airAppSiteDomainInputSchema.parse({ nodeId: "app", hostname: " Shop.Company.COM " }),
    ).toEqual({ nodeId: "app", hostname: "shop.company.com" });
    for (const hostname of [
      "https://shop.company.com",
      "shop.company.com/path",
      "shop.company.com:443",
      "*.company.com",
      "127.0.0.1",
      "[::1]",
      "localhost",
      "-shop.company.com",
      "shop-.company.com",
      `shop.${"a".repeat(64)}.com`,
    ]) {
      expect(airAppSiteDomainInputSchema.safeParse({ nodeId: "app", hostname }).success).toBe(
        false,
      );
    }
  });

  it("accepts a normalized primary hostname or null to clear it", () => {
    expect(
      airAppSitePrimaryDomainInputSchema.parse({ nodeId: "app", hostname: " WWW.Company.com " }),
    ).toEqual({ nodeId: "app", hostname: "www.company.com" });
    expect(airAppSitePrimaryDomainInputSchema.parse({ nodeId: "app", hostname: null })).toEqual({
      nodeId: "app",
      hostname: null,
    });
    expect(
      airAppSitePrimaryDomainInputSchema.safeParse({ nodeId: "app", hostname: "https://a.com" })
        .success,
    ).toBe(false);
  });

  it("requires node write permission for every domain procedure", () => {
    for (const name of [
      "siteDomains",
      "siteBindDomain",
      "siteUnbindDomain",
      "siteSetPrimaryDomain",
    ]) {
      expect(resolveProcedurePermissionPolicy(["airapps", name])).toEqual({
        level: "write",
        scope: "node",
      });
    }
  });
});

describe("Site release boundary", () => {
  it("requires node write permission for history and rollback", () => {
    for (const name of ["siteReleases", "siteRollback", "siteLogs"]) {
      expect(resolveProcedurePermissionPolicy(["airapps", name])).toEqual({
        level: "write",
        scope: "node",
      });
    }
  });
  it("bounds explicit log requests and strips account-wide provider payloads", () => {
    for (const version of ["", "v".repeat(65)]) {
      expect(airAppSiteLogsInputSchema.safeParse({ nodeId: "app", version }).success).toBe(false);
    }
    expect(
      airAppSiteLogsInputSchema.parse({
        nodeId: "app",
        version: "v1",
        scriptName: "victim",
        filters: [],
      }),
    ).toEqual({ nodeId: "app", version: "v1" });
    const result = airAppSiteLogsSchema.parse({
      available: true,
      version: "v1",
      from: "2026-11-17T00:00:00.000Z",
      to: "2026-11-17T01:00:00.000Z",
      truncated: false,
      contentHiddenReason: "VAULT_REDACTION_CONTEXT_UNAVAILABLE",
      account: "private-account",
      entries: [
        {
          id: "event",
          timestamp: "2026-11-17T00:30:00.000Z",
          level: "log",
          message: "hello",
          method: null,
          path: null,
          status: null,
          contentHiddenReason: "VAULT_REDACTION_CONTEXT_UNAVAILABLE",
          source: { headers: { authorization: "secret" } },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private-account");
    expect(JSON.stringify(result)).not.toContain("authorization");
    expect(result.contentHiddenReason).toBe("VAULT_REDACTION_CONTEXT_UNAVAILABLE");
    expect(result.entries[0].contentHiddenReason).toBe("VAULT_REDACTION_CONTEXT_UNAVAILABLE");
    expect(
      airAppSiteLogsSchema.safeParse({
        ...result,
        entries: Array.from({ length: 101 }, () => result.entries[0]),
      }).success,
    ).toBe(false);
  });
  it("requires a bounded explicit rollback version and strips server-only release fields", () => {
    for (const version of ["", "v".repeat(65)]) {
      expect(airAppSiteRollbackInputSchema.safeParse({ nodeId: "app", version }).success).toBe(
        false,
      );
    }
    const result = airAppSiteReleasesSchema.parse({
      available: true,
      versions: [
        {
          version: "v1",
          releaseNumber: 1,
          createdAt: "2026-11-11T00:00:00.000Z",
          createdBy: "user",
          isCurrent: true,
          canRollback: false,
          artifactKey: "private",
          previewToken: "secret",
        },
      ],
      history: [],
      status: "idle",
      lastError: null,
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
