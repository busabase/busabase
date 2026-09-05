import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    next: "src/next.ts",
    fumadocs: "src/fumadocs.ts",
    "integration/index": "src/integration/index.ts",
  },
  format: ["esm"],
  // Typechecking follows workspace source through tsconfig.json so it works in a
  // fresh checkout. Declaration emit deliberately uses package exports instead,
  // keeping busabase-sdk's source graph out of this package's build.
  dts: {
    generator: "tsgo",
    tsconfig: "../../tsconfig.busabase-cms-sdk-dts.json",
  },
  clean: true,
  // package.json's `exports` map points at `./dist/*.js` / `./dist/*.d.ts` —
  // tsdown's default for this package resolves to `.mjs`/`.d.mts` instead.
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
