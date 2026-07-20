import "server-only";

import { ORPCError } from "@orpc/server";
import {
  fetchGithubPackageFiles,
  GITHUB_ALLOWED_HOSTS,
  isAllowedGithubHost,
  type ParsedGithubUrl,
  parseGithubUrl,
} from "busabase-package/github";
import { checkUrlIsSafeToFetch } from "../../webhook/logic/ssrf-guard";

/**
 * Server-side GitHub source: the same fetch the CLI does, behind BOTH guards.
 *
 * Spec §9 names the trap explicitly — buda's own GitHub importers fetch without
 * the SSRF guard, relying on the host pattern alone. Do not copy that. The two
 * guards defend against different things and neither subsumes the other:
 *
 *   • the **host allowlist** answers "is this GitHub?" — it stops the caller from
 *     naming an arbitrary destination in the first place;
 *   • **checkUrlIsSafeToFetch** answers "where does that name actually resolve?"
 *     — it stops a DNS answer pointing at loopback, RFC1918, or the cloud
 *     metadata IP (169.254.169.254). An allowlist alone is blind to that, because
 *     it never leaves the string.
 *
 * Every outbound request passes through {@link guardedFetch}, which re-checks the
 * URL it is actually handed rather than trusting a check done once up front —
 * `downloadGithubZip` has two call sites (public codeload, then the
 * token-authenticated API), and a future third must not be able to slip past.
 *
 * Known boundary: `fetch` follows redirects internally, so an intermediate hop is
 * not re-checked here. That is acceptable in this specific shape — the URLs are
 * constructed by us from a parsed `owner`/`repo`, never supplied by the caller,
 * so a redirect off the allowlist would require GitHub itself to be the
 * redirector. Blocking redirects outright would break private-repo installs,
 * where `api.github.com/…/zipball` legitimately redirects to a download host.
 */

/** DNS-level SSRF check + GitHub host allowlist, applied to one concrete URL. */
export const assertUrlIsFetchable = async (rawUrl: string): Promise<void> => {
  let hostname: string;
  let protocol: string;
  try {
    ({ hostname, protocol } = new URL(rawUrl));
  } catch {
    throw new ORPCError("BAD_REQUEST", { message: `Not a valid URL: "${rawUrl}".` });
  }
  if (protocol !== "https:" || !isAllowedGithubHost(hostname)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Refusing to fetch ${rawUrl} — only https on ${GITHUB_ALLOWED_HOSTS.join(", ")} is allowed.`,
    });
  }
  const { blocked, reason } = await checkUrlIsSafeToFetch(rawUrl);
  if (blocked) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Refusing to fetch ${rawUrl} — ${reason ?? "blocked by the SSRF guard"}.`,
    });
  }
};

const guardedFetch: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : new Request(input).url;
  await assertUrlIsFetchable(url);
  return fetch(input, init);
};

/**
 * Parse the caller's URL and refuse it before any network I/O if it is not a
 * GitHub package URL that resolves somewhere safe. Separated from the download so
 * the refusal is provably "before any fetch", which is what the security test
 * asserts.
 */
export const resolveGithubSource = async (repoUrl: string): Promise<ParsedGithubUrl> => {
  let source: ParsedGithubUrl;
  try {
    source = parseGithubUrl(repoUrl);
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      message: error instanceof Error ? error.message : `Not a GitHub URL: "${repoUrl}".`,
    });
  }
  await assertUrlIsFetchable(
    `https://codeload.github.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/zip/HEAD`,
  );
  return source;
};

/**
 * `GITHUB_TOKEN` for private repos comes from the SERVER env, deliberately. A
 * per-user GitHub credential would need new user-facing secret storage (and, done
 * properly, a real GitHub App) — that is a later phase, not something to improvise
 * with a token field on a form.
 */
const serverGithubToken = (): string | undefined => process.env.GITHUB_TOKEN || undefined;

/** Fetch + extract a package's files, with both guards applied to every request. */
export const fetchPackageFiles = async (
  repoUrl: string,
): Promise<{ source: ParsedGithubUrl; files: Map<string, Buffer> }> => {
  await resolveGithubSource(repoUrl);
  try {
    return await fetchGithubPackageFiles(repoUrl, {
      githubToken: serverGithubToken(),
      fetcher: guardedFetch,
    });
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    // Download / unzip / cap failures are all "the caller named a bad package",
    // not server faults — report them as such, with the original wording.
    throw new ORPCError("BAD_REQUEST", {
      message: error instanceof Error ? error.message : "Failed to download the package.",
    });
  }
};
