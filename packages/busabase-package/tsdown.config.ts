import { defineConfig } from "tsdown";

// busabase-contract is private source-only workspace code. Bundle the package
// format schemas into every public entry so npm consumers never need that
// workspace package at runtime or through the emitted declaration graph.
export default defineConfig({
  entry: {
    apply: "src/apply.ts",
    client: "src/client.ts",
    collect: "src/collect.ts",
    discover: "src/discover.ts",
    frontmatter: "src/frontmatter.ts",
    github: "src/github.ts",
    "index-build": "src/index-build.ts",
    "layout-read": "src/layout-read.ts",
    "layout-write": "src/layout-write.ts",
    plan: "src/plan.ts",
    template: "src/template.ts",
    tree: "src/tree.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  // package.json's `exports` map points at `./dist/*.js` / `./dist/*.d.ts` (matching
  // the previous tsup output) — force those extensions explicitly since tsdown's
  // default for this package resolved to `.mjs`/`.d.mts`.
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  // `tsgo` generator + repo-root dts tsconfig — same setup and same reasons as
  // apps/busabase-sdk/tsdown.config.ts (see the comment there).
  dts: {
    generator: "tsgo",
    tsconfig: "../../tsconfig.busabase-package-dts.json",
    // rollup's package resolver does not follow TypeScript-only subpath exports.
    // Point declaration generation at the workspace source so those public
    // schemas are rolled into dist instead of leaking a private package import.
    compilerOptions: {
      paths: {
        "busabase-contract/*": ["../busabase-contract/src/*"],
      },
    },
  },
  treeshake: true,
  noExternal: [/^busabase-contract/, /^open-domains/, /^openlib/],
});
