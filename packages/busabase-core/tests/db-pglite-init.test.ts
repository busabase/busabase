import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const APP_ROOT = path.resolve(__dirname, "../../../apps/busabase");

type Holder = typeof globalThis & { __busabaseCoreDbState?: { db: unknown } };

beforeAll(() => {
  vi.stubEnv("PG_DATABASE_URL", "pglite://memory://");
  vi.spyOn(process, "cwd").mockReturnValue(APP_ROOT);
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("never hands out the PGLite db before its migrations have committed", async () => {
  const { getDb } = await import("../src/db");
  const { busabaseVaultItems } = await import("../src/domains/vault/schema/vault-items");

  const first = getDb();
  const holder = globalThis as Holder;
  // Poll like a concurrent request would: take the db the moment it is published.
  for (let i = 0; i < 200_000 && !holder.__busabaseCoreDbState?.db; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const early = await getDb();

  // busabase_vault_items is created by migration 0000 and read on every /api/v1 request.
  await expect(early.select().from(busabaseVaultItems).limit(1)).resolves.toEqual([]);
  await first;
}, 60_000);
