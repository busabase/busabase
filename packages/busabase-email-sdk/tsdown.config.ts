import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  dts: { generator: "tsgo" },
  clean: true,
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
