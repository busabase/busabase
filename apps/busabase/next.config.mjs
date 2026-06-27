/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  reactCompiler: true,
  output: "standalone",
  devIndicators: false,
  serverExternalPackages: ["@electric-sql/pglite"],
  allowedDevOrigins: ["hkt1.bika.ltd"],
  transpilePackages: ["busabase-core"],
};

export default config;
