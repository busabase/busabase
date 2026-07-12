import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `busabase-cli` / `busabase-sdk` resolve to their built `dist/` via package
      // exports; point at source so the CLI golden-path e2e runs without a build.
      "busabase-cli": path.resolve(__dirname, "../busabase-cli/src/index.ts"),
      "busabase-sdk": path.resolve(__dirname, "../busabase-sdk/src/index.ts"),
      "busabase-contract/api-client": path.resolve(
        __dirname,
        "../../packages/busabase-contract/src/api-client/index.ts",
      ),
      "busabase-core/logic/store": path.resolve(
        __dirname,
        "../../packages/busabase-core/src/logic/store.ts",
      ),
      "server-only": path.resolve(__dirname, "./tests/mocks/server-only.ts"),
      "sharelib/storage": path.resolve(__dirname, "../../packages/openlib/storage/index.ts"),
    },
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
