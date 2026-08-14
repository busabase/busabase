import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "tsup";

// busabase-contract / open-domains / openlib ship TypeScript source (their package
// exports point at `./src/*.ts`), so they cannot be runtime dependencies of a
// published npm SDK. Bundle the (pure, isomorphic) oRPC contract + VO types
// straight into dist instead — the SDK then has zero workspace deps and installs
// standalone. zod + @orpc/* stay external (real runtime dependencies).
//
// Unlike busabase-cli (a binary, `dts: false`), the SDK is a *library*: emit type
// declarations so external TypeScript consumers get full autocomplete over the
// bundled VO/DTO graph.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    oauth: "src/oauth.ts",
    "oauth-node": "src/oauth-node.ts",
    "airapp-node": "src/airapp-node.ts",
    airapp: "src/airapp.ts",
    "airapp-gate": "src/airapp-gate.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "neutral",
  outDir: "dist",
  clean: true,
  // `resolve` inlines the workspace types into dist/index.d.ts — without it the
  // declarations keep external `import … from "busabase-contract/*"` re-exports,
  // which consumers can't resolve (busabase-contract is private, never published).
  // zod / @orpc/* are NOT listed here, so they stay external (real runtime deps).
  dts: { resolve: true },
  treeshake: true,
  noExternal: [/^busabase-contract/, /^open-domains/, /^openlib/],
  // The gate's default stylesheet is plain CSS with no build step of its own —
  // copy it beside the JS so `busabase-sdk/airapp-gate.css` resolves under the
  // same dist-only `files` allowlist as everything else.
  async onSuccess() {
    await mkdir("dist", { recursive: true });
    await copyFile("src/airapp-gate.css", "dist/airapp-gate.css");
  },
  esbuildOptions(options) {
    // Bundled workspace packages import each other through package export paths.
    // Resolve bare imports from known workspace symlink locations so esbuild can
    // find them even before a fresh install recreates every link.
    options.nodePaths = [
      resolve(process.cwd(), "node_modules"),
      resolve(process.cwd(), "../../packages/busabase-contract/node_modules"),
      resolve(process.cwd(), "../../packages/open-domains/node_modules"),
    ];
  },
});
