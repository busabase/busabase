import { defineConfig } from "tsdown";

// `react` is declared as an optional peer, not a dependency — `session/`
// touches it (use-acp-session.ts), the other three subpaths do not. Default
// `external` behaviour leaves it unbundled either way, so a registry-only
// consumer of e.g. `./reduce` never needs react installed at all.
export default defineConfig({
  entry: {
    "reduce/index": "src/reduce/index.ts",
    "session/index": "src/session/index.ts",
    "group/index": "src/group/index.ts",
    "prompt/index": "src/prompt/index.ts",
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
