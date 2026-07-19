import "server-only";

/**
 * Same-origin reverse proxy for a running Local Node.js AirApp preview. Thin
 * shim — all logic lives in busabase-core's `proxyLocalPreview`. Forwards to
 * the real localhost dev-server process registered for `nodeId`.
 */

import { proxyLocalPreview } from "busabase-core/domains/airapp/logic/local-preview-proxy";

export const dynamic = "force-dynamic";

const handle = async (
  req: Request,
  ctx: { params: Promise<{ nodeId: string; path?: string[] }> },
) => {
  const { nodeId, path } = await ctx.params;
  return proxyLocalPreview(req, nodeId, Array.isArray(path) ? path.join("/") : (path ?? ""));
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
