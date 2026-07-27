/**
 * CORS settings for the public `/api/v1` surface, shared by `apps/busabase` and
 * `apps/busabase-cloud` so the two deployments can't drift on what a browser
 * client is allowed to send.
 *
 * The headers below are the ones `busabase-sdk` puts on a request. Without
 * `x-busabase-space` in the allow-list, a cross-origin browser call carrying a
 * space header fails its preflight — which is exactly what an AirApp being
 * developed locally (`pnpm dev` on its own port) does against a Busabase server.
 *
 * Note the deliberate pairing with `Access-Control-Allow-Origin: *`: because a
 * wildcard origin can never be combined with credentials, a *cross-origin*
 * caller can only ever authenticate with a Bearer key, while cookies stay
 * confined to same-origin requests. That is the whole auth split, enforced by
 * the browser rather than by our own code.
 */
export const BUSABASE_API_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

export const BUSABASE_API_ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  "x-busabase-space",
  "x-busabase-channel",
  "x-busabase-client",
].join(", ");
