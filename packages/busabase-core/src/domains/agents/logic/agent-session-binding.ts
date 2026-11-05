import "server-only";

import { createHash } from "node:crypto";

export interface AgentSessionBindingLaunch {
  readonly slug: string;
  readonly url?: string;
  readonly authHeader?: string;
  /** Stable server-owned credential/grant identity, never returned in a VO. */
  readonly bindingRef?: string;
}

/**
 * A session pins principal/configuration identity, not a short-lived OAuth
 * access token. Local/environment credentials without a durable reference
 * deliberately change the binding when their configured secret changes.
 */
export function agentSessionBindingFingerprint(launch: AgentSessionBindingLaunch): string {
  let endpoint: string | null = null;
  if (launch.url !== undefined) {
    try {
      const url = new URL(launch.url);
      if (!["ws:", "wss:", "http:", "https:"].includes(url.protocol)) throw new Error();
      url.hash = "";
      url.searchParams.sort();
      endpoint = url.toString();
    } catch {
      // URL parser messages can contain credentials from an invalid input.
      throw new Error("The ACP endpoint binding is invalid.");
    }
  }
  const bindingRef = launch.bindingRef || null;
  const credentialHash =
    bindingRef === null
      ? createHash("sha256")
          .update(launch.authHeader ?? "")
          .digest("hex")
      : null;
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, slug: launch.slug, endpoint, bindingRef, credentialHash }))
    .digest("hex");
}
