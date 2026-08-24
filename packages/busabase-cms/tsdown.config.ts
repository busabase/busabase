import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    next: "src/next.ts",
    fumadocs: "src/fumadocs.ts",
    "integration/index": "src/integration/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  // package.json's `exports` map points at `./dist/*.js` / `./dist/*.d.ts` —
  // tsdown's default for this package resolves to `.mjs`/`.d.mts` instead.
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
