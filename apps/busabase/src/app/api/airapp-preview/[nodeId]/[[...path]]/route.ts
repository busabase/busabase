import "server-only";

/**
 * Same-origin reverse proxy for a running AirApp preview. Thin shim — all logic
 * lives in busabase-core's `proxyLocalPreview`. Forwards to the real localhost
 * dev-server process registered for `nodeId`.
 *
 * This host is single-user, so every request is the same owner as every run.
 * The parameter still exists because the cloud host's copy of this route must
 * resolve a real session, and a proxy that silently defaulted to "whoever" is
 * exactly the hole this closes.
 */

import { proxyLocalPreview } from "busabase-core/domains/airapp/logic/local-preview-proxy";
import { LOCAL_PREVIEW_OWNER } from "busabase-core/domains/airapp/logic/local-preview-registry";

export const dynamic = "force-dynamic";

const handle = async (
  req: Request,
  ctx: { params: Promise<{ nodeId: string; path?: string[] }> },
) => {
  const { nodeId, path } = await ctx.params;
  return proxyLocalPreview(
    req,
    nodeId,
    Array.isArray(path) ? path.join("/") : (path ?? ""),
    LOCAL_PREVIEW_OWNER,
  );
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
