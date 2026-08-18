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
 * **`Sec-Fetch-Site` is the entire guard, deliberately — `Origin` is not
 * checked.** A browser always sends `Sec-Fetch-Site` and page JavaScript cannot
 * forge it (it is a forbidden header name), so against the threat this exists
 * for — a page the user happens to visit POSTing to `http://localhost:<port>` —
 * it is both necessary and sufficient. Adding an `Origin` comparison on top
 * catches nothing further: any caller able to forge `Origin` is not a browser
 * page, and is therefore already outside what this can or should stop.
 *
 * What that extra check *did* do was break the feature's headline capability.
 * A Cloud user driving their laptop's agent sends a same-origin request to
 * Cloud, and `buildRelayHeaders` forwards every header verbatim down the
 * tunnel — so the request arriving at OSS carries `Origin:
 * https://<cloud-host>` against an OSS host of `localhost:<port>`, and was
 * rejected with a 403. An earlier version of this comment asserted the relay
 * "sends neither header"; measured against a real tunnel (2026-08-17), it
 * forwards both, and the whole Cloud → tunnel → agents path was dead. The
 * forwarded `Sec-Fetch-Site: same-origin` is exactly the right verdict to
 * honour here: a real browser did make this request, from the site it belongs
 * to.
 *
 * Non-browser callers (curl, our own server-side code) send no
 * `Sec-Fetch-Site` and pass — unchanged, and not the threat model.
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

  return { allowed: true };
}
