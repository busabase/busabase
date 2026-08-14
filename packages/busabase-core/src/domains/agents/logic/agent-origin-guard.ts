/**
 * Cross-origin guard for the `agents.*` procedures.
 *
 * OSS's `/api/rpc` is intentionally unauthenticated (the Local↔Cloud Tunnel
 * treats the tunnel as the trust boundary) and answers with
 * `Access-Control-Allow-Origin: *`. For read/write of the user's own local data
 * that is the accepted, pre-existing posture. For procedures that **start
 * processes** it is not: without this guard, any page a user visits could POST
 * to `http://localhost:<port>/api/rpc` and run programs on their machine.
 *
 * The catalog allowlist (`agent-catalog.ts`) already means only vetted, pinned
 * packages can be launched — a drive-by cannot choose the command. This adds the
 * second half: a drive-by cannot reach these procedures at all.
 *
 * Deliberately narrow: it guards `agents.*` only, and does not touch the CORS
 * policy other endpoints (including the tunnel) depend on. Widening that policy
 * is a separate change with its own regression pass — see spec §8.0.
 */

/** Request paths that carry an `agents.*` RPC call. */
const AGENTS_PATH = /\/agents\//;

export interface OriginGuardVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * Same-origin (or non-browser) requests pass; a request a *browser* made from a
 * different site does not.
 *
 * `Sec-Fetch-Site` is the reliable signal here because a browser sets it and a
 * page cannot forge it. Non-browser callers (curl, the tunnel relay, our own
 * server-side code) send neither header and are allowed through — they are not
 * the threat this addresses, and blocking them would break the tunnel path.
 */
export function checkAgentsRequestOrigin(request: Request): OriginGuardVerdict {
  const url = new URL(request.url);
  if (!AGENTS_PATH.test(url.pathname)) return { allowed: true };

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return {
      allowed: false,
      reason:
        "Agent procedures cannot be called from another site. Open Busabase directly and try again.",
    };
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== url.host) {
        return {
          allowed: false,
          reason:
            "Agent procedures cannot be called from another site. Open Busabase directly and try again.",
        };
      }
    } catch {
      return { allowed: false, reason: "Malformed Origin header." };
    }
  }

  return { allowed: true };
}
