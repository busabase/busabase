/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  reactCompiler: true,
  output: "standalone",
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
};

export default config;
