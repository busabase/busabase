import { z } from "zod";

export const AIRAPP_SITE_RELEASES_TAB_TYPE = "airapp-site-releases";
export const airAppSiteReleasesTabId = (nodeId: string) => `airapp-site-releases-${nodeId}`;

export const AirAppSiteReleasesPayloadSchema = z.object({
  nodeId: z.string().min(1),
  nodeName: z.string(),
});
