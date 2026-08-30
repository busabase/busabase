import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // An array, not an object: a plain-object string key is matched by PREFIX, and
    // `busabase-sdk` now has a subpath (`airapp-check`) that a bare-string alias
    // silently rewrote to `.../src/index.ts/airapp-check` — ENOTDIR, and it crashed
    // at module load, before either cli-template test ran, since busabase-cli's
    // run.ts now imports it at the top level for every command, not just `check`.
    // Same fix as apps/busabase-cli/vitest.config.ts; keep the two in sync if the
    // SDK gains more subpaths.
    alias: [
      { find: "~", replacement: path.resolve(__dirname, "./src") },
      // `busabase-cli` has only its bare `.` export today, so a plain string is
      // still correct here — but see the busabase-sdk entries below for what
      // breaks the moment that stops being true.
      {
        find: "busabase-cli",
        replacement: path.resolve(__dirname, "../busabase-cli/src/index.ts"),
      },
      {
        find: /^busabase-sdk\/(.+)$/,
        replacement: path.resolve(__dirname, "../busabase-sdk/src/$1.ts"),
      },
      {
        find: /^busabase-sdk$/,
        replacement: path.resolve(__dirname, "../busabase-sdk/src/index.ts"),
      },
      {
        find: "busabase-contract/api-client",
        replacement: path.resolve(
          __dirname,
          "../../packages/busabase-contract/src/api-client/index.ts",
        ),
      },
      {
        find: "busabase-core/logic/store",
        replacement: path.resolve(__dirname, "../../packages/busabase-core/src/logic/store.ts"),
      },
      { find: "server-only", replacement: path.resolve(__dirname, "./tests/mocks/server-only.ts") },
      {
        find: "sharelib/storage",
        replacement: path.resolve(__dirname, "../../packages/openlib/storage/index.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // PGLite seed → change-request → review → merge integration flows exceed
    // vitest's 5s default on cold CI runners; give DB-heavy tests headroom.
    testTimeout: 30_000,
    // `beforeAll` (PGLite spin-up + seeding) falls under `hookTimeout`, not
    // `testTimeout` — it silently stayed at vitest's 10s default and timed
    // out under real concurrent-file resource contention even though the
    // test itself was fine (see the same fix + explanation in
    // packages/busabase-core/vitest.config.ts).
    hookTimeout: 30_000,
  },
});
