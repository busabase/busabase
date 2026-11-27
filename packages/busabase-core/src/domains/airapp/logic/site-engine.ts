import "server-only";

import { ORPCError } from "@orpc/server";
import type {
  AirAppSiteActionVO,
  AirAppSiteDirectValueInput,
  AirAppSiteDomainsVO,
  AirAppSiteEnvironmentBinding,
  AirAppSiteEnvironmentVO,
  AirAppSiteLogsVO,
  AirAppSitePublication,
  AirAppSiteReleasesVO,
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
import { assertNodePermission, assertWorkspacePermission } from "../../../logic/node-acl";
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
  return record.liveVersion === version && !environmentStale(record, "live")
    ? "live"
    : "live-with-changes";
};

const environmentStale = (record: AirAppSiteRecord, kind: "preview" | "live"): boolean =>
  record[`${kind}Version`] !== null &&
  (record[`${kind}EnvironmentRevision`] ?? null) !== (record.environmentRevision ?? null);

const assertEnvironmentDeploymentAccess = (record: AirAppSiteRecord): void => {
  if (record.environmentDeploymentLock)
    throw new ORPCError("FORBIDDEN", {
      message:
        "Deploying a website with Space Vault bindings requires a Space owner or admin and a manage-level credential.",
      data: record.environmentDeploymentLock,
    });
};

type SiteAccess = Pick<AirAppSiteStateVO, "engine" | "publicationLock">;

const toState = (
  nodeId: string,
  access: SiteAccess,
  record: AirAppSiteRecord,
  loaded: LoadedSite,
): AirAppSiteStateVO => ({
  ...access,
  environmentDeploymentLock: record.environmentDeploymentLock ?? null,
  address: record.address,
  publication: publicationOf(record, loaded.version),
  isPublic: record.isPublic && record.liveVersion !== null,
  previewUrl: record.previewVersion ? previewUrlFor(nodeId) : null,
  previewShareUrl: record.previewShareUrl ?? null,
  previewVersion: record.previewVersion,
  liveVersion: record.liveVersion,
  currentVersion: loaded.version,
  previewStale: record.previewVersion !== null && record.previewVersion !== loaded.version,
  previewEnvironmentStale: environmentStale(record, "preview"),
  liveEnvironmentStale: environmentStale(record, "live"),
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
  previewShareUrl: null,
  previewVersion: null,
  liveVersion: null,
  currentVersion: null,
  previewStale: false,
  previewEnvironmentStale: false,
  liveEnvironmentStale: false,
  previewDeployedAt: null,
  liveDeployedAt: null,
  blockers: [],
};

const resolveSiteAccess = async (host: AirAppSiteHost): Promise<SiteAccess> => {
  if (!host.isConfigured()) return { engine: "not-configured", publicationLock: null };
  const lock = await resolveContextAirAppEngineLock();
  return {
    engine: lock?.lockedEngines.includes("site") ? "locked" : "available",
    publicationLock: lock?.sitePublishingLocked ? { planLabel: lock.planLabel } : null,
  };
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

const requireUsableHost = async (publishing = false) => {
  const host = requireConfiguredHost();
  await assertEngineIncludedInPlan("site");
  const access = await resolveSiteAccess(host);
  if (publishing && access.publicationLock) {
    throw new ORPCError("FORBIDDEN", {
      message: `Website previews are included in this space's plan. Upgrade to ${access.publicationLock.planLabel} to publish a public website.`,
      data: {
        reason: "AIRAPP_SITE_PUBLISH_PLAN_REQUIRED",
        planLabel: access.publicationLock.planLabel,
      },
    });
  }
  return { host, access };
};

/** Not a refusal when locked: a lapsed plan still has to see the site it may need to take down. */
export const getSiteState = async (nodeId: string): Promise<AirAppSiteStateVO> => {
  await assertNodePermission(nodeId, "write");
  const host = getContextAirAppSiteHost();
  if (!host) return NOT_OFFERED;
  const access = await resolveSiteAccess(host);
  return toState(nodeId, access, await host.readSite(nodeId), await loadSite(nodeId));
};

const NO_ENVIRONMENT: AirAppSiteEnvironmentVO = { available: false, sources: [], bindings: [] };

/** Check after ACLs so Site settings cannot create host state for another node type. */
const requireAirAppEnvironmentNode = async (nodeId: string): Promise<void> => {
  const db = await getDb();
  const [node] = await db
    .select({ type: busabaseNodes.type })
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.spaceId, getContextSpaceId()), eq(busabaseNodes.id, nodeId)))
    .limit(1);
  if (!node) throw new ORPCError("NOT_FOUND", { message: "AirApp not found." });
  if (node.type !== "airapp")
    throw new ORPCError("BAD_REQUEST", {
      message: "Website environment settings are only available for AirApps.",
    });
};

/** A node-level grant never grants use of the workspace's credentials by itself. */
export const getSiteEnvironment = async (nodeId: string): Promise<AirAppSiteEnvironmentVO> => {
  await assertNodePermission(nodeId, "write");
  assertWorkspacePermission("write");
  await requireAirAppEnvironmentNode(nodeId);
  return getContextAirAppSiteHost()?.readEnvironment?.(nodeId) ?? NO_ENVIRONMENT;
};

export const saveSiteEnvironment = async (
  nodeId: string,
  bindings: AirAppSiteEnvironmentBinding[],
  directValues?: AirAppSiteDirectValueInput[],
): Promise<AirAppSiteEnvironmentVO> => {
  await assertNodePermission(nodeId, "write");
  assertWorkspacePermission("write");
  await requireAirAppEnvironmentNode(nodeId);
  const host = requireConfiguredHost();
  if (host.saveEnvironmentWithValues)
    return host.saveEnvironmentWithValues(nodeId, {
      bindings,
      ...(directValues === undefined ? {} : { directValues }),
    });
  if (directValues?.length)
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "Direct website environment values are not supported on this deployment.",
    });
  if (!host.saveEnvironment) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "Website Vault bindings are not supported on this deployment.",
    });
  }
  return host.saveEnvironment(nodeId, bindings);
};

const NO_DOMAINS: AirAppSiteDomainsVO = {
  available: false,
  cnameTarget: null,
  bindings: [],
  primaryHostname: null,
  primarySupported: false,
};

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
  const { host } = await requireUsableHost(true);
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

/**
 * Chooses the custom domain the others redirect to, or clears it (`null`). Same
 * permission and plan as binding: it changes what the site's addresses answer.
 */
export const setSitePrimaryDomain = async (
  nodeId: string,
  hostname: string | null,
): Promise<AirAppSiteDomainsVO> => {
  await assertNodePermission(nodeId, "write");
  const { host } = await requireUsableHost(true);
  if (!host.setPrimaryDomain) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "Primary website domains are not supported on this deployment.",
    });
  }
  if (hostname !== null && !(await host.readSite(nodeId)).liveVersion) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "Publish this website before choosing a primary domain.",
    });
  }
  return host.setPrimaryDomain(nodeId, hostname);
};

export const deploySitePreview = async (nodeId: string): Promise<AirAppSiteActionVO> => {
  await assertNodePermission(nodeId, "write");
  const { host, access } = await requireUsableHost();
  const loaded = await loadSite(nodeId);
  let record = await host.readSite(nodeId);
  if (!loaded.bundle) {
    return { outcome: "blocked", state: toState(nodeId, access, record, loaded) };
  }
  // Each member's own run still registers below: that is what lets them see it.
  if (
    record.previewVersion !== loaded.version ||
    !record.previewUpstream ||
    environmentStale(record, "preview")
  ) {
    assertEnvironmentDeploymentAccess(record);
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
  return { outcome: "ok", state: toState(nodeId, access, record, loaded) };
};

/**
 * Publishes the previewed files with the latest saved environment.
 *
 * The check is a content hash of what the files would deploy as now. If it equals
 * the preview, the bytes about to go up are byte-for-byte what the person looked
 * at. If it differs, nothing is uploaded and the caller is told, because quietly
 * previewing and publishing the new files would put something live unseen.
 * Vault bindings deliberately resolve again at publication, so a rotation does
 * not require previewing the same files again.
 */
export const goLiveWithSite = async (nodeId: string): Promise<AirAppSiteActionVO> => {
  await assertNodePermission(nodeId, "write");
  const { host, access } = await requireUsableHost(true);
  const record = await host.readSite(nodeId);
  assertEnvironmentDeploymentAccess(record);
  const loaded = await loadSite(nodeId);
  const state = (next: AirAppSiteRecord) => toState(nodeId, access, next, loaded);
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
  const { host, access } = await requireUsableHost(true);
  const record = await host.readSite(nodeId);
  assertEnvironmentDeploymentAccess(record);
  const loaded = await loadSite(nodeId);
  if (!record.liveVersion) {
    return { outcome: "no-preview", state: toState(nodeId, access, record, loaded) };
  }
  const next = await host.setPublic(nodeId, true);
  return { outcome: "ok", state: toState(nodeId, access, next, loaded) };
};

/**
 * No plan check, on purpose: a space whose plan lapsed must still be able to take
 * its own site down. Everything that puts something up does check.
 */
export const unpublishSite = async (nodeId: string): Promise<AirAppSiteActionVO> => {
  await assertNodePermission(nodeId, "write");
  const host = requireConfiguredHost();
  const access = await resolveSiteAccess(host);
  const next = await host.setPublic(nodeId, false);
  return { outcome: "ok", state: toState(nodeId, access, next, await loadSite(nodeId)) };
};

/** History remains inspectable after a plan lapses; mutations still require entitlement. */
export const getSiteReleases = async (nodeId: string): Promise<AirAppSiteReleasesVO> => {
  await assertNodePermission(nodeId, "write");
  const host = getContextAirAppSiteHost();
  if (!host?.readReleases) {
    return { available: false, versions: [], history: [], status: "idle", lastError: null };
  }
  const releases = await host.readReleases(nodeId);
  const access = await resolveSiteAccess(host);
  const usable =
    access.engine === "available" &&
    !access.publicationLock &&
    !(await host.readSite(nodeId)).environmentDeploymentLock;
  return {
    ...releases,
    versions: releases.versions.map((release) => ({
      ...release,
      canRollback: release.canRollback && usable,
    })),
  };
};

/** Diagnostic reads use release-history access, even when a plan has lapsed. */
export const getSiteLogs = async (
  nodeId: string,
  version: string,
  signal?: AbortSignal,
): Promise<AirAppSiteLogsVO> => {
  await assertNodePermission(nodeId, "write");
  const host = getContextAirAppSiteHost();
  if (host?.readLogs) return host.readLogs(nodeId, version, signal);
  const now = Date.now();
  return {
    available: false,
    version,
    from: new Date(now - 24 * 60 * 60 * 1_000).toISOString(),
    to: new Date(now).toISOString(),
    entries: [],
    truncated: false,
  };
};

/** Restores saved production bytes. Current files may be invalid and are never rebuilt. */
export const rollbackSite = async (
  nodeId: string,
  version: string,
): Promise<AirAppSiteActionVO> => {
  await assertNodePermission(nodeId, "write");
  const { host, access } = await requireUsableHost(true);
  assertEnvironmentDeploymentAccess(await host.readSite(nodeId));
  if (!host.rollback) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "Release rollback is not available on this deployment.",
    });
  }
  const next = await host.rollback(nodeId, version, await readAppName(nodeId));
  let loaded: LoadedSite = { bundle: null, version: null, blockers: [] };
  try {
    loaded = await loadSite(nodeId);
  } catch (error) {
    console.error("[busabase] Could not read the draft after successful Site rollback", error);
  }
  return { outcome: "ok", state: toState(nodeId, access, next, loaded) };
};
