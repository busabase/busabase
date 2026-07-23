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

export const createAirAppContentSecurityPolicy = (embedOrigins) =>
  [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
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
  {
    key: "Content-Security-Policy",
    value: createAirAppContentSecurityPolicy(resolveAirAppEmbedOrigins()),
  },
];

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  reactCompiler: true,
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
    ];
  },
};

export default config;
