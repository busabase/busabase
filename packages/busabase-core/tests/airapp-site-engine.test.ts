import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import type {
  AirAppSiteDomainsVO,
  AirAppSiteEnvironmentVO,
  AirAppSiteReleasesVO,
} from "busabase-contract/domains/airapp/contract";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { getLocalPreviewUpstream } from "../src/domains/airapp/logic/local-preview-registry";
import type {
  AirAppSiteDeployInput,
  AirAppSiteHost,
  AirAppSiteRecord,
} from "../src/domains/airapp/utils/site-host";
import { grantNodePrincipal } from "../src/logic/node-acl";
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
  let environmentRevision: string | null = null;
  const empty = (): AirAppSiteRecord => ({
    address: "https://site-x.sites.test",
    previewVersion: null,
    liveVersion: null,
    isPublic: false,
    previewDeployedAt: null,
    liveDeployedAt: null,
    previewUpstream: null,
  });
  const read = (nodeId: string) => ({
    ...(records.get(nodeId) ?? empty()),
    environmentRevision,
  });
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
        previewEnvironmentRevision: environmentRevision,
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
        liveEnvironmentRevision: environmentRevision,
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
  return {
    host,
    calls,
    setEnvironmentRevision: (revision: string | null) => {
      environmentRevision = revision;
    },
  };
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

  describe("Space Vault environment", () => {
    const environment: AirAppSiteEnvironmentVO = {
      available: true,
      sources: [{ id: "vault-payment", key: "PAYMENT_TOKEN", kind: "secret" }],
      bindings: [
        {
          envName: "PAYMENT_API_KEY",
          vaultItemId: "vault-payment",
          sourceKey: "PAYMENT_TOKEN",
          kind: "secret",
          status: "ready",
        },
      ],
    };

    const memberScope = {
      actorId: "vault-member",
      isSpaceManager: false,
      permissionLevel: "changeRequest" as const,
    };
    const prepareLockedPreview = async () => {
      const nodeId = await createApp();
      const fake = createFakeHost();
      fake.setEnvironmentRevision("env-one");
      await runWithBusabaseContext(
        { airAppSiteHost: fake.host, actorId: "vault-owner", isSpaceManager: true },
        async () => {
          await grantNodePrincipal(
            nodeId,
            { principalType: "user", principalId: memberScope.actorId, role: "write" },
            "vault-owner",
          );
          await client.airapps.siteDeployPreview({ nodeId });
        },
      );
      const readSite = fake.host.readSite.bind(fake.host);
      fake.host.readSite = async (id) => ({
        ...(await readSite(id)),
        environmentDeploymentLock: { reason: "SPACE_VAULT_MANAGE_REQUIRED" },
      });
      return { ...fake, nodeId };
    };

    it("lets a member reuse an owner's current Vault preview without another upload", async () => {
      const { nodeId, host, calls } = await prepareLockedPreview();
      await expect(getLocalPreviewUpstream(nodeId, memberScope.actorId)).resolves.toBeUndefined();
      const ownerUpstream = await getLocalPreviewUpstream(nodeId, "vault-owner");
      expect(ownerUpstream).toBeDefined();
      await runWithBusabaseContext({ airAppSiteHost: host, ...memberScope }, async () => {
        expect(await client.airapps.siteDeployPreview({ nodeId })).toMatchObject({
          outcome: "ok",
          state: {
            previewUrl: `/api/airapp-preview/${nodeId}/`,
            previewStale: false,
            previewEnvironmentStale: false,
            environmentDeploymentLock: { reason: "SPACE_VAULT_MANAGE_REQUIRED" },
          },
        });
      });
      expect(calls.deployPreview).toHaveLength(1);
      await expect(getLocalPreviewUpstream(nodeId, memberScope.actorId)).resolves.toEqual(
        ownerUpstream,
      );
      await expect(getLocalPreviewUpstream(nodeId, "other-member")).resolves.toBeUndefined();
    });

    it.each(["files", "environment", "upstream", "first-preview"] as const)(
      "refuses a member's Vault upload when %s requires deployment",
      async (changed) => {
        const { nodeId, host, calls, setEnvironmentRevision } = await prepareLockedPreview();
        if (changed === "files") await editFile(nodeId, "public/index.html", "<h1>two</h1>");
        if (changed === "environment") setEnvironmentRevision("env-two");
        if (changed === "upstream" || changed === "first-preview") {
          const readSite = host.readSite.bind(host);
          host.readSite = async (id) => ({
            ...(await readSite(id)),
            previewUpstream: null,
            ...(changed === "first-preview" ? { previewVersion: null } : {}),
          });
        }
        await runWithBusabaseContext({ airAppSiteHost: host, ...memberScope }, async () => {
          await expect(client.airapps.siteDeployPreview({ nodeId })).rejects.toMatchObject({
            code: "FORBIDDEN",
            data: { reason: "SPACE_VAULT_MANAGE_REQUIRED" },
          });
        });
        expect(calls.deployPreview).toHaveLength(1);
        await expect(getLocalPreviewUpstream(nodeId, memberScope.actorId)).resolves.toBeUndefined();
      },
    );

    it("reports an invalid bundle before considering a member's Vault deployment lock", async () => {
      const { nodeId, host, calls } = await prepareLockedPreview();
      await editFile(nodeId, "worker.js", "export default {");
      await runWithBusabaseContext({ airAppSiteHost: host, ...memberScope }, async () => {
        const result = await client.airapps.siteDeployPreview({ nodeId });
        expect(result.outcome).toBe("blocked");
        expect(result.state.blockers.length).toBeGreaterThan(0);
      });
      expect(calls.deployPreview).toHaveLength(1);
      await expect(getLocalPreviewUpstream(nodeId, memberScope.actorId)).resolves.toBeUndefined();
    });

    it("keeps older hosts available without exposing an environment editor", async () => {
      const nodeId = await createApp();
      const { host } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        expect(await client.airapps.siteEnvironment({ nodeId })).toEqual({
          available: false,
          sources: [],
          bindings: [],
        });
        expect(await client.airapps.siteState({ nodeId })).toMatchObject({
          previewEnvironmentStale: false,
          liveEnvironmentStale: false,
        });
        await expect(
          client.airapps.siteSaveEnvironment({ nodeId, bindings: [] }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      });
    });

    it("loads metadata and sends only normalized references to the host", async () => {
      const nodeId = await createApp();
      const readEnvironment = vi.fn(async () => environment);
      const saveEnvironment = vi.fn(async () => environment);
      const { host } = createFakeHost({ readEnvironment, saveEnvironment });
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        expect(await client.airapps.siteEnvironment({ nodeId })).toEqual(environment);
        expect(
          await client.airapps.siteSaveEnvironment({
            nodeId,
            bindings: [{ envName: " PAYMENT_API_KEY ", vaultItemId: "vault-payment" }],
          }),
        ).toEqual(environment);
      });
      expect(readEnvironment).toHaveBeenCalledExactlyOnceWith(nodeId);
      expect(saveEnvironment).toHaveBeenCalledExactlyOnceWith(nodeId, [
        { envName: "PAYMENT_API_KEY", vaultItemId: "vault-payment" },
      ]);
    });

    it.each(["doc", "base"] as const)(
      "rejects %s environment reads and every save mode before reaching the host",
      async (type) => {
        const slug = `non-site-${type}-${++nextSlug}`;
        let nodeId: string;
        if (type === "doc") {
          const created = await client.docs.create({
            slug,
            name: slug,
            body: "Document",
            autoMerge: true,
          });
          if (!("node" in created)) throw new Error("Expected a materialized document");
          nodeId = created.node.id;
        } else {
          const created = await client.bases.create({
            slug,
            name: slug,
            fields: [],
            autoMerge: true,
          });
          if (!("nodeId" in created)) throw new Error("Expected a materialized Base");
          nodeId = created.nodeId;
        }
        const readEnvironment = vi.fn(async () => environment);
        const saveEnvironment = vi.fn(async () => environment);
        const saveEnvironmentWithValues = vi.fn(async () => ({ ...environment, directValues: [] }));
        const { host, calls } = createFakeHost({
          readEnvironment,
          saveEnvironment,
          saveEnvironmentWithValues,
        });
        await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
          await expect(client.airapps.siteEnvironment({ nodeId })).rejects.toMatchObject({
            code: "BAD_REQUEST",
          });
          await expect(
            client.airapps.siteSaveEnvironment({ nodeId, bindings: [] }),
          ).rejects.toMatchObject({ code: "BAD_REQUEST" });
          await expect(
            client.airapps.siteSaveEnvironment({
              nodeId,
              bindings: [],
              directValues: [{ envName: "TOKEN", kind: "secret", value: "synthetic" }],
            }),
          ).rejects.toMatchObject({ code: "BAD_REQUEST" });
          delete host.saveEnvironmentWithValues;
          await expect(
            client.airapps.siteSaveEnvironment({ nodeId, bindings: [] }),
          ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        });
        expect(readEnvironment).not.toHaveBeenCalled();
        expect(saveEnvironment).not.toHaveBeenCalled();
        expect(saveEnvironmentWithValues).not.toHaveBeenCalled();
        expect(calls.deployPreview).toHaveLength(0);
        expect(calls.goLive).toHaveLength(0);
      },
    );

    it("requires an explicit host capability before forwarding direct input", async () => {
      const nodeId = await createApp();
      const saveEnvironment = vi.fn(async () => environment);
      const { host } = createFakeHost({ saveEnvironment });
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await expect(
          client.airapps.siteSaveEnvironment({
            nodeId,
            bindings: [],
            directValues: [{ envName: "TOKEN", kind: "secret", value: "private" }],
          }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      });
      expect(saveEnvironment).not.toHaveBeenCalled();
      const saveEnvironmentWithValues = vi.fn(async () => ({ ...environment, directValues: [] }));
      host.saveEnvironmentWithValues = saveEnvironmentWithValues;
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await client.airapps.siteSaveEnvironment({ nodeId, bindings: [] });
        expect(saveEnvironmentWithValues).toHaveBeenLastCalledWith(nodeId, { bindings: [] });
        const directValues = [{ envName: "TOKEN", kind: "secret" as const, value: "" }];
        await client.airapps.siteSaveEnvironment({ nodeId, bindings: [], directValues });
        expect(saveEnvironmentWithValues).toHaveBeenLastCalledWith(nodeId, {
          bindings: [],
          directValues,
        });
      });
    });

    it("denies readers, credential ceilings and cross-space requests before the host", async () => {
      const nodeId = await createApp();
      const readEnvironment = vi.fn(async () => environment);
      const saveEnvironment = vi.fn(async () => environment);
      const { host } = createFakeHost({ readEnvironment, saveEnvironment });
      for (const scope of [
        { isSpaceManager: false, permissionLevel: "read" as const },
        { permissionLevel: "manage" as const, credentialPermissionCeiling: "read" as const },
        { spaceId: "another-space" },
        // Even a node manager cannot use workspace credentials on a read-only request.
        { isSpaceManager: true, permissionLevel: "read" as const },
      ]) {
        await runWithBusabaseContext({ airAppSiteHost: host, ...scope }, async () => {
          await expect(client.airapps.siteEnvironment({ nodeId })).rejects.toBeTruthy();
          await expect(
            client.airapps.siteSaveEnvironment({ nodeId, bindings: [] }),
          ).rejects.toBeTruthy();
        });
      }
      expect(readEnvironment).not.toHaveBeenCalled();
      expect(saveEnvironment).not.toHaveBeenCalled();
    });

    it("does not describe saved bindings as an outdated deployment before the first preview or publication", async () => {
      const nodeId = await createApp();
      const { host, calls, setEnvironmentRevision } = createFakeHost({
        readEnvironment: async () => environment,
      });
      host.saveEnvironment = async () => {
        setEnvironmentRevision("configured-before-any-deployment");
        return environment;
      };
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await client.airapps.siteSaveEnvironment({
          nodeId,
          bindings: [{ envName: "PAYMENT_API_KEY", vaultItemId: "vault-payment" }],
        });
        expect(await client.airapps.siteState({ nodeId })).toMatchObject({
          previewVersion: null,
          liveVersion: null,
          previewEnvironmentStale: false,
          liveEnvironmentStale: false,
          publication: "not-live",
        });
      });
      expect(calls.deployPreview).toHaveLength(0);
      expect(calls.goLive).toHaveLength(0);
    });

    it("marks only an existing preview outdated when its environment changes before first publication", async () => {
      const nodeId = await createApp();
      const { host, setEnvironmentRevision } = createFakeHost();
      setEnvironmentRevision("preview-environment-one");
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        const preview = await client.airapps.siteDeployPreview({ nodeId });
        setEnvironmentRevision("preview-environment-two");
        expect(await client.airapps.siteState({ nodeId })).toMatchObject({
          previewVersion: preview.state.previewVersion,
          liveVersion: null,
          previewEnvironmentStale: true,
          liveEnvironmentStale: false,
          publication: "not-live",
        });
        // The first publication still resolves the latest values without requiring
        // another preview when the reviewed files have not changed.
        expect(await client.airapps.siteGoLive({ nodeId })).toMatchObject({
          outcome: "ok",
          state: {
            liveVersion: preview.state.previewVersion,
            previewEnvironmentStale: true,
            liveEnvironmentStale: false,
            publication: "live",
          },
        });
      });
    });

    it("refreshes an unchanged preview after only its environment changes", async () => {
      const nodeId = await createApp();
      const { host, calls, setEnvironmentRevision } = createFakeHost();
      setEnvironmentRevision("env-one");
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        const first = await client.airapps.siteDeployPreview({ nodeId });
        await client.airapps.siteDeployPreview({ nodeId });
        expect(calls.deployPreview).toHaveLength(1);
        setEnvironmentRevision("env-two");
        expect(await client.airapps.siteState({ nodeId })).toMatchObject({
          currentVersion: first.state.currentVersion,
          previewStale: false,
          previewEnvironmentStale: true,
        });
        expect(await client.airapps.siteDeployPreview({ nodeId })).toMatchObject({
          outcome: "ok",
          state: { previewVersion: first.state.previewVersion, previewEnvironmentStale: false },
        });
        await client.airapps.siteDeployPreview({ nodeId });
      });
      expect(calls.deployPreview).toHaveLength(2);
    });

    it("publishes latest Vault values without repeating the same file preview", async () => {
      const nodeId = await createApp();
      const { host, calls, setEnvironmentRevision } = createFakeHost();
      setEnvironmentRevision("env-one");
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        const preview = await client.airapps.siteDeployPreview({ nodeId });
        await client.airapps.siteGoLive({ nodeId });
        setEnvironmentRevision("env-two");
        expect(await client.airapps.siteState({ nodeId })).toMatchObject({
          currentVersion: preview.state.currentVersion,
          previewStale: false,
          previewEnvironmentStale: true,
          liveEnvironmentStale: true,
          publication: "live-with-changes",
        });
        expect(await client.airapps.siteGoLive({ nodeId })).toMatchObject({
          outcome: "ok",
          state: {
            liveVersion: preview.state.previewVersion,
            previewEnvironmentStale: true,
            liveEnvironmentStale: false,
            publication: "live",
          },
        });
        setEnvironmentRevision("env-three");
        await editFile(nodeId, "worker.js", `${WORKER}\n// changed files`);
        expect(await client.airapps.siteGoLive({ nodeId })).toMatchObject({
          outcome: "preview-stale",
          state: { previewStale: true, liveEnvironmentStale: true },
        });
      });
      expect(calls.deployPreview).toHaveLength(1);
      expect(calls.goLive).toHaveLength(2);
    });

    it("restores the deployed environment when only the public switch changes", async () => {
      const nodeId = await createApp();
      const { host, calls, setEnvironmentRevision } = createFakeHost();
      setEnvironmentRevision("env-one");
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await client.airapps.siteDeployPreview({ nodeId });
        await client.airapps.siteGoLive({ nodeId });
        await client.airapps.siteUnpublish({ nodeId });
        setEnvironmentRevision("env-two");
        expect(await client.airapps.siteRepublish({ nodeId })).toMatchObject({
          outcome: "ok",
          state: { isPublic: true, publication: "live-with-changes", liveEnvironmentStale: true },
        });
      });
      expect(calls.goLive).toHaveLength(1);
      expect(calls.setPublic).toEqual([
        [nodeId, false],
        [nodeId, true],
      ]);
    });
  });

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

    it("refreshes an unchanged legacy preview once, then resumes upload-free refreshes", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        const first = await client.airapps.siteDeployPreview({ nodeId });
        calls.deployPreview.length = 0;
        const read = host.readSite;
        const deploy = host.deployPreview;
        let legacy = true;
        host.readSite = async (id) => {
          const row = await read(id);
          return legacy ? { ...row, previewUpstream: null } : row;
        };
        host.deployPreview = async (input) => {
          legacy = false;
          return deploy(input);
        };
        const upgraded = await client.airapps.siteDeployPreview({ nodeId });
        expect(upgraded.state.previewVersion).toBe(first.state.previewVersion);
        expect(upgraded.state.currentVersion).toBe(first.state.currentVersion);
        await client.airapps.siteDeployPreview({ nodeId });
        expect(calls.deployPreview).toHaveLength(1);
      });
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

    it.each(["public/index.html", "worker.js"] as const)(
      "requires a fresh preview after changing only the website title in %s",
      async (filePath) => {
        const document = (title: string) =>
          `<html><head><title>${title}</title></head><body><h1>Products</h1></body></html>`;
        const content = (title: string) =>
          filePath === "worker.js"
            ? `export default { fetch() { return new Response(${JSON.stringify(document(title))}, { headers: { "content-type": "text/html" } }); } };`
            : document(title);
        const nodeId = await createApp(
          siteFiles().map((file) =>
            file.path === filePath ? { ...file, content: content("Original shop") } : file,
          ),
        );
        const { host, calls } = createFakeHost();
        await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
          const original = await client.airapps.siteDeployPreview({ nodeId });
          await client.airapps.siteGoLive({ nodeId });
          await editFile(nodeId, filePath, content("Updated shop"));

          const edited = await client.airapps.siteState({ nodeId });
          expect(edited.currentVersion).not.toBe(original.state.previewVersion);
          expect(edited).toMatchObject({
            previewVersion: original.state.previewVersion,
            liveVersion: original.state.previewVersion,
            previewStale: true,
            publication: "live-with-changes",
          });
          expect((await client.airapps.siteGoLive({ nodeId })).outcome).toBe("preview-stale");
          expect(calls.goLive).toHaveLength(1);

          const refreshed = await client.airapps.siteDeployPreview({ nodeId });
          expect(refreshed.state).toMatchObject({
            currentVersion: edited.currentVersion,
            previewVersion: edited.currentVersion,
            liveVersion: original.state.previewVersion,
            previewStale: false,
            publication: "live-with-changes",
          });
          const uploaded = calls.deployPreview.at(-1)?.bundle;
          const uploadedContent =
            filePath === "worker.js"
              ? uploaded?.workerCode
              : new TextDecoder().decode(
                  uploaded?.assets.find((asset) => asset.path === "/index.html")?.content,
                );
          expect(uploadedContent).toContain("<title>Updated shop</title>");
          expect(uploadedContent).not.toContain("<title>Original shop</title>");

          const published = await client.airapps.siteGoLive({ nodeId });
          expect(published).toMatchObject({
            outcome: "ok",
            state: { liveVersion: edited.currentVersion, publication: "live", previewStale: false },
          });
          expect(calls.goLive.at(-1)?.bundle).toEqual(uploaded);
        });
        expect(calls.deployPreview).toHaveLength(2);
        expect(calls.goLive).toHaveLength(2);
      },
    );
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

  describe("release management through the real router", () => {
    const releases: AirAppSiteReleasesVO = {
      available: true,
      versions: [
        {
          version: "saved-v1",
          releaseNumber: 1,
          createdAt: "2026-11-11T00:00:00.000Z",
          createdBy: "local",
          isCurrent: false,
          canRollback: true,
        },
      ],
      history: [],
      status: "idle",
      lastError: null,
    };
    const releaseHost = () => {
      const readReleases = vi.fn(async () => releases);
      const rollback = vi.fn(async () => ({
        address: "https://site-x.sites.test",
        liveVersion: "saved-v1",
        previewVersion: "draft",
        isPublic: true,
        previewDeployedAt: null,
        liveDeployedAt: new Date(),
        previewUpstream: null,
      }));
      return { ...createFakeHost({ readReleases, rollback }), readReleases, rollback };
    };

    it("keeps locked metadata, history and current previews readable while refusing publication and rollback", async () => {
      const nodeId = await createApp();
      const { host, calls, rollback } = releaseHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await client.airapps.siteDeployPreview({ nodeId });
        await client.airapps.siteGoLive({ nodeId });
        const readSite = host.readSite.bind(host);
        host.readSite = async (id) => ({
          ...(await readSite(id)),
          environmentDeploymentLock: { reason: "SPACE_VAULT_MANAGE_REQUIRED" },
        });
        expect((await client.airapps.siteState({ nodeId })).environmentDeploymentLock).toEqual({
          reason: "SPACE_VAULT_MANAGE_REQUIRED",
        });
        expect((await client.airapps.siteReleases({ nodeId })).versions[0].canRollback).toBe(false);
        expect((await client.airapps.siteDeployPreview({ nodeId })).outcome).toBe("ok");
        for (const operation of [
          () => client.airapps.siteGoLive({ nodeId }),
          () => client.airapps.siteRepublish({ nodeId }),
          () => client.airapps.siteRollback({ nodeId, version: "saved-v1" }),
        ])
          await expect(operation()).rejects.toMatchObject({
            code: "FORBIDDEN",
            data: { reason: "SPACE_VAULT_MANAGE_REQUIRED" },
          });
        expect(calls.deployPreview).toHaveLength(1);
        expect(calls.goLive).toHaveLength(1);
        expect(calls.setPublic).toHaveLength(0);
        expect(rollback).not.toHaveBeenCalled();
        await client.airapps.siteUnpublish({ nodeId });
        expect(calls.setPublic).toEqual([[nodeId, false]]);
      });
    });

    it("keeps log reads available for lapsed plans without rebuilding the draft", async () => {
      const nodeId = await createApp();
      await editFile(nodeId, "worker.js", "export default {");
      const readLogs = vi.fn(async (_nodeId: string, version: string) => ({
        available: true,
        version,
        from: "2026-11-17T00:00:00.000Z",
        to: "2026-11-17T01:00:00.000Z",
        entries: [],
        truncated: false,
      }));
      const { host } = createFakeHost({ readLogs });
      await runWithBusabaseContext(
        {
          airAppSiteHost: host,
          resolveAirAppEngineLock: async () => ({ lockedEngines: ["site"], planLabel: "Plus" }),
        },
        async () => {
          expect(await client.airapps.siteLogs({ nodeId, version: "saved-v1" })).toMatchObject({
            available: true,
            version: "saved-v1",
          });
        },
      );
      expect(readLogs).toHaveBeenCalledOnce();
      expect(readLogs.mock.calls[0]?.slice(0, 2)).toEqual([nodeId, "saved-v1"]);
    });

    it("returns unavailable logs for older hosts", async () => {
      const nodeId = await createApp();
      const { host } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        expect(await client.airapps.siteLogs({ nodeId, version: "v1" })).toMatchObject({
          available: false,
          entries: [],
          truncated: false,
        });
      });
    });

    it("denies readers and cross-space log reads before contacting the provider", async () => {
      const nodeId = await createApp();
      const readLogs = vi.fn();
      const { host } = createFakeHost({ readLogs });
      for (const scope of [
        { isSpaceManager: false, permissionLevel: "read" as const },
        { spaceId: "other-space" },
      ]) {
        await runWithBusabaseContext({ airAppSiteHost: host, ...scope }, async () => {
          await expect(client.airapps.siteLogs({ nodeId, version: "v1" })).rejects.toBeTruthy();
        });
      }
      expect(readLogs).not.toHaveBeenCalled();
    });

    it("keeps older hosts compatible and refuses unsupported rollback", async () => {
      const nodeId = await createApp();
      const { host } = createFakeHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        expect(await client.airapps.siteReleases({ nodeId })).toMatchObject({
          available: false,
          versions: [],
        });
        await expect(
          client.airapps.siteRollback({ nodeId, version: "saved-v1" }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      });
    });

    it("keeps history readable for a lapsed plan but refuses rollback", async () => {
      const nodeId = await createApp();
      const { host, readReleases, rollback } = releaseHost();
      await runWithBusabaseContext(
        {
          airAppSiteHost: host,
          resolveAirAppEngineLock: async () => ({ lockedEngines: ["site"], planLabel: "Plus" }),
        },
        async () => {
          expect((await client.airapps.siteReleases({ nodeId })).versions[0]?.canRollback).toBe(
            false,
          );
          await expect(
            client.airapps.siteRollback({ nodeId, version: "saved-v1" }),
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
        },
      );
      expect(readReleases).toHaveBeenCalledExactlyOnceWith(nodeId);
      expect(rollback).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      "keeps Free history readable and refuses rollback when remote is locked: %s",
      async (remoteLocked) => {
        const nodeId = await createApp();
        const { host, readReleases, rollback, calls } = releaseHost();
        await runWithBusabaseContext(
          {
            airAppSiteHost: host,
            resolveAirAppEngineLock: async () => ({
              lockedEngines: remoteLocked ? ["remote"] : [],
              sitePublishingLocked: true,
              planLabel: "Plus",
            }),
          },
          async () => {
            const history = await client.airapps.siteReleases({ nodeId });
            expect(history).toMatchObject({
              available: true,
              versions: [{ version: "saved-v1", canRollback: false }],
            });
            expect((await client.airapps.siteState({ nodeId })).engine).toBe("available");
            await expect(
              client.airapps.siteRollback({ nodeId, version: "saved-v1" }),
            ).rejects.toMatchObject({
              code: "FORBIDDEN",
              data: { reason: "AIRAPP_SITE_PUBLISH_PLAN_REQUIRED", planLabel: "Plus" },
            });
          },
        );
        expect(readReleases).toHaveBeenCalledExactlyOnceWith(nodeId);
        expect(rollback).not.toHaveBeenCalled();
        expect(calls.goLive).toHaveLength(0);
        expect(calls.setPublic).toHaveLength(0);
      },
    );

    it("rechecks publishing entitlement before restoring a retained release after upgrade", async () => {
      const nodeId = await createApp();
      const { host, rollback } = releaseHost();
      let publishingLocked = true;
      await runWithBusabaseContext(
        {
          airAppSiteHost: host,
          resolveAirAppEngineLock: async () =>
            publishingLocked
              ? { lockedEngines: ["remote"], sitePublishingLocked: true, planLabel: "Plus" }
              : null,
        },
        async () => {
          expect((await client.airapps.siteReleases({ nodeId })).versions[0]?.canRollback).toBe(
            false,
          );
          await expect(
            client.airapps.siteRollback({ nodeId, version: "saved-v1" }),
          ).rejects.toMatchObject({ data: { reason: "AIRAPP_SITE_PUBLISH_PLAN_REQUIRED" } });
          expect(rollback).not.toHaveBeenCalled();
          publishingLocked = false;
          expect((await client.airapps.siteReleases({ nodeId })).versions[0]?.canRollback).toBe(
            true,
          );
          expect(await client.airapps.siteRollback({ nodeId, version: "saved-v1" })).toMatchObject({
            outcome: "ok",
            state: {
              engine: "available",
              publicationLock: null,
              liveVersion: "saved-v1",
              isPublic: true,
            },
          });
        },
      );
      expect(rollback).toHaveBeenCalledExactlyOnceWith(nodeId, "saved-v1", "Site app");
    });

    it("denies readers and cross-space release operations before the host is called", async () => {
      const nodeId = await createApp();
      const { host, readReleases, rollback } = releaseHost();
      for (const scope of [
        { isSpaceManager: false, permissionLevel: "read" as const },
        { spaceId: "other-space" },
      ]) {
        await runWithBusabaseContext({ airAppSiteHost: host, ...scope }, async () => {
          await expect(client.airapps.siteReleases({ nodeId })).rejects.toBeTruthy();
          await expect(
            client.airapps.siteRollback({ nodeId, version: "saved-v1" }),
          ).rejects.toBeTruthy();
        });
      }
      expect(readReleases).not.toHaveBeenCalled();
      expect(rollback).not.toHaveBeenCalled();
    });

    it("rolls back a retained release while current draft syntax is invalid without rewriting files", async () => {
      const nodeId = await createApp();
      const { host, rollback } = releaseHost();
      await editFile(nodeId, "worker.js", "export default {");
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        const result = await client.airapps.siteRollback({ nodeId, version: "saved-v1" });
        expect(result.outcome).toBe("ok");
        expect(result.state.liveVersion).toBe("saved-v1");
        expect(result.state.previewVersion).toBe("draft");
        expect(result.state.blockers.length).toBeGreaterThan(0);
        expect(
          (await client.fileTrees.readFile({ type: "airapp", nodeId, filePath: "worker.js" }))
            .content,
        ).toBe("export default {");
      });
      expect(rollback).toHaveBeenCalledExactlyOnceWith(nodeId, "saved-v1", "Site app");
    });

    it("reports successful rollback even when a current draft object can no longer be read", async () => {
      const { storage } = await import("openlib/storage");
      const unreadable =
        "export default { fetch() { return new Response('unreadable-draft-unique'); } };";
      const nodeId = await createApp(
        siteFiles().map((file) =>
          file.path === "worker.js" ? { ...file, content: unreadable } : file,
        ),
      );
      const objects = await storage.listObjects(undefined, 10000);
      let deleted = false;
      for (const object of objects.objects) {
        if ((await storage.getObject(object.key)).toString() === unreadable) {
          await storage.deleteObject(object.key);
          deleted = true;
        }
      }
      expect(deleted).toBe(true);
      const { host } = releaseHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        const result = await client.airapps.siteRollback({ nodeId, version: "saved-v1" });
        expect(result).toMatchObject({
          outcome: "ok",
          state: { liveVersion: "saved-v1", currentVersion: null, isPublic: true },
        });
      });
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

    it("previews privately when only public publishing is locked", async () => {
      const nodeId = await createApp();
      const bindDomain = vi.fn();
      const setPrimaryDomain = vi.fn();
      const { host, calls } = createFakeHost({ bindDomain, setPrimaryDomain });
      await runWithBusabaseContext(
        {
          airAppSiteHost: host,
          resolveAirAppEngineLock: async () => ({
            lockedEngines: ["remote"],
            sitePublishingLocked: true,
            planLabel: "Plus",
          }),
        },
        async () => {
          const preview = await client.airapps.siteDeployPreview({ nodeId });
          expect(preview).toMatchObject({
            outcome: "ok",
            state: {
              engine: "available",
              publicationLock: { planLabel: "Plus" },
              isPublic: false,
              publication: "not-live",
            },
          });
          expect(preview.state.previewUrl).toContain(`/api/airapp-preview/${nodeId}/`);
          // Provider addresses and tokens remain behind the member preview registry.
          expect(JSON.stringify(preview)).not.toContain("the-token");
          expect(JSON.stringify(preview)).not.toContain("site-x-preview.sites.test");
          expect(await client.airapps.siteState({ nodeId })).toMatchObject({
            engine: "available",
            publicationLock: { planLabel: "Plus" },
          });
          for (const action of [client.airapps.siteGoLive, client.airapps.siteRepublish]) {
            await expect(action({ nodeId })).rejects.toMatchObject({
              code: "FORBIDDEN",
              data: { reason: "AIRAPP_SITE_PUBLISH_PLAN_REQUIRED", planLabel: "Plus" },
            });
          }
          for (const action of [
            client.airapps.siteBindDomain,
            client.airapps.siteSetPrimaryDomain,
          ]) {
            await expect(action({ nodeId, hostname: "shop.company.test" })).rejects.toMatchObject({
              code: "FORBIDDEN",
              data: { reason: "AIRAPP_SITE_PUBLISH_PLAN_REQUIRED", planLabel: "Plus" },
            });
          }
        },
      );
      expect(calls.deployPreview).toHaveLength(1);
      expect(calls.goLive).toHaveLength(0);
      expect(calls.setPublic).toHaveLength(0);
      expect(bindDomain).not.toHaveBeenCalled();
      expect(setPrimaryDomain).not.toHaveBeenCalled();
    });

    it("rechecks publishing after downgrade while preserving preview and takedown", async () => {
      const nodeId = await createApp();
      const { host, calls } = createFakeHost();
      let publishingLocked = false;
      await runWithBusabaseContext(
        {
          airAppSiteHost: host,
          resolveAirAppEngineLock: async () => ({
            lockedEngines: [],
            sitePublishingLocked: publishingLocked,
            planLabel: "Plus",
          }),
        },
        async () => {
          await client.airapps.siteDeployPreview({ nodeId });
          expect((await client.airapps.siteGoLive({ nodeId })).state.isPublic).toBe(true);
          publishingLocked = true;
          expect((await client.airapps.siteDeployPreview({ nodeId })).state.engine).toBe(
            "available",
          );
          await expect(client.airapps.siteGoLive({ nodeId })).rejects.toMatchObject({
            data: { reason: "AIRAPP_SITE_PUBLISH_PLAN_REQUIRED" },
          });
          expect((await client.airapps.siteUnpublish({ nodeId })).state).toMatchObject({
            isPublic: false,
            publicationLock: { planLabel: "Plus" },
          });
          await expect(client.airapps.siteRepublish({ nodeId })).rejects.toMatchObject({
            data: { reason: "AIRAPP_SITE_PUBLISH_PLAN_REQUIRED" },
          });
          publishingLocked = false;
          expect((await client.airapps.siteRepublish({ nodeId })).state.isPublic).toBe(true);
        },
      );
      expect(calls.goLive).toHaveLength(1);
      expect(calls.setPublic.map(([, value]) => value)).toEqual([false, true]);
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
      primaryHostname: null,
      primarySupported: true,
    };
    const domainHost = () => {
      const readDomains = vi.fn(async () => state);
      const bindDomain = vi.fn(async () => state);
      const unbindDomain = vi.fn(async () => state);
      const setPrimaryDomain = vi.fn(async () => state);
      return {
        ...createFakeHost({ readDomains, bindDomain, unbindDomain, setPrimaryDomain }),
        readDomains,
        bindDomain,
        unbindDomain,
        setPrimaryDomain,
      };
    };

    it("offers an unavailable state for existing hosts without domain support", async () => {
      const nodeId = await createApp();
      expect(await client.airapps.siteDomains({ nodeId })).toEqual({
        available: false,
        cnameTarget: null,
        bindings: [],
        primaryHostname: null,
        primarySupported: false,
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

    it("chooses a primary domain only on a live site, and clears it without one", async () => {
      const nodeId = await createApp();
      const { host, setPrimaryDomain } = domainHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await expect(
          client.airapps.siteSetPrimaryDomain({ nodeId, hostname: "www.company.test" }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(setPrimaryDomain).not.toHaveBeenCalled();
        // Clearing never needs a live version: it only stops redirects.
        await expect(
          client.airapps.siteSetPrimaryDomain({ nodeId, hostname: null }),
        ).resolves.toEqual(state);
        await client.airapps.siteDeployPreview({ nodeId });
        await client.airapps.siteGoLive({ nodeId });
        await expect(
          client.airapps.siteSetPrimaryDomain({ nodeId, hostname: " WWW.Company.Test " }),
        ).resolves.toEqual(state);
      });
      expect(setPrimaryDomain.mock.calls).toEqual([
        [nodeId, null],
        [nodeId, "www.company.test"],
      ]);
    });

    it("refuses a primary domain on a host that cannot redirect", async () => {
      const nodeId = await createApp();
      const { host } = createFakeHost({ readDomains: async () => state });
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        await expect(
          client.airapps.siteSetPrimaryDomain({ nodeId, hostname: null }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      });
    });

    it("rejects malformed domains before the provider is called", async () => {
      const nodeId = await createApp();
      const { host, bindDomain, unbindDomain, setPrimaryDomain } = domainHost();
      await runWithBusabaseContext({ airAppSiteHost: host }, async () => {
        for (const action of [
          client.airapps.siteBindDomain,
          client.airapps.siteUnbindDomain,
          client.airapps.siteSetPrimaryDomain,
        ]) {
          await expect(
            action({ nodeId, hostname: "https://shop.company.test/path" }),
          ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        }
      });
      expect(bindDomain).not.toHaveBeenCalled();
      expect(unbindDomain).not.toHaveBeenCalled();
      expect(setPrimaryDomain).not.toHaveBeenCalled();
    });

    it("lets a lapsed plan inspect and remove domains but refuses additions", async () => {
      const nodeId = await createApp();
      const { host, readDomains, bindDomain, unbindDomain, setPrimaryDomain } = domainHost();
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
          await expect(
            client.airapps.siteSetPrimaryDomain({ nodeId, hostname: "shop.company.test" }),
          ).rejects.toMatchObject({ data: { reason: "AIRAPP_ENGINE_PLAN_REQUIRED" } });
        },
      );
      expect(readDomains).toHaveBeenCalledExactlyOnceWith(nodeId);
      expect(unbindDomain).toHaveBeenCalledExactlyOnceWith(nodeId, "shop.company.test");
      expect(bindDomain).not.toHaveBeenCalled();
      expect(setPrimaryDomain).not.toHaveBeenCalled();
    });

    it("denies readers and cross-space requests before any provider call", async () => {
      const nodeId = await createApp();
      const { host, readDomains, bindDomain, unbindDomain, setPrimaryDomain } = domainHost();
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
          await expect(
            client.airapps.siteSetPrimaryDomain({ nodeId, hostname: "shop.company.test" }),
          ).rejects.toBeTruthy();
        });
      }
      expect(readDomains).not.toHaveBeenCalled();
      expect(bindDomain).not.toHaveBeenCalled();
      expect(unbindDomain).not.toHaveBeenCalled();
      expect(setPrimaryDomain).not.toHaveBeenCalled();
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
