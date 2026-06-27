import { resolve } from "node:path";
import { defineConfig } from "tsup";

// busabase-core / open-domains ship TypeScript source (their package exports point
// at `./src/*.ts`), so they cannot be a runtime dependency of a published npm CLI.
// Bundle the (pure, isomorphic) oRPC contract straight into dist instead — the CLI
// then has zero workspace deps and runs standalone. zod + @orpc/* stay external.
export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  dts: false,
  noExternal: [/^busabase-core/, /^open-domains/],
  esbuildOptions(options) {
    // busabase-core (bundled) imports `open-domains/*` and `busabase-core/*`, but
    // those workspace packages are only symlinked under THIS package's node_modules
    // (not under busabase-core's). Resolve bare imports from here so esbuild finds them.
    options.nodePaths = [resolve(process.cwd(), "node_modules")];
  },
});
