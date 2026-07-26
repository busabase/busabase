import { resolve } from "node:path";
import { defineConfig } from "tsup";

// busabase-contract is private source-only workspace code. Bundle the package
// format schemas into every public entry so npm consumers never need that
// workspace package at runtime or through the emitted declaration graph.
export default defineConfig({
  entry: {
    apply: "src/apply.ts",
    client: "src/client.ts",
    collect: "src/collect.ts",
    frontmatter: "src/frontmatter.ts",
    github: "src/github.ts",
    "layout-read": "src/layout-read.ts",
    "layout-write": "src/layout-write.ts",
    plan: "src/plan.ts",
    tree: "src/tree.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  dts: {
    resolve: true,
    // rollup's package resolver does not follow TypeScript-only subpath exports.
    // Point declaration generation at the workspace source so those public
    // schemas are rolled into dist instead of leaking a private package import.
    compilerOptions: {
      baseUrl: ".",
      paths: {
        "busabase-contract/*": ["../busabase-contract/src/*"],
      },
    },
  },
  treeshake: true,
  noExternal: [/^busabase-contract/, /^open-domains/, /^openlib/],
  esbuildOptions(options) {
    options.nodePaths = [
      resolve(process.cwd(), "node_modules"),
      resolve(process.cwd(), "../busabase-contract/node_modules"),
      resolve(process.cwd(), "../open-domains/node_modules"),
    ];
  },
});
