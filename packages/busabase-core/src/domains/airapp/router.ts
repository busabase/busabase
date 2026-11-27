import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { readAgentPreview, startAgentPreview, stopAgentPreview } from "./logic/agent-preview";
import { runOrAttachSession, stopRunSession } from "./logic/run-session";
import {
  bindSiteDomain,
  deploySitePreview,
  getSiteDomains,
  getSiteEnvironment,
  getSiteLogs,
  getSiteReleases,
  getSiteState,
  goLiveWithSite,
  republishSite,
  rollbackSite,
  saveSiteEnvironment,
  setSitePrimaryDomain,
  unbindSiteDomain,
  unpublishSite,
} from "./logic/site-engine";

// AirApp domain oRPC handler slice; aggregated into the kernel router (router.ts).
// The CRUD/file surface lives on the shared `/file-trees` router — only the
// local runtime is AirApp-specific.
const os = implement(busabaseContract);

export const airappRouter = {
  previewStart: os.airapps.previewStart.handler(({ input }) => startAgentPreview(input)),
  previewState: os.airapps.previewState.handler(({ input }) => readAgentPreview(input.nodeId)),
  previewStop: os.airapps.previewStop.handler(({ input }) => stopAgentPreview(input.nodeId)),
  // Start-or-attach, not start: a second viewer of a running app joins it
  // instead of racing a second `npm install` against the first.
  runLocal: os.airapps.runLocal.handler(({ input, signal }) => runOrAttachSession(input, signal)),
  stopLocal: os.airapps.stopLocal.handler(({ input }) => stopRunSession(input.nodeId)),
  siteState: os.airapps.siteState.handler(({ input }) => getSiteState(input.nodeId)),
  siteEnvironment: os.airapps.siteEnvironment.handler(({ input }) =>
    getSiteEnvironment(input.nodeId),
  ),
  siteSaveEnvironment: os.airapps.siteSaveEnvironment.handler(({ input }) =>
    saveSiteEnvironment(input.nodeId, input.bindings, input.directValues),
  ),
  siteReleases: os.airapps.siteReleases.handler(({ input }) => getSiteReleases(input.nodeId)),
  siteLogs: os.airapps.siteLogs.handler(({ input, signal }) =>
    getSiteLogs(input.nodeId, input.version, signal),
  ),
  siteRollback: os.airapps.siteRollback.handler(({ input }) =>
    rollbackSite(input.nodeId, input.version),
  ),
  siteDomains: os.airapps.siteDomains.handler(({ input }) => getSiteDomains(input.nodeId)),
  siteBindDomain: os.airapps.siteBindDomain.handler(({ input }) =>
    bindSiteDomain(input.nodeId, input.hostname),
  ),
  siteUnbindDomain: os.airapps.siteUnbindDomain.handler(({ input }) =>
    unbindSiteDomain(input.nodeId, input.hostname),
  ),
  siteSetPrimaryDomain: os.airapps.siteSetPrimaryDomain.handler(({ input }) =>
    setSitePrimaryDomain(input.nodeId, input.hostname),
  ),
  siteDeployPreview: os.airapps.siteDeployPreview.handler(({ input }) =>
    deploySitePreview(input.nodeId),
  ),
  siteGoLive: os.airapps.siteGoLive.handler(({ input }) => goLiveWithSite(input.nodeId)),
  siteRepublish: os.airapps.siteRepublish.handler(({ input }) => republishSite(input.nodeId)),
  siteUnpublish: os.airapps.siteUnpublish.handler(({ input }) => unpublishSite(input.nodeId)),
};
