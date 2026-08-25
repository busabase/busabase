import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", registry: "src/registry.ts", react: "src/react.tsx" },
  format: ["esm"],
  platform: "neutral",
  outDir: "dist",
  clean: true,
  dts: true,
  treeshake: true,
  minify: true,
  // package.json's `exports` map points at `./dist/index.js` / `./dist/index.d.ts` —
  // tsdown's default resolves to `.mjs`/`.d.mts` instead (established gotcha, PR #6548).
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
