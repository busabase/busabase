import { resolve } from "node:path";
import { defineConfig, type UserConfig } from "tsdown";

const serverOnlyStub = resolve("src/db/seed/server-only-stub.ts");

const entries = [
  ["main", "src/db/seed/main.ts"],
  ["seed-all", "src/db/seed/seed-all.ts"],
  ["seed-zh-cn", "src/db/seed/seed-zh-cn.ts"],
] as const;

export default defineConfig(
  entries.map<UserConfig>(([name, entry], index) => ({
    entry: { [name]: entry },
    outDir: "dist/seed",
    format: ["cjs"],
    outExtensions: () => ({ js: ".cjs" }),
    clean: index === 0,
    platform: "node",
    outputOptions: { codeSplitting: false },
    // PGlite resolves its WASM and data files relative to its installed package.
    noExternal: [/^(?!@electric-sql\/pglite(?:\/|$)).*/],
    external: [/^@electric-sql\/pglite(?:\/.*)?$/],
    alias: { "server-only": serverOnlyStub },
  })),
);
