import "server-only";

import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { RPCHandler } from "@orpc/server/fetch";
import { type BusabaseDatabase, runWithEmbedContext } from "../../context";
import {
  decodeEmbedCapability,
  EMBED_BASE_SECURITY_HEADERS,
  EMBED_RUNTIME_CAPABILITY_HEADER,
  EMBED_RUNTIME_NODE_HEADER,
  PUBLIC_SHARE_RUNTIME_SPACE_HEADER,
} from "./capability";
import { resolveAirAppEmbedCapability } from "./logic";
import { airAppEmbedDataRouter } from "./runtime-router";

const rpcHandler = new RPCHandler(airAppEmbedDataRouter);
const openApiHandler = new OpenAPIHandler(airAppEmbedDataRouter);

const errorResponse = (status: number, error: string) =>
  Response.json(
    { error },
    { status, headers: { ...EMBED_BASE_SECURITY_HEADERS, pragma: "no-cache" } },
  );

/**
 * Strip every ambient credential before the request reaches the embed data
 * router. The bridge's whole authority is the capability header — a cookie or
 * `Authorization` riding along would be the viewer's real session, and honoring
 * it inside a public embed is the bug PR #5948's follow-up fixed at the Service
 * Worker layer.
 */
const withoutCredentials = async (request: Request, pathname: string): Promise<Request> => {
  const source = new URL(request.url);
  source.pathname = pathname;
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete(EMBED_RUNTIME_CAPABILITY_HEADER);
  headers.delete(EMBED_RUNTIME_NODE_HEADER);
  headers.delete(PUBLIC_SHARE_RUNTIME_SPACE_HEADER);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(source, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
    signal: request.signal,
  });
};

export interface AirAppEmbedBridgeOptions {
  /**
   * Where this host serves the embed data router's RPC surface. The two hosts
   * mount it at different prefixes (`/api/rpc` on Desktop, `/api/rpc/core` on
   * Cloud), and it is the only thing about the bridge that differs.
   */
  rpcPrefix: `/${string}`;
  /** Host db handle; Desktop leaves it unset and uses the core singleton. */
  db?: BusabaseDatabase;
  /**
   * Runs capability resolution inside the host's own context — Cloud injects
   * `resolveEmbedActorState` here so account, membership and API-key state are
   * checked. Desktop has no such state and omits it.
   */
  withHostContext?: <T>(fn: () => Promise<T>) => Promise<T>;
  /**
   * Resolve the caller's PUBLIC-SHARE authority, or null when the header names
   * a node that is not publicly shared as an AirApp.
   *
   * This is the bridge's second credential mode, and it is injected rather than
   * implemented here because "is this node publicly shared" is host state: on
   * Cloud it also has to honor the signed unlock cookie a password-protected
   * share hands out. A host with no public sharing omits this, and the mode
   * simply does not exist for it.
   *
   * The authority it returns must be the ANONYMOUS visitor — strictly smaller
   * than an embed capability. A shared AirApp is opened by whoever was sent the
   * link, routinely a signed-in stranger looking at their own workspace, so the
   * one thing it must never do is borrow the viewer's session.
   */
  resolvePublicShareAuthority?: (
    request: Request,
    nodeId: string,
  ) => Promise<(<T>(fn: () => Promise<T>) => Promise<T>) | null>;
}

/**
 * The public AirApp embed data bridge, shared by both hosts.
 *
 * A sandboxed AirApp cannot hold a session, so it calls this route with its
 * capability instead; the bridge resolves that capability, drops every other
 * credential, and replays the call against the read-only embed data router
 * under an embed context.
 */
export const createAirAppEmbedBridgeHandler = ({
  rpcPrefix,
  db,
  withHostContext = (fn) => fn(),
  resolvePublicShareAuthority,
}: AirAppEmbedBridgeOptions) => {
  /**
   * Which credential the caller presented, resolved into "run the router with
   * THIS authority" — or null when nothing checks out.
   *
   * The embed capability is tried first and, when one is present, it decides
   * the request outright: a caller holding a capability is not silently
   * downgraded to the public-share path if it fails to resolve.
   */
  const resolveAuthority = async (
    request: Request,
    nodeId: string,
  ): Promise<(<T>(fn: () => Promise<T>) => Promise<T>) | null> => {
    const encoded = decodeEmbedCapability(
      request.headers.get(EMBED_RUNTIME_CAPABILITY_HEADER) ?? undefined,
    );
    if (encoded) {
      const capability = await withHostContext(() =>
        resolveAirAppEmbedCapability(encoded.id, encoded.secret, nodeId),
      );
      if (!capability) return null;
      return (fn) =>
        runWithEmbedContext(
          {
            db,
            actorId: capability.createdBy,
            spaceId: capability.spaceId,
            restrictedVisibility: capability.restrictedVisibility,
            embedTargetNodeId: capability.nodeId,
          },
          fn,
        );
    }
    if (!resolvePublicShareAuthority) return null;
    return resolvePublicShareAuthority(request, nodeId);
  };

  return async (
    request: Request,
    context: { params: Promise<{ path?: string[] }> },
  ): Promise<Response> => {
    const expectedNodeId = request.headers.get(EMBED_RUNTIME_NODE_HEADER)?.trim();
    if (!expectedNodeId) return errorResponse(404, "Embed not found");

    const withAuthority = await resolveAuthority(request, expectedNodeId);
    if (!withAuthority) return errorResponse(404, "Embed not found");

    const { path = [] } = await context.params;
    const pathname = `/${path.join("/")}`;
    if (pathname === "/_status") {
      return new Response(null, {
        status: 204,
        headers: { ...EMBED_BASE_SECURITY_HEADERS, pragma: "no-cache" },
      });
    }
    const upstream = await withoutCredentials(request, pathname);

    return withAuthority(async () => {
      const result = pathname.startsWith(rpcPrefix)
        ? await rpcHandler.handle(upstream, { context: {}, prefix: rpcPrefix })
        : await openApiHandler.handle(upstream, { context: {} });
      if (!result.matched) return errorResponse(404, "Embed data route not found");
      const headers = new Headers(result.response.headers);
      for (const [name, value] of Object.entries(EMBED_BASE_SECURITY_HEADERS)) {
        headers.set(name, value);
      }
      headers.set("pragma", "no-cache");
      return new Response(result.response.body, {
        status: result.response.status,
        statusText: result.response.statusText,
        headers,
      });
    });
  };
};
