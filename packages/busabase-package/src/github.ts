/**
 * GitHub source for `busabase-cli install`: parse a repo URL, fetch the ref's
 * zipball, and extract it into memory.
 *
 * Ported from buda's `apps/buda/src/domains/skills/logic/github-skill-importer.ts`
 * (buda stays as-is; a shared package is warranted only once the Phase-2 server
 * consumer actually exists). Three deliberate divergences from that original:
 *
 * 1. **Host is parsed, not pattern-matched.** buda's regex matches `github.com/…`
 *    anywhere in the string, so `https://evil.example/github.com/o/r` passes. This
 *    parses with `URL` and checks `hostname` against an allowlist.
 * 2. **Any git ref, not just branches.** buda fetches `/archive/refs/heads/<b>.zip`,
 *    which resolves branches only — tags (the package format's version scheme)
 *    would 404. This uses codeload's `/zip/<ref>`, which takes a branch, tag, or SHA.
 * 3. **Extraction is to memory with the caps applied first**, so an oversized or
 *    zip-bomb archive never reaches the disk.
 */
import { Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";
import {
  PACKAGE_MAX_FILE_BYTES,
  PACKAGE_MAX_FILE_COUNT,
  PACKAGE_MAX_TOTAL_BYTES,
} from "busabase-contract/domains/package/types";

export interface ParsedGithubUrl {
  owner: string;
  repo: string;
  /** Branch, tag, or SHA. Undefined addresses the repo's default branch. */
  ref: string | undefined;
  /** Subdirectory addressing one package inside a monorepo of packages. */
  subdir: string | undefined;
}

/** Hosts the installer may ever connect to. Also the Phase-2 server guard's allowlist. */
export const GITHUB_ALLOWED_HOSTS: readonly string[] = [
  "github.com",
  "api.github.com",
  "codeload.github.com",
];

/** Hosts accepted in a user-supplied install URL (the web UI form of a repo). */
const GITHUB_URL_HOSTS: readonly string[] = ["github.com", "www.github.com"];

export const isAllowedGithubHost = (hostname: string): boolean =>
  GITHUB_ALLOWED_HOSTS.includes(hostname.toLowerCase());

/**
 * Parse a GitHub repo URL.
 *
 * Supported forms:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/<ref>
 *   https://github.com/owner/repo/tree/<ref>/<subdir…>
 *
 * A ref containing `/` (e.g. `feature/x`) is indistinguishable from `<ref>/<subdir>`
 * in a `/tree/` URL — GitHub's own web URLs have the same ambiguity — so the first
 * segment after `/tree/` is taken as the ref and the rest as the subdir.
 */
export const parseGithubUrl = (rawUrl: string): ParsedGithubUrl => {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error(
      `Not a valid URL: "${rawUrl}". Expected a GitHub repo URL, e.g. https://github.com/acme/support-kb-template`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported URL scheme "${url.protocol}" — expected an https:// GitHub URL.`);
  }
  if (!GITHUB_URL_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new Error(
      `Not a GitHub URL: host "${url.hostname}" is not github.com. Only GitHub packages can be installed.`,
    );
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const [owner, rawRepo, marker, ref, ...rest] = segments;
  if (!owner || !rawRepo) {
    throw new Error(
      `GitHub URL is missing owner/repo: "${rawUrl}". Expected https://github.com/<owner>/<repo>[/tree/<ref>[/<subdir>]]`,
    );
  }
  const repo = rawRepo.replace(/\.git$/, "");
  if (!marker) {
    return { owner, repo, ref: undefined, subdir: undefined };
  }
  if (marker !== "tree") {
    throw new Error(
      `Unsupported GitHub URL form "/${marker}/" in "${rawUrl}". Expected https://github.com/<owner>/<repo>[/tree/<ref>[/<subdir>]]`,
    );
  }
  if (!ref) {
    throw new Error(`GitHub URL has "/tree/" but no ref: "${rawUrl}".`);
  }
  return {
    owner,
    repo,
    ref: decodeURIComponent(ref),
    subdir:
      rest.length > 0 ? rest.map((segment) => decodeURIComponent(segment)).join("/") : undefined,
  };
};

/** Encode a ref for a URL path while keeping its `/` separators (e.g. `feature/x`). */
const encodeRefPath = (ref: string): string => ref.split("/").map(encodeURIComponent).join("/");

export interface GithubDownloadOptions {
  /** Honors `GITHUB_TOKEN` for private repos. */
  githubToken?: string;
  fetcher?: typeof fetch;
}

/**
 * Download the zipball for `owner/repo` at `ref` (default branch when `ref` is
 * undefined). Tries the public codeload host first, then the authenticated API when
 * a token is available — so a private repo works iff `GITHUB_TOKEN` is set.
 */
export const downloadGithubZip = async (
  source: Pick<ParsedGithubUrl, "owner" | "repo" | "ref">,
  options: GithubDownloadOptions = {},
): Promise<Buffer> => {
  const fetcher = options.fetcher ?? fetch;
  const { owner, repo, ref } = source;
  const slug = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const label = `${owner}/${repo}${ref ? `@${ref}` : ""}`;

  const publicUrl = `https://codeload.github.com/${slug}/zip/${ref ? encodeRefPath(ref) : "HEAD"}`;
  assertAllowedUrl(publicUrl);
  const publicResponse = await fetcher(publicUrl);
  if (publicResponse.ok) return Buffer.from(await publicResponse.arrayBuffer());

  if (!options.githubToken) {
    throw new Error(
      publicResponse.status === 404
        ? `GitHub repo or ref not found: ${label} (HTTP 404).\n  • Check the URL, and that the branch/tag exists.\n  • Private repo? Set GITHUB_TOKEN=<a token with repo read access> and re-run.`
        : `Failed to download ${label} from GitHub (HTTP ${publicResponse.status} ${publicResponse.statusText}).`,
    );
  }

  const apiUrl = `https://api.github.com/repos/${slug}/zipball${ref ? `/${encodeRefPath(ref)}` : ""}`;
  assertAllowedUrl(apiUrl);
  const authedResponse = await fetcher(apiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${options.githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (authedResponse.ok) return Buffer.from(await authedResponse.arrayBuffer());
  if (authedResponse.status === 401 || authedResponse.status === 403) {
    throw new Error(
      `GitHub rejected GITHUB_TOKEN for ${label} (HTTP ${authedResponse.status}). The token is invalid, expired, or lacks read access to this repo.`,
    );
  }
  throw new Error(
    `GitHub repo or ref not found: ${label} (HTTP ${authedResponse.status}), even with GITHUB_TOKEN. Check the owner, repo, and ref.`,
  );
};

/** SSRF guard: refuse anything off the GitHub allowlist before a connection is made. */
export const assertAllowedUrl = (rawUrl: string): void => {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !isAllowedGithubHost(url.hostname)) {
    throw new Error(
      `Refusing to fetch ${rawUrl} — only https on ${GITHUB_ALLOWED_HOSTS.join(", ")} is allowed.`,
    );
  }
};

/**
 * Zip-slip guard. Normalizes an archive entry path to a repo-relative path and
 * rejects anything that could escape the extraction root: `..`/`.` segments,
 * and Windows drive prefixes. A leading `/` is stripped rather than rejected —
 * that makes the path relative, which is already safe.
 */
export const normalizeArchivePath = (value: string): string => {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    segments.some((segment) => segment === "." || segment === ".." || /^[a-zA-Z]:$/.test(segment))
  ) {
    throw new Error(`Unsafe archive path rejected: ${value}`);
  }
  return normalized;
};

export interface ExtractZipOptions {
  /** Only extract this repo-relative subdirectory, and strip it from the keys. */
  subdir?: string;
  maxFiles?: number;
  maxTotalBytes?: number;
  maxFileBytes?: number;
}

/**
 * Extract a GitHub zipball into memory, keyed by repo-relative path (the archive's
 * single generated root directory — `owner-repo-<sha>/` — is stripped).
 *
 * Caps are enforced against the archive's declared entry sizes BEFORE any bytes are
 * read, so an oversized archive or zip bomb is refused up front and nothing is ever
 * written to disk.
 */
export const extractZip = async (
  zipBuffer: Buffer,
  options: ExtractZipOptions = {},
): Promise<Map<string, Buffer>> => {
  const maxFiles = options.maxFiles ?? PACKAGE_MAX_FILE_COUNT;
  const maxTotalBytes = options.maxTotalBytes ?? PACKAGE_MAX_TOTAL_BYTES;
  const maxFileBytes = options.maxFileBytes ?? PACKAGE_MAX_FILE_BYTES;

  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(zipBuffer)));
  try {
    const entries = await reader.getEntries();
    const files = entries.filter((entry) => !entry.directory);
    const archiveRoot = files[0]?.filename.split("/")[0];
    if (!archiveRoot) throw new Error("The downloaded repository archive is empty.");

    const subdir = options.subdir ? normalizeArchivePath(options.subdir) : undefined;
    const prefix = `${archiveRoot}/${subdir ? `${subdir}/` : ""}`;

    // Validate every entry path first: a zip-slip entry must be refused even if it
    // sits outside the addressed subdir.
    for (const entry of files) normalizeArchivePath(entry.filename);

    const selected = files.filter((entry) => entry.filename.startsWith(prefix));
    if (selected.length > maxFiles) {
      throw new Error(
        `Package has ${selected.length} files, above the ${maxFiles}-file limit. Nothing was installed.`,
      );
    }

    let totalBytes = 0;
    for (const entry of selected) {
      const size = entry.uncompressedSize ?? 0;
      const relativePath = entry.filename.slice(prefix.length);
      if (size > maxFileBytes) {
        throw new Error(
          `File "${relativePath}" is ${formatBytes(size)}, above the ${formatBytes(maxFileBytes)} per-file limit. Nothing was installed.`,
        );
      }
      totalBytes += size;
      if (totalBytes > maxTotalBytes) {
        throw new Error(
          `Package unpacks to more than the ${formatBytes(maxTotalBytes)} total limit. Nothing was installed.`,
        );
      }
    }

    const result = new Map<string, Buffer>();
    for (const entry of selected) {
      const relativePath = normalizeArchivePath(entry.filename.slice(prefix.length));
      // A zip entry always has a reader unless the archive is malformed.
      if (!entry.getData) continue;
      const data = await entry.arrayBuffer();
      result.set(relativePath, Buffer.from(data));
    }
    return result;
  } finally {
    await reader.close();
  }
};

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))}MB` : `${Math.round(bytes / 1024)}KB`;

/** Parse, fetch, and extract in one step — the `install` command's entry point. */
export const fetchGithubPackageFiles = async (
  repoUrl: string,
  options: GithubDownloadOptions = {},
): Promise<{ source: ParsedGithubUrl; files: Map<string, Buffer> }> => {
  const source = parseGithubUrl(repoUrl);
  const zipBuffer = await downloadGithubZip(source, options);
  const files = await extractZip(zipBuffer, { subdir: source.subdir });
  return { source, files };
};
