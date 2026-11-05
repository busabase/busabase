import * as acp from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import {
  type ConnectBudaAcpInput,
  ConnectBudaAcpInputSchema,
} from "busabase-contract/domains/agents/types";
import WebSocket from "ws";
import { getBudaAcpUrl, saveBudaConnection } from "./buda-connection";

const PROBE_TIMEOUT_MS = 10_000;

/**
 * This is Buda's connection form, so tokens only go to the official endpoints
 * or the endpoint explicitly selected by the server operator. Exact matching
 * also prevents private-network probes, alternate paths, and URL credentials.
 */
export function normalizeBudaAcpEndpoint(endpoint: string, agentId: string): string {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new Error("Enter a valid Buda ACP WebSocket endpoint.");
  }
  const trusted = [
    new URL("wss://buda.im/api/acp"),
    new URL("wss://dev.buda.im/api/acp"),
    new URL(getBudaAcpUrl(agentId)),
  ];
  if (
    !["ws:", "wss:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams.keys()].some((key) => key !== "agentId") ||
    url.searchParams.getAll("agentId").length > 1 ||
    (url.searchParams.has("agentId") && url.searchParams.get("agentId") !== agentId) ||
    !trusted.some(
      (target) =>
        target.protocol === url.protocol &&
        target.host === url.host &&
        target.pathname === url.pathname,
    )
  ) {
    throw new Error(
      "Use the official Buda ACP endpoint or this deployment's configured Buda endpoint.",
    );
  }
  url.searchParams.set("agentId", agentId);
  return url.toString();
}

/** A successful WebSocket upgrade alone does not validate Buda credentials. */
async function probeBudaAcp(endpoint: string, apiToken: string): Promise<string | null> {
  let socket: WebSocket | undefined;
  // Keep the underlying socket only to bound an unfinished upgrade and ensure
  // cleanup. The official SDK still owns JSON-RPC framing and ACP lifecycle.
  class ProbeWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[], options?: WebSocket.ClientOptions) {
      super(url, protocols, {
        ...options,
        followRedirects: false,
        handshakeTimeout: PROBE_TIMEOUT_MS,
      });
      socket = this;
    }
  }
  const stream = createWebSocketStream(endpoint, {
    headers: { Authorization: `Bearer ${apiToken}` },
    cookies: "omit",
    WebSocket: ProbeWebSocket as unknown as never,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let unsupportedProtocol = false;
  try {
    const result = await Promise.race([
      acp.client({ name: "busabase" }).connectWith(stream, async (ctx) =>
        ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        }),
      ),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("timeout"));
          socket?.terminate();
        }, PROBE_TIMEOUT_MS);
      }),
    ]);
    if (result.protocolVersion !== acp.PROTOCOL_VERSION) {
      unsupportedProtocol = true;
      throw new Error("unsupported protocol");
    }
    return result.agentInfo?.title?.trim() || result.agentInfo?.name?.trim() || null;
  } catch {
    // Never expose an upstream error body: it may echo the supplied token.
    throw new Error(
      timedOut
        ? "Buda did not respond in time. Check the endpoint and try again."
        : unsupportedProtocol
          ? "Buda returned an unsupported ACP protocol version."
          : "Could not connect to Buda. Check the endpoint, agent ID, and API token.",
    );
  } finally {
    if (timer) clearTimeout(timer);
    socket?.terminate();
  }
}

export async function connectBudaAcp(input: ConnectBudaAcpInput): Promise<{ slug: string }> {
  const parsed = ConnectBudaAcpInputSchema.parse(input);
  const endpoint = normalizeBudaAcpEndpoint(parsed.endpoint, parsed.agentId);
  const agentName = (await probeBudaAcp(endpoint, parsed.apiToken)) ?? parsed.agentId;
  const slug = await saveBudaConnection({
    kind: "api-token",
    endpoint,
    accessToken: parsed.apiToken,
    agentId: parsed.agentId,
    agentName,
  });
  return { slug };
}
