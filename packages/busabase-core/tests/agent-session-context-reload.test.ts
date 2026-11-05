import { describe, expect, it, vi } from "vitest";
import type { BusabaseDatabase } from "../src/context";

describe("supervisor context across independently evaluated host/route modules", () => {
  it("retains the injected Cloud database and actor when the driver imports a fresh module", async () => {
    const host = await import("../src/context");
    const database = { name: "isolated-cloud-context" } as unknown as BusabaseDatabase;
    await host.runWithBusabaseContext(
      { db: database, spaceId: "space-A", actorId: "actor-A" },
      async () => {
        vi.resetModules();
        const route = await import("../src/context");
        expect(route.getContextDb()).toBe(database);
        expect(route.getContextSpaceId()).toBe("space-A");
        expect(route.getContextActorId()).toBe("actor-A");
      },
    );
    expect(host.getContextDb()).toBeUndefined();
    expect(host.getContextActorId()).toBeUndefined();
  });

  it("keeps concurrent actor/vault values isolated across a host/driver module boundary", async () => {
    vi.resetModules();
    const host = await import("../src/context");
    vi.resetModules();
    const driver = await import("../src/context");
    const databaseA = { name: "A" } as unknown as BusabaseDatabase;
    const databaseB = { name: "B" } as unknown as BusabaseDatabase;
    let releaseA: () => void = () => {};
    let releaseB: () => void = () => {};
    const enteredA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const enteredB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    await Promise.all([
      host.runWithBusabaseContext(
        {
          db: databaseA,
          spaceId: "space-A",
          actorId: "actor-A",
          vaultRuntimeEnv: { QA_VALUE: "private-A" },
        },
        async () => {
          releaseA();
          await enteredB;
          expect(driver.getContextDb()).toBe(databaseA);
          expect(driver.getContextActorId()).toBe("actor-A");
          expect(driver.getContextVaultRuntimeValue("QA_VALUE")).toBe("private-A");
        },
      ),
      driver.runWithBusabaseContext(
        {
          db: databaseB,
          spaceId: "space-B",
          actorId: "actor-B",
          vaultRuntimeEnv: { QA_VALUE: "private-B" },
        },
        async () => {
          releaseB();
          await enteredA;
          expect(host.getContextDb()).toBe(databaseB);
          expect(host.getContextActorId()).toBe("actor-B");
          expect(host.getContextVaultRuntimeValue("QA_VALUE")).toBe("private-B");
        },
      ),
    ]);
    expect(driver.getContextVaultRuntimeValue("QA_VALUE")).toBeUndefined();
  });
});
