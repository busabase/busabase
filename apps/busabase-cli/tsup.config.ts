import { defineConfig } from "tsup";

// The CLI is a thin terminal layer over busabase-sdk (the shared, published client
// library). busabase-sdk + commander are real runtime dependencies, so they stay
// external — tsup only bundles this package's own `src`. No workspace source is
// inlined anymore (that lives in busabase-sdk's own build).
export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  dts: false,
});
