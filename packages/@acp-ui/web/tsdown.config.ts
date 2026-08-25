import { defineConfig } from "tsdown";

// `@acp-ui/core` is a real dependency (published standalone) and `kui` is a
// peer — neither should be bundled. Default `external` behaviour is correct
// for both; there is nothing here that needs `noExternal`.
export default defineConfig({
  entry: {
    "transcript/index": "src/transcript/index.ts",
    "composer/index": "src/composer/index.ts",
    "session-meta/index": "src/session-meta/index.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "neutral",
  outDir: "dist",
  clean: true,
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  dts: { generator: "tsgo", tsconfig: "tsconfig.json" },
  treeshake: true,
  minify: true,
});
