import "server-only";

import { getContextAirAppSiteHost } from "../../../context";

/**
 * What node lifecycle owes a published site. Kept apart from `site-engine.ts`,
 * which reads file trees, so the node and merge logic can call it without a cycle.
 */

/**
 * An archived app stops serving straight away, but keeps its scripts: Trash is
 * recoverable. The change request has already committed by now, so a failure can
 * only be reported, and the permanent delete below still removes the site.
 */
export const unpublishSitesOfArchivedNodes = async (nodeIds: readonly string[]): Promise<void> => {
  if (nodeIds.length === 0) return;
  try {
    await getContextAirAppSiteHost()?.unpublishSites(nodeIds);
  } catch (error) {
    console.error("[busabase] Could not take archived AirApps' sites offline", error);
  }
};

/**
 * Runs BEFORE a permanent delete commits, and lets its failure stop the delete:
 * once the node is gone there is nothing left to retry from, and the site would
 * stay up with no way to reach it from the product.
 */
export const removeSitesOfPurgedNodes = async (nodeIds: readonly string[]): Promise<void> => {
  if (nodeIds.length === 0) return;
  await getContextAirAppSiteHost()?.removeSites(nodeIds);
};
