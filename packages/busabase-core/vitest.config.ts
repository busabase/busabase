import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Skill handlers are server-only; neutralize the guard for Node tests.
      "server-only": path.resolve(__dirname, "./tests/mocks/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // DB-heavy oRPC/PGLite integration tests exceed vitest's 5s default on cold
    // CI runners (seed + change-request + merge, storage file-tree walks).
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      // Focus on the Agent Skills domain (the API endpoints under test).
      include: ["src/domains/skill/**"],
      reporter: ["text", "json"],
      // types.ts is interfaces only (no runtime); tests excluded from self-cover.
      exclude: ["**/*.test.ts", "**/types.ts"],
    },
  },
});
