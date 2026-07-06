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
  },
});
