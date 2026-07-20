/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: ["busabase-cms", "busabase-sdk"],
  turbopack: {
    resolveAlias: {
      "busabase-sdk": "../../apps/busabase-sdk/dist/index.js",
    },
  },
};

export default config;
