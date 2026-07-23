import { resolve } from "node:path";
import { defineConfig } from "tsup";

const serverOnlyStub = resolve("src/db/seed/server-only-stub.ts");

export default defineConfig({
  entry: {
    main: "src/db/seed/main.ts",
    "seed-all": "src/db/seed/seed-all.ts",
    "seed-zh-cn": "src/db/seed/seed-zh-cn.ts",
  },
  outDir: "dist/seed",
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  clean: true,
  bundle: true,
  // PGlite resolves its WASM and data files relative to its installed package.
  noExternal: [/^(?!@electric-sql\/pglite(?:\/|$)).*/],
  external: [/^@electric-sql\/pglite(?:\/.*)?$/],
  esbuildOptions(options) {
    options.platform = "node";
    options.alias = { ...options.alias, "server-only": serverOnlyStub };
  },
});
