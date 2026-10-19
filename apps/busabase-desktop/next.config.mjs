/** @type {(phase: string) => import("next").NextConfig} */
const nextConfig = (phase) => ({
  ...(phase === "phase-development-server" ? {} : { output: "export" }),
  // The window boots and embeds the live sidecar UI, so the desktop bundle
  // only needs kui for its boot screen.
  transpilePackages: ["kui"],
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  distDir: ".next",
  turbopack: {
    resolveAlias: {
      "kui/styles.css": "../../packages/kui/src/styles.css",
    },
  },
  ...(phase === "phase-development-server"
    ? {
        async rewrites() {
          return [{ source: "/index.html", destination: "/" }];
        },
      }
    : {}),
});

export default nextConfig;
