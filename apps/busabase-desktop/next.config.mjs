/** @type {(phase: string) => import("next").NextConfig} */
const nextConfig = (phase) => ({
  output: "export",
  // The window is a thin launcher that boots the sidecar then navigates to the
  // live Busabase web app (the sidecar serves the full UI), so the desktop bundle
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
