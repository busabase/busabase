import { createEmbedAssetRouteHandler } from "busabase-core/domains/embed-links/asset-route";

export const dynamic = "force-dynamic";

// No host context: the single-user local host has no account, membership or
// API-key state for the shared resolver to check.
export const GET = createEmbedAssetRouteHandler();
