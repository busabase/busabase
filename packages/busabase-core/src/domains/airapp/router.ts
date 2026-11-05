import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { runOrAttachSession, stopRunSession } from "./logic/run-session";
import {
  bindSiteDomain,
  deploySitePreview,
  getSiteDomains,
  getSiteState,
  goLiveWithSite,
  republishSite,
  unbindSiteDomain,
  unpublishSite,
} from "./logic/site-engine";

// AirApp domain oRPC handler slice; aggregated into the kernel router (router.ts).
// The CRUD/file surface lives on the shared `/file-trees` router — only the
// local runtime is AirApp-specific.
const os = implement(busabaseContract);

export const airappRouter = {
  // Start-or-attach, not start: a second viewer of a running app joins it
  // instead of racing a second `npm install` against the first.
  runLocal: os.airapps.runLocal.handler(({ input, signal }) => runOrAttachSession(input, signal)),
  stopLocal: os.airapps.stopLocal.handler(({ input }) => stopRunSession(input.nodeId)),
  siteState: os.airapps.siteState.handler(({ input }) => getSiteState(input.nodeId)),
  siteDomains: os.airapps.siteDomains.handler(({ input }) => getSiteDomains(input.nodeId)),
  siteBindDomain: os.airapps.siteBindDomain.handler(({ input }) =>
    bindSiteDomain(input.nodeId, input.hostname),
  ),
  siteUnbindDomain: os.airapps.siteUnbindDomain.handler(({ input }) =>
    unbindSiteDomain(input.nodeId, input.hostname),
  ),
  siteDeployPreview: os.airapps.siteDeployPreview.handler(({ input }) =>
    deploySitePreview(input.nodeId),
  ),
  siteGoLive: os.airapps.siteGoLive.handler(({ input }) => goLiveWithSite(input.nodeId)),
  siteRepublish: os.airapps.siteRepublish.handler(({ input }) => republishSite(input.nodeId)),
  siteUnpublish: os.airapps.siteUnpublish.handler(({ input }) => unpublishSite(input.nodeId)),
};
