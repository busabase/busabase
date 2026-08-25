import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const PRODUCTION_AIRAPP_EMBED_ORIGINS = ["https://dev.buda.im", "https://buda.im"];

const normalizeEmbedOrigin = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid BUSABASE_AIRAPP_EMBED_ORIGINS origin: ${value}`);
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `BUSABASE_AIRAPP_EMBED_ORIGINS entries must be exact http(s) origins: ${value}`,
    );
  }

  return url.origin;
};

export const resolveAirAppEmbedOrigins = ({
  configuredOrigins = process.env.BUSABASE_AIRAPP_EMBED_ORIGINS,
  nodeEnv = process.env.NODE_ENV,
} = {}) => {
  const configured = configuredOrigins
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const defaults =
    nodeEnv === "production"
      ? PRODUCTION_AIRAPP_EMBED_ORIGINS
      : [...PRODUCTION_AIRAPP_EMBED_ORIGINS, "http://localhost:3040"];

  return [...new Set((configured?.length ? configured : defaults).map(normalizeEmbedOrigin))];
};

// Nodepod (the in-browser Node runtime behind the AirApp Run panel) lazy-loads
// WASM tools it doesn't bundle — esbuild-wasm from esm.sh, wa-sqlite and
// brotli-wasm from jsdelivr — the moment a Vite/SQLite AirApp actually runs.
// Without these two origins in script-src, esbuild's WASM init throws
// (`Cannot destructure property 'createServer'`) before the dev server binds
// a port; verified against a real vite@7.3.1 AirApp both failing with these
// origins absent and succeeding once they're allowed.
const NODEPOD_TOOL_CDN_ORIGINS = ["https://esm.sh", "https://cdn.jsdelivr.net"];

export const createAirAppContentSecurityPolicy = (embedOrigins) =>
  [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${NODEPOD_TOOL_CDN_ORIGINS.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http: https:",
    "font-src 'self' data: blob: http: https:",
    "connect-src 'self' http: https: ws: wss:",
    "frame-src 'self' blob: http: https:",
    "worker-src 'self' blob:",
    `frame-ancestors ${embedOrigins.join(" ")}`,
  ].join("; ");

const airAppSecurityHeaders = [
  {
    key: "Cache-Control",
    value: "private, no-store, max-age=0",
  },
  {
    key: "Referrer-Policy",
    value: "no-referrer",
  },
  // Cross-origin isolation for Nodepod's SharedArrayBuffer path (threaded WASI
  // modules, lean worker snapshots, sync child-process APIs). `credentialless`
  // per Nodepod's own docs recommendation — it's what Nodepod's own preview
  // responses use, and unlike `require-corp` it doesn't need the esm.sh/
  // jsdelivr CDN responses above to send their own CORP header.
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "Cross-Origin-Embedder-Policy",
    value: "credentialless",
  },
  {
    key: "Content-Security-Policy",
    value: createAirAppContentSecurityPolicy(resolveAirAppEmbedOrigins()),
  },
];

// The Change Request preview embed is loaded cross-origin inside Busabase's
// review UI (any origin, since reviewers can be on any Buda tenant domain).
// It must stay out of the CSP/search index and never be cached, but — unlike
// the AirApp routes above — it deliberately omits X-Frame-Options so the
// wildcard frame-ancestors CSP directive is the only framing control in play.
export const changeRequestPreviewHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors *",
  },
  {
    key: "Cache-Control",
    value: "private, no-store, max-age=0",
  },
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow",
  },
];

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  reactCompiler: true,
  experimental: {
    // Prevent header-based RSC responses from sharing a URL cache key with HTML.
    validateRSCRequestHeaders: true,
  },
  turbopack: {
    root: monorepoRoot,
  },
  output: "standalone",
  // The desktop build restores src-tauri/target before building this sidecar.
  // It is build state, not a runtime dependency, and can contain prior bundles.
  outputFileTracingExcludes: {
    "/*": ["../busabase-desktop/**/*"],
  },
  devIndicators: false,
  // Opt large/native packages out of bundling so Next leaves them as plain
  // `require(...)` resolved from node_modules at runtime. Without this, Next
  // rewrites the import to a hashed external id that the standalone server
  // cannot resolve (the @aws-sdk dir on disk has no hash) → "Failed to load
  // external module" 500s on any storage/DB path. Mirrors pglite.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ],
  allowedDevOrigins: ["hkt1.bika.ltd"],
  transpilePackages: ["busabase-contract", "busabase-core"],
  async headers() {
    return [
      {
        source: "/dashboard/:spaceId/airapp/:path*",
        headers: airAppSecurityHeaders,
      },
      {
        source: "/dashboard/airapp/:path*",
        headers: airAppSecurityHeaders,
      },
      {
        source: "/embed/change-request/:path*",
        headers: changeRequestPreviewHeaders,
      },
    ];
  },
};

export default config;
