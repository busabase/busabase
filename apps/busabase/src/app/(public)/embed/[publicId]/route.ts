import { createEmbedRouteHandler } from "busabase-core/domains/embed-links/route";

// No host context: the single-user local host has no account, membership or
// API-key state for the shared resolver to check, and redirects follow the
// request's own origin.
export const GET = createEmbedRouteHandler();
