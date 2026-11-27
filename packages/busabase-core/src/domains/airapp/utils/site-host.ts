/**
 * The seam between Core and whatever publishes `site` AirApps.
 *
 * Core owns everything about the app: who may act, which files, which version,
 * what may go live. A host owns the provider and its records, so Core never
 * learns which provider it is, and a host without one simply offers no `site`.
 *
 * A host also gives each uploaded script an ordinary API key of `bundle.access`,
 * owned by the person whose action caused the upload and bound to the space, so a
 * site reaches its data through the same API as every other client.
 *
 * PURITY: types only, so the context module can name it without pulling a server
 * implementation along.
 */

import type {
  AirAppSiteDirectValueInput,
  AirAppSiteDomainsVO,
  AirAppSiteEnvironmentBinding,
  AirAppSiteEnvironmentDeploymentLock,
  AirAppSiteEnvironmentVO,
  AirAppSiteLogsVO,
  AirAppSiteReleasesVO,
} from "busabase-contract/domains/airapp/contract";
import type { SiteBundle } from "./site-bundle";

export interface AirAppSiteRecord {
  /** Where the site is served once live, or `null` before an address is configured. */
  address: string | null;
  previewVersion: string | null;
  liveVersion: string | null;
  /** The public switch. False before the first Go live, and after turning it off. */
  isPublic: boolean;
  previewDeployedAt: Date | null;
  liveDeployedAt: Date | null;
  /** How the preview proxy reaches the preview. `null` until one exists. */
  previewUpstream: { target: string; headers: Record<string, string> } | null;
  /** Expiring capability URL for cross-device viewing; separate from the authenticated iframe. */
  previewShareUrl?: string | null;
  /** Opaque metadata revisions; Vault values never cross this host boundary. */
  environmentRevision?: string | null;
  previewEnvironmentRevision?: string | null;
  liveEnvironmentRevision?: string | null;
  environmentDeploymentLock?: AirAppSiteEnvironmentDeploymentLock | null;
}

export interface AirAppSiteDeployInput {
  nodeId: string;
  /** The app's name, for naming the key its owner will see in their list. */
  appName: string;
  version: string;
  bundle: SiteBundle;
  /** Static sites get a forwarding Worker; a real one must keep running after assets. */
  hasAppWorker: boolean;
}

export interface AirAppSiteHost {
  /** Presence of the provider's settings, the same rule the picker is resolved from. */
  isConfigured(): boolean;
  /** Never null: a site that has never deployed still has an address it would use. */
  readSite(nodeId: string): Promise<AirAppSiteRecord>;
  deployPreview(input: AirAppSiteDeployInput): Promise<AirAppSiteRecord>;
  /** Publishes `bundle`, which Core has checked is the previewed version. */
  goLive(input: AirAppSiteDeployInput): Promise<AirAppSiteRecord>;
  /** Also switches the live script's key: off stops its data access, on restores it. */
  setPublic(nodeId: string, isPublic: boolean): Promise<AirAppSiteRecord>;
  /** Optional Space Vault capability. Metadata and references only, never plaintext. */
  readEnvironment?(nodeId: string): Promise<AirAppSiteEnvironmentVO>;
  saveEnvironment?(
    nodeId: string,
    bindings: AirAppSiteEnvironmentBinding[],
  ): Promise<AirAppSiteEnvironmentVO>;
  /** Explicit opt-in: an older host must never silently discard input-only values. */
  saveEnvironmentWithValues?(
    nodeId: string,
    input: {
      bindings: AirAppSiteEnvironmentBinding[];
      directValues?: AirAppSiteDirectValueInput[];
    },
  ): Promise<AirAppSiteEnvironmentVO>;
  /** Optional durable release capability: older/local hosts can keep offering sites. */
  readReleases?(nodeId: string): Promise<AirAppSiteReleasesVO>;
  /** Read-only production logs; older/local hosts may omit this capability. */
  readLogs?(nodeId: string, version: string, signal?: AbortSignal): Promise<AirAppSiteLogsVO>;
  rollback?(nodeId: string, version: string, appName: string): Promise<AirAppSiteRecord>;
  /** Optional provider capability; older or local hosts can keep offering sites without domains. */
  readDomains?(nodeId: string): Promise<AirAppSiteDomainsVO>;
  bindDomain?(nodeId: string, hostname: string): Promise<AirAppSiteDomainsVO>;
  unbindDomain?(nodeId: string, hostname: string): Promise<AirAppSiteDomainsVO>;
  /** Makes `hostname` the domain the site's other custom domains redirect to; `null` clears it. */
  setPrimaryDomain?(nodeId: string, hostname: string | null): Promise<AirAppSiteDomainsVO>;
  /**
   * Takes these nodes' sites off their addresses, and switches their live keys off,
   * keeping both restorable. Ignores nodes with none.
   */
  unpublishSites(nodeIds: readonly string[]): Promise<void>;
  /** Removes these nodes' sites and their keys. Ignores nodes with none, and throws if it could not. */
  removeSites(nodeIds: readonly string[]): Promise<void>;
}
