import { describe, expect, it, vi } from "vitest";
import {
  type BusabaseDatabase,
  getContextVaultRuntimeEnv,
  getContextVaultRuntimeValue,
  readContextVaultRuntimeEnv,
  runWithBusabaseContext,
  runWithSearchDatabase,
} from "../src/context";

const db = { name: "vault-runtime-context" } as unknown as BusabaseDatabase;
const base = { db, spaceId: "space-A", actorId: "actor-A" };

describe("Vault runtime values in the request context", () => {
  it("prefers values the host passed eagerly and never calls the loader", async () => {
    const load = vi.fn(async () => ({ KEY: "lazy" }));
    await runWithBusabaseContext(
      { ...base, vaultRuntimeEnv: { KEY: "eager" }, loadVaultRuntimeEnv: load },
      async () => {
        expect(await readContextVaultRuntimeEnv()).toEqual({ KEY: "eager" });
        expect(getContextVaultRuntimeValue("KEY")).toBe("eager");
      },
    );
    expect(load).not.toHaveBeenCalled();
  });

  it("does not call the loader until a caller reads, then reads once per request", async () => {
    const load = vi.fn(async () => ({ KEY: "lazy" }));
    await runWithBusabaseContext({ ...base, loadVaultRuntimeEnv: load }, async () => {
      expect(load).not.toHaveBeenCalled();
      const [first, second] = await Promise.all([
        readContextVaultRuntimeEnv(),
        readContextVaultRuntimeEnv(),
      ]);
      expect(first).toEqual({ KEY: "lazy" });
      expect(second).toBe(first);
      expect(await readContextVaultRuntimeEnv()).toBe(first);
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares one read with shallow copies of the same context", async () => {
    const load = vi.fn(async () => ({ KEY: "lazy" }));
    await runWithBusabaseContext({ ...base, loadVaultRuntimeEnv: load }, async () => {
      const outer = await readContextVaultRuntimeEnv();
      // runWithSearchDatabase re-enters the context as `{ ...store, db }`.
      const inner = await runWithSearchDatabase(db, () => readContextVaultRuntimeEnv());
      expect(inner).toBe(outer);
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("gives each request its own read", async () => {
    const loadA = vi.fn(async () => ({ KEY: "A" }));
    const loadB = vi.fn(async () => ({ KEY: "B" }));
    const [a, b] = await Promise.all([
      runWithBusabaseContext({ ...base, loadVaultRuntimeEnv: loadA }, () =>
        readContextVaultRuntimeEnv(),
      ),
      runWithBusabaseContext({ ...base, actorId: "actor-B", loadVaultRuntimeEnv: loadB }, () =>
        readContextVaultRuntimeEnv(),
      ),
    ]);
    expect(a).toEqual({ KEY: "A" });
    expect(b).toEqual({ KEY: "B" });
  });

  it("does not cache a failed read, so a retry in the same request reads again", async () => {
    const load = vi
      .fn<() => Promise<Record<string, string>>>()
      .mockRejectedValueOnce(new Error("vault unavailable"))
      .mockResolvedValueOnce({ KEY: "recovered" });
    await runWithBusabaseContext({ ...base, loadVaultRuntimeEnv: load }, async () => {
      await expect(readContextVaultRuntimeEnv()).rejects.toThrow("vault unavailable");
      expect(await readContextVaultRuntimeEnv()).toEqual({ KEY: "recovered" });
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("makes the sync getters fail loudly on a lazy host instead of returning nothing", async () => {
    const load = vi.fn(async () => ({ KEY: "lazy" }));
    await runWithBusabaseContext({ ...base, loadVaultRuntimeEnv: load }, async () => {
      expect(() => getContextVaultRuntimeEnv()).toThrow(/readContextVaultRuntimeEnv/);
      expect(() => getContextVaultRuntimeValue("KEY")).toThrow(/readContextVaultRuntimeEnv/);
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("returns an empty map when the host provides no Vault at all", async () => {
    await runWithBusabaseContext(base, async () => {
      expect(getContextVaultRuntimeEnv()).toEqual({});
      expect(getContextVaultRuntimeValue("KEY")).toBeUndefined();
      expect(await readContextVaultRuntimeEnv()).toEqual({});
    });
    expect(getContextVaultRuntimeEnv()).toEqual({});
  });
});
