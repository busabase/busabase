import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { applyInstall } from "busabase-package/apply";
import type { PackageClient } from "busabase-package/client";
import { buildInstallPlan, resolveTargetState } from "busabase-package/plan";
import type { PackageTree } from "busabase-package/tree";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

/**
 * The load-bearing seam for server-side install: `busabase-package`'s five-pass
 * apply — written for the CLI's HTTP client — driven by an IN-PROCESS oRPC router
 * client, against a real PGLite DB and local object storage.
 *
 * This is the assumption the whole install domain rests on, so it is tested
 * directly rather than only through the domain that uses it. Note what the test
 * does NOT contain: any cast. `PackageClient` is derived from the OSS contract, so
 * `createRouterClient(busabaseRouter)` satisfies it structurally, and so does the
 * SDK's cloud-contract `BusabaseClient` on the CLI side. If that ever stops being
 * true this file fails to compile, which is the intended alarm.
 *
 * Harness convention copied from `dump-logic.test.ts`.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const tinyTree = (packageName: string): PackageTree => ({
  manifest: {
    format: PACKAGE_FORMAT,
    name: packageName,
    description: "Seam probe",
    tags: [],
  },
  nodes: [
    {
      type: "folder",
      slug: "guides",
      name: "Guides",
      description: "",
      position: 0,
      children: [
        {
          type: "doc",
          slug: "getting-started",
          name: "Getting Started",
          description: "",
          position: 0,
          body: "Hello from the package.",
        },
      ],
    },
  ],
});

describe("busabase-package apply driven by an in-process router client", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: PackageClient;

  const inSpace = <T>(spaceId: string, fn: () => Promise<T>): Promise<T> =>
    runWithBusabaseContext({ spaceId }, fn);

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-install-seam-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-install-seam-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    // No cast: the router client structurally satisfies the package's client type.
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("plans and applies a folder + doc package end to end", async () => {
    const spaceId = "space_install_seam";
    const tree = tinyTree("seam-probe");

    const result = await inSpace(spaceId, async () => {
      const target = await resolveTargetState(client, tree.manifest.name);
      const plan = buildInstallPlan(tree, target);
      expect(plan.collisions).toEqual([]);
      expect(plan.counts.docs).toBe(1);
      return applyInstall(client, plan, { autoMerge: true });
    });

    expect(result.targetFolderNodeId).toBeTruthy();
    // The target folder itself plus the package's own `guides` folder.
    expect(result.created.folders).toBe(2);
    expect(result.created.docs).toBe(1);

    // The content really materialized — read it back through the same router.
    const nodes = await inSpace(spaceId, () => client.nodes.list());
    const roots = nodes.length === 1 && nodes[0].children ? nodes[0].children : nodes;
    const installed = roots.find((node) => node.slug === "seam-probe");
    expect(installed?.type).toBe("folder");

    const guides = installed?.children?.find((node) => node.slug === "guides");
    expect(guides?.children?.map((node) => node.slug)).toContain("getting-started");

    const doc = await inSpace(spaceId, () =>
      client.docs.get({ nodeId: guides?.children?.[0]?.id ?? "" }),
    );
    expect(doc.body).toContain("Hello from the package.");
  });

  it("leaves content as change requests when autoMerge is off", async () => {
    const spaceId = "space_install_seam_review";
    const tree = tinyTree("seam-probe-review");

    const result = await inSpace(spaceId, async () => {
      const target = await resolveTargetState(client, tree.manifest.name);
      return applyInstall(client, buildInstallPlan(tree, target), { autoMerge: false });
    });

    // Folders are structure and are always materialized — a pending folder has no
    // node id, so nothing could be nested inside it. The doc is content.
    expect(result.created.folders).toBe(2);
    expect(result.created.docs).toBe(0);
    expect(result.pendingChangeRequests).toBe(1);
  });
});
