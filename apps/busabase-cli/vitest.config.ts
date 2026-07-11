import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The workspace `busabase-sdk` package resolves to its built `dist/`, which
      // isn't present during a source test run. Point at the SDK source so CLI
      // tests exercise the real client without a build step (the SDK's own deps
      // — busabase-contract, @orpc/* — resolve to source / node_modules).
      "busabase-sdk": path.resolve(__dirname, "../busabase-sdk/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // run.ts is the entire CLI surface (curated + generated commands); it's the
      // only source file, so this reports whole-CLI coverage, not just the new
      // Drive Grep Retrieval commands (put-text/grep/read-lines) — see the test
      // task report for a line-range-scoped read of the new code specifically.
      include: ["src/run.ts"],
      reporter: ["text", "json"],
      exclude: ["**/*.test.ts"],
    },
  },
});
