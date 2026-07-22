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
    include: [
      "tests/**/*.test.ts",
      "src/domains/dashboard/helpers/**/*.test.ts",
      "src/domains/dashboard/components/**/*.test.tsx",
    ],
    // DB-heavy oRPC/PGLite integration tests exceed vitest's 5s default on cold
    // CI runners (seed + change-request + merge, storage file-tree walks).
    testTimeout: 30_000,
    // `beforeAll`/`afterAll` (PGLite instance spin-up + seeding, one per test
    // file, many running concurrently) falls under `hookTimeout`, NOT
    // `testTimeout` above — it silently stayed at vitest's 10s default even
    // after testTimeout was raised, which is too short under real
    // concurrent-file resource contention (confirmed: files that "failed"
    // with `Hook timed out in 10000ms` under full-suite load pass cleanly
    // every time when re-run in isolation or small groups — this was always
    // a too-short timeout, not a real bug in the hooks themselves).
    hookTimeout: 30_000,
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
