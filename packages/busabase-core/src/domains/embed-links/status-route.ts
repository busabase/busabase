import "server-only";

import {
  decodeEmbedCapability,
  EMBED_BASE_SECURITY_HEADERS,
  EMBED_RUNTIME_CAPABILITY_HEADER,
  isValidEmbedPublicId,
} from "./capability";
import { resolveEmbedStatus } from "./logic";

const response = (status: number, body: Record<string, unknown>) =>
  Response.json(body, {
    status,
    headers: { ...EMBED_BASE_SECURITY_HEADERS, "x-robots-tag": "noindex, nofollow" },
  });

/** Header-only heartbeat; ambient member sessions cannot revive a revoked link. */
export function createEmbedStatusRouteHandler({
  withHostContext = (fn) => fn(),
  now = () => new Date(),
}: {
  withHostContext?: <T>(fn: () => Promise<T>) => Promise<T>;
  now?: () => Date;
} = {}) {
  return async (
    request: Request,
    context: { params: Promise<{ publicId: string }> },
  ): Promise<Response> => {
    const { publicId } = await context.params;
    const capability = decodeEmbedCapability(
      request.headers.get(EMBED_RUNTIME_CAPABILITY_HEADER) ?? undefined,
    );
    if (!isValidEmbedPublicId(publicId) || !capability || capability.id !== publicId) {
      return response(404, { state: "unavailable" });
    }
    const status = await withHostContext(() =>
      resolveEmbedStatus(publicId, capability.secret, now()),
    );
    if (!status) return response(404, { state: "unavailable" });
    return response(status.state === "expired" ? 410 : 200, status);
  };
}
