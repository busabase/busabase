import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithAnonymousContext, runWithBusabaseContext } from "../src/context";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { getEffectiveNodeLevel, getPublicScopeOf } from "../src/logic/node-acl";
import {
  disableNodeShare,
  hashSharePassword,
  isShareLive,
  setNodeShare,
  verifySharePassword,
} from "../src/logic/node-share";
import { seedScenario } from "../src/logic/seed";
import { busabaseRouter } from "../src/router";

/**
 * Public node sharing (plan P1): the second, orthogonal axis that lets an
 * anonymous visitor reach a node at its own canonical URL.
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("public node sharing", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  let folderNodeId = "";
  let childNodeId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-share-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-share-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    // A folder with a base inside it, to exercise inheritance.
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "create", nodeType: "folder", slug: "share-root", name: "Share Root" }],
    });
    const flat: Array<{ id: string; slug: string; type: string }> = [];
    const walk = (list: unknown[]) => {
      for (const raw of list) {
        const n = raw as { id: string; slug: string; type: string; children?: unknown[] };
        flat.push(n);
        if (n.children?.length) walk(n.children);
      }
    };
    walk((await client.nodes.list({})) as unknown[]);
    folderNodeId = flat.find((n) => n.slug === "share-root")?.id ?? "";

    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "folder",
          slug: "share-child",
          name: "Share Child",
          parentNodeId: folderNodeId,
        },
      ],
    });
    const flat2: Array<{ id: string; slug: string; type: string }> = [];
    const walk2 = (list: unknown[]) => {
      for (const raw of list) {
        const n = raw as { id: string; slug: string; type: string; children?: unknown[] };
        flat2.push(n);
        if (n.children?.length) walk2(n.children);
      }
    };
    walk2((await client.nodes.list({})) as unknown[]);
    childNodeId = flat2.find((n) => n.slug === "share-child")?.id ?? "";
  }, 120_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(dataDir, { force: true, recursive: true });
    await rm(storageDir, { force: true, recursive: true });
  });

  it("hashes share passwords instead of storing them", async () => {
    const stored = await hashSharePassword("hunter2");
    expect(stored).not.toContain("hunter2");
    expect(await verifySharePassword("hunter2", stored)).toBe(true);
    expect(await verifySharePassword("wrong", stored)).toBe(false);
  });

  it("keeps a node closed to anonymous visitors until it is shared", async () => {
    await runWithAnonymousContext({}, async () => {
      expect(await getEffectiveNodeLevel(folderNodeId)).toBeNull();
    });
  });

  it("opens the node — and its descendants — once shared", async () => {
    await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, { scope: "public", capability: "read" });
    });
    await runWithAnonymousContext({}, async () => {
      expect(await getEffectiveNodeLevel(folderNodeId)).toBe("read");
      // Sharing a folder exposes children at their own URLs (inheritance is
      // materialized at write time).
      expect(await getEffectiveNodeLevel(childNodeId)).toBe("read");
    });
  });

  it("never grants more than read, even at the submit capability", async () => {
    await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, { scope: "public", capability: "submit" });
    });
    await runWithAnonymousContext({}, async () => {
      // `submit` authorizes opening a ChangeRequest elsewhere; it must not show
      // up as a higher ACL level here.
      expect(await getEffectiveNodeLevel(folderNodeId)).toBe("read");
    });
  });

  it("closes immediately on revoke, and the row survives so the link still works later", async () => {
    const before = await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, { scope: "public", capability: "read" });
      return getPublicScopeOf(folderNodeId);
    });
    expect(before).toBe("read");

    const revoked = await runWithBusabaseContext({}, async () => {
      await disableNodeShare(folderNodeId);
      return getPublicScopeOf(folderNodeId);
    });
    expect(revoked).toBeNull();

    await runWithAnonymousContext({}, async () => {
      expect(await getEffectiveNodeLevel(folderNodeId)).toBeNull();
      expect(await getEffectiveNodeLevel(childNodeId)).toBeNull();
    });

    // Re-enabling works on the same row — no new id, so the URL is unchanged.
    const reopened = await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, { scope: "public", capability: "read" });
      return getPublicScopeOf(folderNodeId);
    });
    expect(reopened).toBe("read");
  });

  it("treats an expired share as closed", () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    expect(isShareLive({ scope: "public", expiresAt: past })).toBe(false);
    expect(isShareLive({ scope: "public", expiresAt: future })).toBe(true);
    expect(isShareLive({ scope: "public", expiresAt: null })).toBe(true);
    expect(isShareLive({ scope: "none", expiresAt: null })).toBe(false);
  });

  it("refuses a password on a non-public share", async () => {
    await runWithBusabaseContext({}, async () => {
      await expect(
        setNodeShare(folderNodeId, { scope: "none", password: "hunter2" }),
      ).rejects.toThrow(/publicly shared/i);
    });
  });

  it("leaves member access untouched while shared", async () => {
    await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, { scope: "public", capability: "read" });
      // The member path is the other axis entirely — still full access.
      expect(await getEffectiveNodeLevel(folderNodeId)).toBe("manage");
    });
  });
});
