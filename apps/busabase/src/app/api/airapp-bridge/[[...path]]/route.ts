import "server-only";

/**
 * Local-Node data bridge: replays `/__busabase_api__/<real-path>` against the
 * same origin with the browser's session cookie, so an AirApp running under
 * the Local Node.js engine can read the workspace's own data. Thin shim — all
 * logic lives in busabase-core's `bridgeBusabaseApi`. (Nodepod previews never
 * hit this route; their Service Worker intercepts the prefix first.)
 */

import { bridgeBusabaseApi } from "busabase-core/domains/airapp/logic/local-preview-bridge";

export const dynamic = "force-dynamic";

const handle = async (req: Request, ctx: { params: Promise<{ path?: string[] }> }) => {
  const { path } = await ctx.params;
  return bridgeBusabaseApi(req, Array.isArray(path) ? path.join("/") : (path ?? ""));
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
