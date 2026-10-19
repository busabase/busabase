/**
 * Server-side configuration for the "Connect via ACPRouter" OAuth flow's
 * target — the ACPRouter Cloud deployment this Busabase instance redirects
 * the user to for consent (tasks.md 7.4).
 *
 * Mirrors `apps/acprouter-cloud/src/lib/server-origin.ts`'s
 * `resolveOAuthRedirectOrigin` exactly: bare-origin-only (no path, query,
 * credentials, or fragment — a configured value carrying any of those is
 * rejected outright rather than silently stripped, since silently stripping
 * could mask a misconfiguration), and fails closed outside development
 * when unset. Unlike that sibling, there is no request-derived fallback at
 * all (not even in development's non-throwing branch) — ACPRouter is always
 * a separate deployment from Busabase, so there is no inbound request whose
 * origin could ever stand in for it the way a same-app request's Host can.
 */

const ENV_KEY = "ACPROUTER_ENROLLMENT_ORIGIN";

type OriginEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Resolve the configured ACPRouter origin this Busabase deployment should
 * send users to for the Connect-via-ACPRouter OAuth flow.
 *
 * Throws outside `NODE_ENV=development` when unset or malformed — a silent
 * fallback here would mean the OAuth `redirect_uri`/authorize URL point
 * somewhere unintended, which is exactly the class of mistake this fails
 * closed on, same as its ACPRouter-side counterpart.
 */
export function resolveAcprouterEnrollmentOrigin(
  environment: OriginEnvironment = process.env,
): string {
  const raw = environment[ENV_KEY]?.trim();

  if (!raw) {
    if (environment.NODE_ENV === "development") {
      throw new Error(
        `${ENV_KEY} must be set, even in development, to use the Connect via ACPRouter flow (there is no same-app request to fall back to).`,
      );
    }
    throw new Error(`${ENV_KEY} must be set for the Connect via ACPRouter flow.`);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${ENV_KEY} must be an absolute HTTP(S) URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${ENV_KEY} must use http:// or https://.`);
  }
  if (
    url.protocol !== "https:" &&
    !(
      environment.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  ) {
    throw new Error(`${ENV_KEY} must use HTTPS outside local development.`);
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${ENV_KEY} must contain only an origin.`);
  }

  return url.origin;
}
