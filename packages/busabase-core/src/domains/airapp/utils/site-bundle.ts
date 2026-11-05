/**
 * Turns an AirApp's file tree into what the `site` engine uploads: one Worker
 * module plus static assets. There is deliberately no build step on the server,
 * so a site's Worker entry must already be a single bundled ES module.
 *
 * An app opts in by declaring `site` in `airapp.json`. Without that explicit
 * step, an ordinary Node AirApp with a `public/` folder would deploy as a static
 * site and silently lose its server.
 *
 * Imports are read with a real ES module lexer rather than a pattern match,
 * because page HTML embedded in a Worker routinely contains the word `import`.
 *
 * PURITY: isomorphic, so the same check can run before a person clicks Go live
 * and again on the server when the upload is prepared.
 */

import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import { init, parse } from "es-module-lexer";
import { AIRAPP_MANIFEST_PATH } from "./airapp-runtime-descriptor";

const DEFAULT_COMPATIBILITY_DATE = "2026-06-04";
const DEFAULT_ASSETS_DIR = "public";
/** Cloudflare's limits for static assets on a paid Workers account. */
export const SITE_MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_ASSET_COUNT = 100_000;

/** Serves static assets only, for a site that declares no Worker entry. */
export const ASSETS_ONLY_WORKER = `export default {
  fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
`;

const NOT_FOUND_HANDLING = ["single-page-application", "404-page", "none"] as const;
export type SiteNotFoundHandling = (typeof NOT_FOUND_HANDLING)[number];

/**
 * The level of the API key a published site's Worker is given (`site.access`).
 * `manage` is not on offer: a website has no business changing who can see what,
 * or the space's settings. Reading is the default, so a site that only shows
 * data never holds a key that could change it.
 */
const SITE_ACCESS_LEVELS = ["read", "changeRequest", "write"] as const satisfies readonly Exclude<
  ApiKeyPermissionLevel,
  "manage"
>[];
export type SiteAccessLevel = (typeof SITE_ACCESS_LEVELS)[number];
const DEFAULT_SITE_ACCESS: SiteAccessLevel = "read";

const CONTENT_TYPES: Record<string, string> = {
  avif: "image/avif",
  css: "text/css; charset=utf-8",
  gif: "image/gif",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  webm: "video/webm",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xml: "application/xml; charset=utf-8",
};

export const siteAssetContentType = (path: string): string =>
  CONTENT_TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export interface SiteBundleInputFile {
  path: string;
  content: string | Uint8Array;
  /**
   * The file's stored size, when a caller left `content` empty because the file
   * is already too large to be worth reading into memory.
   */
  knownSize?: number;
}

export interface SiteBundleAsset {
  /** Absolute within the site: Cloudflare's manifest keys start with `/`. */
  path: string;
  content: Uint8Array;
  size: number;
  contentType: string;
}

export interface SiteBundle {
  workerCode: string;
  assets: SiteBundleAsset[];
  compatibilityDate: string;
  notFoundHandling: SiteNotFoundHandling;
  /** What the site's API key may do. Part of the version: changing it means a new upload. */
  access: SiteAccessLevel;
}

/** Why an app cannot go live. The UI words these; tests pin the codes. */
export type SiteBundleBlocker =
  | { code: "not-a-site-app" }
  | { code: "invalid-manifest"; detail: string }
  | { code: "python-runtime" }
  | { code: "unsafe-path"; path: string }
  | { code: "entry-missing"; path: string }
  | { code: "entry-not-javascript"; path: string }
  | { code: "entry-syntax-error"; path: string; detail: string }
  | { code: "entry-no-default-export"; path: string }
  | { code: "unsupported-import"; path: string; specifier: string }
  | { code: "no-index-page"; path: string }
  | { code: "asset-too-large"; path: string; size: number }
  | { code: "too-many-assets"; count: number };

export type SiteBundleResult =
  | { ok: true; bundle: SiteBundle }
  | { ok: false; blockers: SiteBundleBlocker[] };

interface SiteDeclaration {
  entry: string | null;
  assets: string;
  compatibilityDate: string;
  notFoundHandling: SiteNotFoundHandling;
  access: SiteAccessLevel;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toText = (content: string | Uint8Array): string =>
  typeof content === "string" ? content : decoder.decode(content);
const toBytes = (content: string | Uint8Array): Uint8Array =>
  typeof content === "string" ? encoder.encode(content) : content;

/** Normalizes a declared path, or returns null if it could leave the app's tree. */
const safeRelativePath = (value: string): string | null => {
  const trimmed = value
    .trim()
    .replace(/^\.?\/+/, "")
    .replace(/\/+$/, "");
  if (!trimmed || trimmed.includes("\0") || trimmed.includes("\\")) return null;
  const segments = trimmed.split("/");
  return segments.some((segment) => segment === "." || segment === ".." || segment === "")
    ? null
    : trimmed;
};

const readDeclaration = (
  files: Map<string, string | Uint8Array>,
): { declaration: SiteDeclaration } | { blockers: SiteBundleBlocker[] } => {
  const raw = files.get(AIRAPP_MANIFEST_PATH);
  if (raw === undefined) return { blockers: [{ code: "not-a-site-app" }] };

  let manifest: unknown;
  try {
    manifest = JSON.parse(toText(raw));
  } catch {
    return { blockers: [{ code: "invalid-manifest", detail: "airapp.json is not valid JSON" }] };
  }
  if (typeof manifest !== "object" || manifest === null) {
    return { blockers: [{ code: "invalid-manifest", detail: "airapp.json must be an object" }] };
  }

  const { runtime, site } = manifest as { runtime?: unknown; site?: unknown };
  if (site === undefined) return { blockers: [{ code: "not-a-site-app" }] };
  if (runtime === "python") return { blockers: [{ code: "python-runtime" }] };
  if (typeof site !== "object" || site === null) {
    return { blockers: [{ code: "invalid-manifest", detail: "`site` must be an object" }] };
  }

  const { entry, assets, compatibilityDate, notFoundHandling, access } = site as Record<
    string,
    unknown
  >;
  for (const [field, value] of Object.entries({ entry, assets, compatibilityDate })) {
    if (value !== undefined && typeof value !== "string") {
      return {
        blockers: [{ code: "invalid-manifest", detail: `\`site.${field}\` must be a string` }],
      };
    }
  }
  if (
    notFoundHandling !== undefined &&
    !NOT_FOUND_HANDLING.includes(notFoundHandling as SiteNotFoundHandling)
  ) {
    return {
      blockers: [
        {
          code: "invalid-manifest",
          detail: `\`site.notFoundHandling\` must be one of ${NOT_FOUND_HANDLING.join(", ")}`,
        },
      ],
    };
  }

  if (access !== undefined && !SITE_ACCESS_LEVELS.includes(access as SiteAccessLevel)) {
    return {
      blockers: [
        {
          code: "invalid-manifest",
          detail: `\`site.access\` must be one of ${SITE_ACCESS_LEVELS.join(", ")}`,
        },
      ],
    };
  }

  const entryPath = entry === undefined ? null : safeRelativePath(entry as string);
  if (entry !== undefined && entryPath === null) {
    return { blockers: [{ code: "unsafe-path", path: entry as string }] };
  }
  const assetsDir = assets === undefined ? DEFAULT_ASSETS_DIR : safeRelativePath(assets as string);
  if (assetsDir === null) return { blockers: [{ code: "unsafe-path", path: assets as string }] };

  return {
    declaration: {
      entry: entryPath,
      assets: assetsDir,
      compatibilityDate: (compatibilityDate as string | undefined) ?? DEFAULT_COMPATIBILITY_DATE,
      notFoundHandling: (notFoundHandling as SiteNotFoundHandling | undefined) ?? "404-page",
      access: (access as SiteAccessLevel | undefined) ?? DEFAULT_SITE_ACCESS,
    },
  };
};

const checkWorkerEntry = async (path: string, code: string): Promise<SiteBundleBlocker[]> => {
  await init;
  try {
    const [imports, exports] = parse(code);
    const blockers: SiteBundleBlocker[] = [];
    for (const specifier of imports) {
      // `n` is undefined for a computed `import(x)`, which Workers cannot load
      // from a single uploaded module either.
      const name = specifier.n;
      if (!name?.startsWith("cloudflare:")) {
        blockers.push({
          code: "unsupported-import",
          path,
          specifier: name ?? code.slice(specifier.ss, specifier.se),
        });
      }
    }
    if (!exports.some((item) => item.n === "default")) {
      blockers.push({ code: "entry-no-default-export", path });
    }
    return blockers;
  } catch (error) {
    return [
      {
        code: "entry-syntax-error",
        path,
        detail: error instanceof Error ? error.message : String(error),
      },
    ];
  }
};

/**
 * Which of an app's files `resolveSiteBundle` will look at, so a server can read
 * only those: an app's tree may hold data or sources that never deploy.
 */
export const selectSiteSourcePaths = (
  rawManifest: string | undefined,
  paths: readonly string[],
): string[] => {
  if (rawManifest === undefined) return [];
  const read = readDeclaration(new Map([[AIRAPP_MANIFEST_PATH, rawManifest]]));
  if ("blockers" in read) return [];
  const { entry, assets } = read.declaration;
  return paths.filter((path) => path === entry || path.startsWith(`${assets}/`));
};

/**
 * Names one exact deployable version: the same bytes always hash the same, and
 * any change to what would be served changes it, as does a change to what its key
 * may do. Files that never deploy do not count, so editing a README leaves a
 * preview current.
 */
export const computeSiteVersion = async (bundle: SiteBundle): Promise<string> => {
  const digest = async (bytes: Uint8Array): Promise<string> =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const assets = await Promise.all(
    [...bundle.assets]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map(async (asset) => [asset.path, asset.contentType, await digest(asset.content)]),
  );
  const fingerprint = JSON.stringify({
    worker: bundle.workerCode,
    compatibilityDate: bundle.compatibilityDate,
    notFoundHandling: bundle.notFoundHandling,
    access: bundle.access,
    assets,
  });
  return (await digest(encoder.encode(fingerprint))).slice(0, 32);
};

export const resolveSiteBundle = async (
  input: readonly SiteBundleInputFile[],
): Promise<SiteBundleResult> => {
  const files = new Map(input.map((file) => [file.path, file.content]));
  const sizes = new Map(
    input.flatMap((file) =>
      file.knownSize === undefined ? [] : [[file.path, file.knownSize] as const],
    ),
  );
  const read = readDeclaration(files);
  if ("blockers" in read) return { ok: false, blockers: read.blockers };
  const { declaration } = read;

  const blockers: SiteBundleBlocker[] = [];
  let workerCode = ASSETS_ONLY_WORKER;

  if (declaration.entry) {
    const raw = files.get(declaration.entry);
    if (raw === undefined) {
      blockers.push({ code: "entry-missing", path: declaration.entry });
    } else if (!/\.m?js$/i.test(declaration.entry)) {
      blockers.push({ code: "entry-not-javascript", path: declaration.entry });
    } else {
      workerCode = toText(raw);
      blockers.push(...(await checkWorkerEntry(declaration.entry, workerCode)));
    }
  }

  const prefix = `${declaration.assets}/`;
  const assets: SiteBundleAsset[] = [];
  for (const [path, content] of files) {
    if (!path.startsWith(prefix)) continue;
    const bytes = toBytes(content);
    const size = sizes.get(path) ?? bytes.byteLength;
    if (size > SITE_MAX_ASSET_BYTES) {
      blockers.push({ code: "asset-too-large", path, size });
      continue;
    }
    assets.push({
      path: `/${path.slice(prefix.length)}`,
      content: bytes,
      size: bytes.byteLength,
      contentType: siteAssetContentType(path),
    });
  }
  if (assets.length > MAX_ASSET_COUNT) {
    blockers.push({ code: "too-many-assets", count: assets.length });
  }
  // A Worker can answer `/` itself; a static-only site has nothing else to serve.
  if (!declaration.entry && !assets.some((asset) => asset.path === "/index.html")) {
    blockers.push({ code: "no-index-page", path: `${prefix}index.html` });
  }

  if (blockers.length > 0) return { ok: false, blockers };
  return {
    ok: true,
    bundle: {
      workerCode,
      assets,
      compatibilityDate: declaration.compatibilityDate,
      notFoundHandling: declaration.notFoundHandling,
      access: declaration.access,
    },
  };
};
