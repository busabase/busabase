import { describe, expect, it } from "vitest";
import type { BusabaseDatabase } from "../src/context";
import { getVaultRuntimeEnv } from "../src/domains/vault/logic/vault-logic";

const vaultRow = (key: string, value: string, runtime = true) => ({
  id: `vault-${key}`,
  userId: "actor-1",
  kind: "secret" as const,
  key,
  valuePayload: { version: 1 as const, encoding: "plain" as const, value },
  scopeType: "workspace" as const,
  scopeId: "space-1",
  environment: "production" as const,
  description: "",
  access: { runtime, reveal: false, edit: false, share: false },
  createdAt: new Date("2026-08-24T00:00:00.000Z"),
  updatedAt: new Date("2026-08-24T00:00:00.000Z"),
  lastUsedAt: null,
});

describe("getVaultRuntimeEnv", () => {
  it("excludes internal vault keys that cannot be environment variables", async () => {
    const rows = [
      vaultRow("OPENAI_API_KEY", "runtime-secret"),
      vaultRow("BUDA_ACP_CONNECTION:agent-1", "internal-credential"),
    ];
    const db = {
      select: () => ({
        from: () => ({
          where: async () => rows,
        }),
      }),
    } as unknown as BusabaseDatabase;

    await expect(getVaultRuntimeEnv(db, "actor-1")).resolves.toEqual({
      OPENAI_API_KEY: "runtime-secret",
    });
  });
});
