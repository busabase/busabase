import { createAirAppEmbedBridgeHandler } from "busabase-core/domains/embed-links/bridge";

// Desktop serves the embed data router's RPC surface at the same prefix as the
// dashboard's. No host context: the single-user local host has no account,
// membership or API-key state for the shared resolver to check.
const handle = createAirAppEmbedBridgeHandler({ rpcPrefix: "/api/rpc" });

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
