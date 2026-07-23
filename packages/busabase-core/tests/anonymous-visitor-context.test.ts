import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getContextIsSpaceManager,
  getContextRestrictedVisibility,
  isAnonymousVisitor,
  runWithAnonymousContext,
  runWithBusabaseContext,
} from "../src/context";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { getEffectiveNodeLevel } from "../src/logic/node-acl";
import { seedScenario } from "../src/logic/seed";
import { busabaseRouter } from "../src/router";

/**
 * Anonymous visitor context (plan P0a).
 *
 * The pre-existing default is "no context ⇒ space manager" — deliberate for the
 * single-user open-source host, where there is no auth to enforce. That default
 * becomes a hole the moment an unauthenticated transport exists, so an
 * anonymous request must be downgraded *structurally*, not by remembering to
 * pass flags. These tests pin that behaviour.
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("anonymous visitor context", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let anyNodeId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-anon-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-anon-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
    const bases = await client.bases.list();
    anyNodeId = bases[0]?.nodeId ?? "";
  }, 120_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(dataDir, { force: true, recursive: true });
    await rm(storageDir, { force: true, recursive: true });
  });

  it("keeps the permissive default for a context that isn't anonymous", async () => {
    // The open-source host injects no auth at all; that must keep working.
    await runWithBusabaseContext({}, async () => {
      expect(isAnonymousVisitor()).toBe(false);
      expect(getContextIsSpaceManager()).toBe(true);
    });
  });

  it("is never a space manager, even though the default says otherwise", async () => {
    await runWithAnonymousContext({}, async () => {
      expect(isAnonymousVisitor()).toBe(true);
      expect(getContextIsSpaceManager()).toBe(false);
    });
  });

  it("cannot be talked into manager by an isSpaceManager the caller sneaks in", async () => {
    // runWithAnonymousContext's signature excludes these fields, but a plain
    // object cast is exactly what a careless future caller would write.
    await runWithAnonymousContext({ isSpaceManager: true } as never, async () => {
      expect(getContextIsSpaceManager()).toBe(false);
    });
  });

  it("always reads as a restricted-visibility space", async () => {
    await runWithAnonymousContext({}, async () => {
      expect(getContextRestrictedVisibility()).toBe(true);
    });
  });

  it("gets NO access level on a normal workspace node", async () => {
    expect(anyNodeId).not.toBe("");
    // Regression: restricted-visibility mode grants `read` to every
    // workspace/public node, and `principalType: "space"` grants mean
    // "everyone in the space" — neither may apply to a non-member. Without the
    // explicit anonymous branch this returns "read".
    await runWithAnonymousContext({}, async () => {
      expect(await getEffectiveNodeLevel(anyNodeId)).toBeNull();
    });
  });

  it("still resolves a level for a normal (non-anonymous) context", async () => {
    await runWithBusabaseContext({}, async () => {
      expect(await getEffectiveNodeLevel(anyNodeId)).toBe("manage");
    });
  });
});
