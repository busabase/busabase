import { defineConfig } from "tsdown";

// The CLI is a thin terminal layer over busabase-sdk (the shared, published client
// library). busabase-sdk + commander + zod + @zip.js/zip.js are real runtime
// dependencies, so they stay external — tsdown only bundles this package's own `src`.
//
// The exception is busabase-contract and busabase-package (and the workspace packages
// they import): like busabase-sdk, those ship TypeScript source (their package exports
// point at `./src/*.ts`), so they can never be runtime dependencies of a published npm
// package. The package-format zod schemas (`busabase-contract/domains/package/types`)
// and the `busabase-package@1` implementation itself are pure Node, so bundle them
// straight into dist instead — same pattern and same reasoning as
// apps/busabase-sdk/tsdown.config.ts.
export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  dts: false,
  noExternal: [/^busabase-contract/, /^busabase-package/, /^open-domains/, /^openlib/],
  // bin/busabase-cli.mjs and package.json#main both expect `dist/*.js` — tsdown's
  // default with platform: "node" resolves to `.mjs` instead (PR #6548 gotcha).
  outExtensions: () => ({ js: ".js" }),
});
