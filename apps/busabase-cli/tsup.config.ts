import { resolve } from "node:path";
import { defineConfig } from "tsup";

// busabase-contract / open-domains / openlib ship TypeScript source (their package exports point
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
  noExternal: [/^busabase-contract/, /^open-domains/, /^openlib/],
  esbuildOptions(options) {
    // Bundled workspace packages may import each other through package export
    // paths. Resolve bare imports from known workspace symlink locations so
    // esbuild can find them even before a fresh install recreates every link.
    options.nodePaths = [
      resolve(process.cwd(), "node_modules"),
      resolve(process.cwd(), "../../packages/busabase-contract/node_modules"),
      resolve(process.cwd(), "../../packages/open-domains/node_modules"),
    ];
  },
});
