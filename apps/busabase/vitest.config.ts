import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "busabase-core/api-client": path.resolve(
        __dirname,
        "../../packages/busabase-core/src/api-client/index.ts",
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
  },
});
