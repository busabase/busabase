import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import type { AirAppSiteDomainsVO } from "busabase-contract/domains/airapp/contract";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { getLocalPreviewUpstream } from "../src/domains/airapp/logic/local-preview-registry";
import type {
  AirAppSiteDeployInput,
  AirAppSiteHost,
  AirAppSiteRecord,
} from "../src/domains/airapp/utils/site-host";
import { busabaseRouter } from "../src/router";

/**
 * The `site` engine through the real oRPC router and real file storage. Only the
 * provider is faked: what this pins is everything Core decides before it.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const SITE_MANIFEST = JSON.stringify({ requiredEngine: "site", site: { entry: "worker.js" } });
const WORKER = "export default { fetch() { return new Response('hi'); } };";

const siteFiles = (home = "<h1>one</h1>") => [
  { path: "airapp.json", content: SITE_MANIFEST },
  { path: "worker.js", content: WORKER },
  { path: "public/index.html", content: home },
  { path: "README.md", content: "never deployed" },
];

/** An in-memory provider that remembers what it was told to do. */
const createFakeHost = (overrides: Partial<AirAppSiteHost> = {}) => {
  const records = new Map<string, AirAppSiteRecord>();
  const empty = (): AirAppSiteRecord => ({
    address: "https://site-x.sites.test",
    previewVersion: null,
    liveVersion: null,
    isPublic: false,
    previewDeployedAt: null,
    liveDeployedAt: null,
    previewUpstream: null,
  });
  const read = (nodeId: string) => records.get(nodeId) ?? empty();
  const calls = {
    deployPreview: [] as AirAppSiteDeployInput[],
    goLive: [] as AirAppSiteDeployInput[],
    setPublic: [] as Array<[string, boolean]>,
    unpublishSites: [] as string[][],
    removeSites: [] as string[][],
  };
  const host: AirAppSiteHost = {
    isConfigured: () => true,
    readSite: async (nodeId) => read(nodeId),
    deployPreview: async (input) => {
      calls.deployPreview.push(input);
      const next = {
        ...read(input.nodeId),
        previewVersion: input.version,
        previewDeployedAt: new Date(),
        previewUpstream: {
          target: "https://site-x-preview.sites.test",
          headers: { "x-busabase-preview-token": "the-token" },
        },
      };
      records.set(input.nodeId, next);
      return next;
    },
    goLive: async (input) => {
      calls.goLive.push(input);
      const next = {
        ...read(input.nodeId),
        liveVersion: input.version,
        isPublic: true,
        liveDeployedAt: new Date(),
      };
      records.set(input.nodeId, next);
      return next;
    },
    setPublic: async (nodeId, isPublic) => {
      calls.setPublic.push([nodeId, isPublic]);
      const next = { ...read(nodeId), isPublic };
      records.set(nodeId, next);
      return next;
    },
    unpublishSites: async (nodeIds) => {
      calls.unpublishSites.push([...nodeIds]);
    },
    removeSites: async (nodeIds) => {
      calls.removeSites.push([...nodeIds]);
    },
    ...overrides,
  };
  return { host, calls };
};

describe("AirApp site engine", () => {
  type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let nextSlug = 0;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-site-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-site-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  }, 120_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createApp = async (files = siteFiles()) => {
    const created = await client.fileTrees.create({
      type: "airapp",
      autoMerge: true,
      slug: `site-app-${++nextSlug}`,
      name: "Site app",
      mergeMode: "replace",
      files,
    });
    if (!("node" in created) || !created.node) throw new Error("Expected a materialized AirApp");
    return created.node.id;
  };

  const editFile = async (nodeId: string, filePath: string, content: string) => {
    const result = await client.fileTrees.createChangeRequest({
      type: "airapp",
      nodeId,
      autoMerge: true,
      operations: [{ kind: "update", path: filePath, content }],
    });
    return result;
  };

  describe("preview", () => {
    it("deploys what the node's files say, and registers it for this viewer", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        const { outcome, state } = await client.airapps.siteDeployPreview({ nodeId });
        expect(outcome).toBe("ok");
        expect(state.previewUrl).toBe(`/api/airapp-preview/${nodeId}/`);
        expect(state.publication).toBe("not-live");
        expect(state.previewStale).toBe(false);
      });
      expect(calls.deployPreview).toHaveLength(1);
      expect(calls.deployPreview[0]?.bundle.workerCode).toBe(WORKER);
      expect(calls.deployPreview[0]?.hasAppWorker).toBe(true);
      expect(calls.deployPreview[0]?.bundle.assets.map((asset) => asset.path)).toEqual([
        "/index.html",
      ]);
      await expect(getLocalPreviewUpstream(nodeId, "local")).resolves.toEqual({
        target: "https://site-x-preview.sites.test",
        headers: { "x-busabase-preview-token": "the-token" },
      });
    });

    it("asks for a read-only key unless airapp.json says otherwise, and names the app", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, () =>
        client.airapps.siteDeployPreview({ nodeId }),
      );
      expect(calls.deployPreview[0]?.bundle.access).toBe("read");
      expect(calls.deployPreview[0]?.appName).toBe("Site app");
    });

    it("passes the declared access on, and a new access is a new version to preview", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await client.airapps.siteDeployPreview({ nodeId });
        await editFile(
          nodeId,
          "airapp.json",
          JSON.stringify({ requiredEngine: "site", site: { entry: "worker.js", access: "write" } }),
        );
        expect((await client.airapps.siteState({ nodeId })).previewStale).toBe(true);
        await client.airapps.siteDeployPreview({ nodeId });
      });
      expect(calls.deployPreview.map((input) => input.bundle.access)).toEqual(["read", "write"]);
    });

    it("blocks an access level a site may not have, and uploads nothing", async () => {
      const nodeId = await createApp([
        {
          path: "airapp.json",
          content: JSON.stringify({ site: { entry: "worker.js", access: "manage" } }),
        },
        ...siteFiles().slice(1),
      ]);
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        const { outcome, state } = await client.airapps.siteDeployPreview({ nodeId });
        expect(outcome).toBe("blocked");
        expect(state.blockers).toEqual([
          {
            code: "invalid-manifest",
            detail: "`site.access` must be one of read, changeRequest, write",
          },
        ]);
      });
      expect(calls.deployPreview).toHaveLength(0);
    });

    it("uploads nothing when the files have not changed, but still opens it for this viewer", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await client.airapps.siteDeployPreview({ nodeId });
        const { outcome } = await client.airapps.siteDeployPreview({ nodeId });
        expect(outcome).toBe("ok");
      });
      expect(calls.deployPreview).toHaveLength(1);
    });

    it("names what stops the app, and uploads nothing", async () => {
      const nodeId = await createApp([
        { path: "airapp.json", content: SITE_MANIFEST },
        { path: "worker.js", content: `import fs from "node:fs"; export default {};` },
      ]);
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        const { outcome, state } = await client.airapps.siteDeployPreview({ nodeId });
        expect(outcome).toBe("blocked");
        expect(state.blockers).toEqual([
          { code: "unsupported-import", path: "worker.js", specifier: "node:fs" },
        ]);
      });
      expect(calls.deployPreview).toHaveLength(0);
    });

    it("says a Python app cannot be a website, rather than failing some other way", async () => {
      const nodeId = await createApp([
        { path: "airapp.json", content: JSON.stringify({ runtime: "python", site: {} }) },
        { path: "main.py", content: "print('hi')" },
      ]);
      const { host } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        const { state } = await client.airapps.siteDeployPreview({ nodeId });
        expect(state.blockers).toEqual([{ code: "python-runtime" }]);
      });
    });
  });

  describe("go live", () => {
    it("publishes the previewed version", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        const preview = await client.airapps.siteDeployPreview({ nodeId });
        const { outcome, state } = await client.airapps.siteGoLive({ nodeId });
        expect(outcome).toBe("ok");
        expect(state.liveVersion).toBe(preview.state.previewVersion);
        expect(state.publication).toBe("live");
        expect(state.isPublic).toBe(true);
      });
      expect(calls.goLive).toHaveLength(1);
    });

    it("refuses when nothing has been previewed", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        const { outcome } = await client.airapps.siteGoLive({ nodeId });
        expect(outcome).toBe("no-preview");
      });
      expect(calls.goLive).toHaveLength(0);
    });

    it("publishes nothing when the files changed since the preview, and says so", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await client.airapps.siteDeployPreview({ nodeId });
        await editFile(nodeId, "public/index.html", "<h1>two</h1>");
        const { outcome, state } = await client.airapps.siteGoLive({ nodeId });
        expect(outcome).toBe("preview-stale");
        expect(state.previewStale).toBe(true);
        expect(state.publication).toBe("not-live");
      });
      expect(calls.goLive).toHaveLength(0);
      // It must not have quietly refreshed the preview either.
      expect(calls.deployPreview).toHaveLength(1);
    });

    it("does not call a preview stale over a file that never deploys", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await client.airapps.siteDeployPreview({ nodeId });
        await editFile(nodeId, "README.md", "edited, still never deployed");
        const { outcome, state } = await client.airapps.siteGoLive({ nodeId });
        expect(outcome).toBe("ok");
        expect(state.previewStale).toBe(false);
      });
      expect(calls.goLive).toHaveLength(1);
    });

    it("shows live changes until the new version goes live", async () => {
      const nodeId = await createApp();
      const { host } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await client.airapps.siteDeployPreview({ nodeId });
        await client.airapps.siteGoLive({ nodeId });
        await editFile(nodeId, "public/index.html", "<h1>two</h1>");
        expect((await client.airapps.siteState({ nodeId })).publication).toBe("live-with-changes");
        await client.airapps.siteDeployPreview({ nodeId });
        expect((await client.airapps.siteState({ nodeId })).publication).toBe("live-with-changes");
        await client.airapps.siteGoLive({ nodeId });
        expect((await client.airapps.siteState({ nodeId })).publication).toBe("live");
      });
    });
  });

  describe("the public switch", () => {
    it("takes the site off and puts the same version back", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await client.airapps.siteDeployPreview({ nodeId });
        await client.airapps.siteGoLive({ nodeId });
        const off = await client.airapps.siteUnpublish({ nodeId });
        expect(off.state.publication).toBe("not-live");
        expect(off.state.isPublic).toBe(false);
        expect(off.state.liveVersion).not.toBeNull();
        const on = await client.airapps.siteRepublish({ nodeId });
        expect(on.state.publication).toBe("live");
      });
      expect(calls.goLive).toHaveLength(1);
      expect(calls.setPublic.map(([, value]) => value)).toEqual([false, true]);
    });

    it("has nothing to put back before the first Go live", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        const { outcome } = await client.airapps.siteRepublish({ nodeId });
        expect(outcome).toBe("no-preview");
      });
      expect(calls.setPublic).toHaveLength(0);
    });
  });

  describe("gates, checked again on every call", () => {
    const lockedPlan = {
      resolveAirAppEngineLock: async () => ({
        lockedEngines: ["remote" as const, "site" as const],
        planLabel: "Plus",
      }),
    };

    it("refuses a host with no provider, without touching anything", async () => {
      const nodeId = await createApp();
      await expect(client.airapps.siteDeployPreview({ nodeId })).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("not offered"),
      });
      await expect(client.airapps.siteGoLive({ nodeId })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(client.airapps.siteState({ nodeId })).resolves.toMatchObject({
        engine: "not-offered",
        address: null,
      });
    });

    it("refuses when the provider's settings are gone", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost({ isConfigured: () => false });
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await expect(client.airapps.siteDeployPreview({ nodeId })).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
        });
        expect((await client.airapps.siteState({ nodeId })).engine).toBe("not-configured");
      });
      expect(calls.deployPreview).toHaveLength(0);
    });

    it("does not treat a configured host as unconfigured", async () => {
      const nodeId = await createApp();
      const { host } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        expect((await client.airapps.siteState({ nodeId })).engine).toBe("available");
      });
    });

    it("refuses a locked plan and names the plan that unlocks it", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host, ...lockedPlan }, async () => {
        for (const action of [client.airapps.siteDeployPreview, client.airapps.siteGoLive]) {
          await expect(action({ nodeId })).rejects.toMatchObject({
            code: "FORBIDDEN",
            data: { reason: "AIRAPP_ENGINE_PLAN_REQUIRED", engine: "site", planLabel: "Plus" },
          });
        }
        expect((await client.airapps.siteState({ nodeId })).engine).toBe("locked");
      });
      expect(calls.deployPreview).toHaveLength(0);
      expect(calls.goLive).toHaveLength(0);
    });

    it("does not lock a plan that includes the engine", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext(
        { airAppSiteHost: host, resolveAirAppEngineLock: async () => null },
        async () => {
          expect((await client.airapps.siteDeployPreview({ nodeId })).outcome).toBe("ok");
        },
      );
      expect(calls.deployPreview).toHaveLength(1);
    });

    it("lets a lapsed plan take its site down, but not put it back", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await client.airapps.siteDeployPreview({ nodeId });
        await client.airapps.siteGoLive({ nodeId });
      });
      await runWithBusabaseContext({ airAppSiteHost: host, ...lockedPlan }, async () => {
        const off = await client.airapps.siteUnpublish({ nodeId });
        expect(off.state.isPublic).toBe(false);
        expect(off.state.engine).toBe("locked");
        await expect(client.airapps.siteRepublish({ nodeId })).rejects.toMatchObject({
          data: { reason: "AIRAPP_ENGINE_PLAN_REQUIRED" },
        });
      });
      expect(calls.setPublic.map(([, value]) => value)).toEqual([false]);
    });
  });

  describe("custom website domains through the real router", () => {
    const state: AirAppSiteDomainsVO = {
      available: true,
      cnameTarget: "sites.company.test",
      bindings: [],
    };
    const domainHost = () => {
      const readDomains = vi.fn(async () => state);
      const bindDomain = vi.fn(async () => state);
      const unbindDomain = vi.fn(async () => state);
      return {
        ...createFakeHost({ readDomains, bindDomain, unbindDomain }),
        readDomains,
        bindDomain,
        unbindDomain,
      };
    };

    it("offers an unavailable state for existing hosts without domain support", async () => {
      const nodeId = await createApp();
      expect(await client.airapps.siteDomains({ nodeId })).toEqual({
        available: false,
        cnameTarget: null,
        bindings: [],
      });
      const { host } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await expect(client.airapps.siteDomains({ nodeId })).resolves.toMatchObject({
          available: false,
        });
      });
    });

    it("binds a normalized domain only after a production version has existed", async () => {
      const nodeId = await createApp();
      const { host, bindDomain, calls } = domainHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await client.airapps.siteDeployPreview({ nodeId });
        await expect(
          client.airapps.siteBindDomain({ nodeId, hostname: "shop.company.test" }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(bindDomain).not.toHaveBeenCalled();
        await client.airapps.siteGoLive({ nodeId });
        // Taking an existing website offline does not publish a preview when binding.
        await client.airapps.siteUnpublish({ nodeId });
        await expect(
          client.airapps.siteBindDomain({ nodeId, hostname: " Shop.Company.Test " }),
        ).resolves.toEqual(state);
      });
      expect(bindDomain).toHaveBeenCalledExactlyOnceWith(nodeId, "shop.company.test");
      expect(calls.goLive).toHaveLength(1);
    });

    it("rejects malformed domains before the provider is called", async () => {
      const nodeId = await createApp();
      const { host, bindDomain, unbindDomain } = domainHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        for (const action of [client.airapps.siteBindDomain, client.airapps.siteUnbindDomain]) {
          await expect(
            action({ nodeId, hostname: "https://shop.company.test/path" }),
          ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        }
      });
      expect(bindDomain).not.toHaveBeenCalled();
      expect(unbindDomain).not.toHaveBeenCalled();
    });

    it("lets a lapsed plan inspect and remove domains but refuses additions", async () => {
      const nodeId = await createApp();
      const { host, readDomains, bindDomain, unbindDomain } = domainHost();
      await runWithBusabaseContext(
        {
          airAppSiteHost: host,
          resolveAirAppEngineLock: async () => ({
            lockedEngines: ["site"],
            planLabel: "Plus",
          }),
        },
        async () => {
          await expect(client.airapps.siteDomains({ nodeId })).resolves.toEqual(state);
          await expect(
            client.airapps.siteUnbindDomain({ nodeId, hostname: "shop.company.test" }),
          ).resolves.toEqual(state);
          await expect(
            client.airapps.siteBindDomain({ nodeId, hostname: "shop.company.test" }),
          ).rejects.toMatchObject({ data: { reason: "AIRAPP_ENGINE_PLAN_REQUIRED" } });
        },
      );
      expect(readDomains).toHaveBeenCalledExactlyOnceWith(nodeId);
      expect(unbindDomain).toHaveBeenCalledExactlyOnceWith(nodeId, "shop.company.test");
      expect(bindDomain).not.toHaveBeenCalled();
    });

    it("denies readers and cross-space requests before any provider call", async () => {
      const nodeId = await createApp();
      const { host, readDomains, bindDomain, unbindDomain } = domainHost();
      for (const scope of [
        { isSpaceManager: false, permissionLevel: "read" as const },
        { spaceId: "other-space" },
      ]) {
        await runWithBusabaseContext({ airAppSiteHost: host, ...scope }, async () => {
          await expect(client.airapps.siteDomains({ nodeId })).rejects.toBeTruthy();
          await expect(
            client.airapps.siteBindDomain({ nodeId, hostname: "shop.company.test" }),
          ).rejects.toBeTruthy();
          await expect(
            client.airapps.siteUnbindDomain({ nodeId, hostname: "shop.company.test" }),
          ).rejects.toBeTruthy();
        });
      }
      expect(readDomains).not.toHaveBeenCalled();
      expect(bindDomain).not.toHaveBeenCalled();
      expect(unbindDomain).not.toHaveBeenCalled();
    });

    it("keeps the default state independent of domain-provider failures", async () => {
      const nodeId = await createApp();
      const { host } = createFakeHost({
        readDomains: async () => {
          throw new Error("domain provider down");
        },
      });
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await expect(client.airapps.siteDomains({ nodeId })).rejects.toThrow(
          "domain provider down",
        );
        await expect(client.airapps.siteState({ nodeId })).resolves.toMatchObject({
          address: "https://site-x.sites.test",
          publication: "not-live",
        });
      });
    });
  });

  describe("node lifecycle", () => {
    const archive = async (nodeId: string) => {
      const result = await client.nodes.createChangeRequest({
        autoMerge: true,
        operations: [{ kind: "delete", nodeId }],
      } as never);
      return result;
    };

    it("takes the site offline when the app goes to Trash", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await archive(nodeId);
      });
      expect(calls.unpublishSites.flat()).toContain(nodeId);
      expect(calls.removeSites).toHaveLength(0);
    });

    it("does not lose the merge if taking the site offline fails", async () => {
      const nodeId = await createApp();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { host } = createFakeHost({
        unpublishSites: async () => {
          throw new Error("provider down");
        },
      });
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await expect(archive(nodeId)).resolves.toBeTruthy();
      });
    });

    it("removes the site's scripts before a permanent delete", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await archive(nodeId);
        await expect(client.nodes.purge({ nodeId })).resolves.toEqual({ purged: true });
      });
      expect(calls.removeSites.flat()).toContain(nodeId);
    });

    it("keeps the node when the provider could not remove the site, so it can retry", async () => {
      const nodeId = await createApp();
      const failing = createFakeHost({
        removeSites: async () => {
          throw new Error("provider down");
        },
      });
      await runWithBusabaseContext({ airAppSiteHost: failing.host }, async () => {
        await archive(nodeId);
        await expect(client.nodes.purge({ nodeId })).rejects.toThrow("provider down");
      });
      const working = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: working.host }, async () => {
        await expect(client.nodes.purge({ nodeId })).resolves.toEqual({ purged: true });
      });
      expect(working.calls.removeSites.flat()).toContain(nodeId);
    });

    it("does not touch the site when a purge will be refused", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await expect(client.nodes.purge({ nodeId })).rejects.toMatchObject({ code: "CONFLICT" });
      });
      expect(calls.removeSites).toHaveLength(0);
    });
  });
});
