import "server-only";

import { ORPCError } from "@orpc/server";
import type {
  AirAppSiteActionVO,
  AirAppSiteDomainsVO,
  AirAppSitePublication,
  AirAppSiteStateVO,
} from "busabase-contract/domains/airapp/contract";
import { and, eq } from "drizzle-orm";
import {
  getContextAirAppSiteHost,
  getContextSpaceId,
  resolveContextAirAppEngineLock,
} from "../../../context";
import { getDb } from "../../../db";
import { busabaseNodes } from "../../../db/schema";
import { assertNodePermission } from "../../../logic/node-acl";
import { getFileTreeKind, listFileTreeFiles, readFileTreeFileBytes } from "../../filetree/handlers";
import { AIRAPP_MANIFEST_PATH } from "../utils/airapp-runtime-descriptor";
import {
  ASSETS_ONLY_WORKER,
  computeSiteVersion,
  resolveSiteBundle,
  SITE_MAX_ASSET_BYTES,
  type SiteBundle,
  type SiteBundleBlocker,
  type SiteBundleInputFile,
  selectSiteSourcePaths,
} from "../utils/site-bundle";
import type { AirAppSiteHost, AirAppSiteRecord } from "../utils/site-host";
import { assertEngineIncludedInPlan } from "./engine-availability";
import { currentPreviewOwner, registerLocalPreview } from "./local-preview-registry";

/**
 * The `site` engine, seen from the app's side: a deployment, not a session.
 *
 * What makes it different from a run is that the server reads the files itself.
 * A run mounts what the browser sends; a site publishes to the public, so
 * nothing about what goes out is taken from the client. It also has no process to
 * keep alive, so running it twice with the same files is the same as once, which
 * is what lets opening the node "run" it without uploading anything new.
 */

const READ_CONCURRENCY = 16;

const previewUrlFor = (nodeId: string): string =>
  `/api/airapp-preview/${encodeURIComponent(nodeId)}/`;

const listAllFiles = async (nodeId: string) => {
  const config = getFileTreeKind("airapp");
  const files: Awaited<ReturnType<typeof listFileTreeFiles>> = [];
  let after: string | undefined;
  for (;;) {
    const page = await listFileTreeFiles(config, nodeId, { limit: 5_000, after });
    files.push(...page);
    if (page.length < 5_000) return files;
    after = page.at(-1)?.path;
  }
};

/** Reads only what could deploy, and never a file too large to deploy anyway. */
const loadSiteFiles = async (nodeId: string): Promise<SiteBundleInputFile[]> => {
  const config = getFileTreeKind("airapp");
  const listing = await listAllFiles(nodeId);
  if (!listing.some((file) => file.path === AIRAPP_MANIFEST_PATH)) return [];

  const manifest = (await readFileTreeFileBytes(config, nodeId, AIRAPP_MANIFEST_PATH)).toString(
    "utf8",
  );
  const selected = new Set(
    selectSiteSourcePaths(
      manifest,
      listing.map((file) => file.path),
    ),
  );
  const wanted = listing.filter(
    (file) => selected.has(file.path) && file.path !== AIRAPP_MANIFEST_PATH,
  );

  const files: SiteBundleInputFile[] = [{ path: AIRAPP_MANIFEST_PATH, content: manifest }];
  for (let start = 0; start < wanted.length; start += READ_CONCURRENCY) {
    files.push(
      ...(await Promise.all(
        wanted.slice(start, start + READ_CONCURRENCY).map(async (file) =>
          file.size > SITE_MAX_ASSET_BYTES
            ? { path: file.path, content: new Uint8Array(0), knownSize: file.size }
            : {
                path: file.path,
                content: new Uint8Array(await readFileTreeFileBytes(config, nodeId, file.path)),
              },
        ),
      )),
    );
  }
  return files;
};

type LoadedSite =
  | { blockers: SiteBundleBlocker[]; bundle: null; version: null }
  | { blockers: []; bundle: SiteBundle; version: string };

const loadSite = async (nodeId: string): Promise<LoadedSite> => {
  const result = await resolveSiteBundle(await loadSiteFiles(nodeId));
  if (!result.ok) return { blockers: result.blockers, bundle: null, version: null };
  return { blockers: [], bundle: result.bundle, version: await computeSiteVersion(result.bundle) };
};

/** What the owner of a site's key sees it called. Only asked when uploading. */
const readAppName = async (nodeId: string): Promise<string> => {
  const db = await getDb();
  const [node] = await db
    .select({ name: busabaseNodes.name })
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.spaceId, getContextSpaceId()), eq(busabaseNodes.id, nodeId)))
    .limit(1);
  return node?.name?.trim() || nodeId;
};

const publicationOf = (record: AirAppSiteRecord, version: string | null): AirAppSitePublication => {
  if (!record.isPublic || record.liveVersion === null) return "not-live";
  return record.liveVersion === version ? "live" : "live-with-changes";
};

const toState = (
  nodeId: string,
  engine: AirAppSiteStateVO["engine"],
  record: AirAppSiteRecord,
  loaded: LoadedSite,
): AirAppSiteStateVO => ({
  engine,
  address: record.address,
  publication: publicationOf(record, loaded.version),
  isPublic: record.isPublic && record.liveVersion !== null,
  previewUrl: record.previewVersion ? previewUrlFor(nodeId) : null,
  previewVersion: record.previewVersion,
  liveVersion: record.liveVersion,
  currentVersion: loaded.version,
  previewStale: record.previewVersion !== null && record.previewVersion !== loaded.version,
  previewDeployedAt: record.previewDeployedAt?.toISOString() ?? null,
  liveDeployedAt: record.liveDeployedAt?.toISOString() ?? null,
  blockers: loaded.blockers,
});

const NOT_OFFERED: AirAppSiteStateVO = {
  engine: "not-offered",
  address: null,
  publication: "not-live",
  isPublic: false,
  previewUrl: null,
  previewVersion: null,
  liveVersion: null,
  currentVersion: null,
  previewStale: false,
  previewDeployedAt: null,
  liveDeployedAt: null,
  blockers: [],
};

const resolveEngineStatus = async (host: AirAppSiteHost): Promise<AirAppSiteStateVO["engine"]> => {
  if (!host.isConfigured()) return "not-configured";
  const lock = await resolveContextAirAppEngineLock();
  return lock?.lockedEngines.includes("site") ? "locked" : "available";
};

/** Refuses what this deployment cannot do at all. Comes before any plan question. */
const requireConfiguredHost = (): AirAppSiteHost => {
  const host = getContextAirAppSiteHost();
  if (!host) {
    throw new ORPCError("FORBIDDEN", {
      message: 'AirApp engine "site" is not offered by this deployment.',
    });
  }
  if (!host.isConfigured()) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: 'AirApp engine "site" is not configured on this deployment.',
    });
  }
  return host;
};

const requireUsableHost = async (): Promise<AirAppSiteHost> => {
  const host = requireConfiguredHost();
  await assertEngineIncludedInPlan("site");
  return host;
};

/** Not a refusal when locked: a lapsed plan still has to see the site it may need to take down. */
export const getSiteState = async (nodeId: string): Promise<AirAppSiteStateVO> => {
  await assertNodePermission(nodeId, "write");
  const host = getContextAirAppSiteHost();
  if (!host) return NOT_OFFERED;
  const engine = await resolveEngineStatus(host);
  return toState(nodeId, engine, await host.readSite(nodeId), await loadSite(nodeId));
};

const NO_DOMAINS: AirAppSiteDomainsVO = { available: false, cnameTarget: null, bindings: [] };

/** Domain provider failures never affect the default address or publication state. */
export const getSiteDomains = async (nodeId: string): Promise<AirAppSiteDomainsVO> => {
  await assertNodePermission(nodeId, "write");
  return getContextAirAppSiteHost()?.readDomains?.(nodeId) ?? NO_DOMAINS;
};

export const bindSiteDomain = async (
  nodeId: string,
  hostname: string,
): Promise<AirAppSiteDomainsVO> => {
  await assertNodePermission(nodeId, "write");
  const host = await requireUsableHost();
  if (!host.bindDomain) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "Custom website domains are not configured on this deployment.",
    });
  }
  if (!(await host.readSite(nodeId)).liveVersion) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "Publish this website before connecting a custom domain.",
    });
  }
  return host.bindDomain(nodeId, hostname);
};

export const unbindSiteDomain = async (
  nodeId: string,
  hostname: string,
): Promise<AirAppSiteDomainsVO> => {
  await assertNodePermission(nodeId, "write");
  const host = getContextAirAppSiteHost();
  if (!host?.unbindDomain) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "Custom website domains are not configured on this deployment.",
    });
  }
  return host.unbindDomain(nodeId, hostname);
};

export const deploySitePreview = async (nodeId: string): Promise<AirAppSiteActionVO> => {
  await assertNodePermission(nodeId, "write");
  const host = await requireUsableHost();
  const loaded = await loadSite(nodeId);
  let record = await host.readSite(nodeId);
  if (!loaded.bundle) {
    return { outcome: "blocked", state: toState(nodeId, "available", record, loaded) };
  }
  // Each member's own run still registers below: that is what lets them see it.
  if (record.previewVersion !== loaded.version || !record.previewUpstream) {
    record = await host.deployPreview({
      nodeId,
      appName: await readAppName(nodeId),
      version: loaded.version,
      bundle: loaded.bundle,
      hasAppWorker: loaded.bundle.workerCode !== ASSETS_ONLY_WORKER,
    });
  }
  if (!record.previewUpstream) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "The site provider reported a preview with no address.",
    });
  }
  await registerLocalPreview(
    nodeId,
    currentPreviewOwner(),
    record.previewUpstream.target,
    record.previewUpstream.headers,
  );
  return { outcome: "ok", state: toState(nodeId, "available", record, loaded) };
};

/**
 * Publishes the previewed version and nothing else.
 *
 * The check is a content hash of what the files would deploy as now. If it equals
 * the preview, the bytes about to go up are byte-for-byte what the person looked
 * at. If it differs, nothing is uploaded and the caller is told, because quietly
 * previewing and publishing the new files would put something live unseen.
 */
export const goLiveWithSite = async (nodeId: string): Promise<AirAppSiteActionVO> => {
  await assertNodePermission(nodeId, "write");
  const host = await requireUsableHost();
  const record = await host.readSite(nodeId);
  const loaded = await loadSite(nodeId);
  const state = (next: AirAppSiteRecord) => toState(nodeId, "available", next, loaded);
  if (!record.previewVersion) return { outcome: "no-preview", state: state(record) };
  if (!loaded.bundle) return { outcome: "blocked", state: state(record) };
  if (loaded.version !== record.previewVersion) {
    return { outcome: "preview-stale", state: state(record) };
  }
  return {
    outcome: "ok",
    state: state(
      await host.goLive({
        nodeId,
        appName: await readAppName(nodeId),
        version: loaded.version,
        bundle: loaded.bundle,
        hasAppWorker: loaded.bundle.workerCode !== ASSETS_ONLY_WORKER,
      }),
    ),
  };
};

/** Back on for the version that was already live. Publishes nothing new. */
export const republishSite = async (nodeId: string): Promise<AirAppSiteActionVO> => {
  await assertNodePermission(nodeId, "write");
  const host = await requireUsableHost();
  const record = await host.readSite(nodeId);
  const loaded = await loadSite(nodeId);
  if (!record.liveVersion) {
    return { outcome: "no-preview", state: toState(nodeId, "available", record, loaded) };
  }
  const next = await host.setPublic(nodeId, true);
  return { outcome: "ok", state: toState(nodeId, "available", next, loaded) };
};

/**
 * No plan check, on purpose: a space whose plan lapsed must still be able to take
 * its own site down. Everything that puts something up does check.
 */
export const unpublishSite = async (nodeId: string): Promise<AirAppSiteActionVO> => {
  await assertNodePermission(nodeId, "write");
  const host = requireConfiguredHost();
  const engine = await resolveEngineStatus(host);
  const next = await host.setPublic(nodeId, false);
  return { outcome: "ok", state: toState(nodeId, engine, next, await loadSite(nodeId)) };
};
