import { resolve } from "node:path";
import { defineConfig } from "tsup";

// The CLI is a thin terminal layer over busabase-sdk (the shared, published client
// library). busabase-sdk + commander + zod + @zip.js/zip.js are real runtime
// dependencies, so they stay external — tsup only bundles this package's own `src`.
//
// The exception is busabase-contract and busabase-package (and the workspace packages
// they import): like busabase-sdk, those ship TypeScript source (their package exports
// point at `./src/*.ts`), so they can never be runtime dependencies of a published npm
// package. The package-format zod schemas (`busabase-contract/domains/package/types`)
// and the `busabase-package@1` implementation itself are pure Node, so bundle them
// straight into dist instead — same pattern and same reasoning as
// apps/busabase-sdk/tsup.config.ts.
export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  dts: false,
  noExternal: [/^busabase-contract/, /^busabase-package/, /^open-domains/, /^openlib/],
  esbuildOptions(options) {
    // Bundled workspace packages import each other through package export paths.
    // Resolve bare imports from known workspace symlink locations so esbuild can
    // find them even before a fresh install recreates every link.
    options.nodePaths = [
      resolve(process.cwd(), "node_modules"),
      resolve(process.cwd(), "../../packages/busabase-contract/node_modules"),
      resolve(process.cwd(), "../../packages/busabase-package/node_modules"),
      resolve(process.cwd(), "../../packages/open-domains/node_modules"),
    ];
  },
});
