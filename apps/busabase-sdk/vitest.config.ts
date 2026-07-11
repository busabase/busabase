import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // index.ts is the whole ergonomic `Busabase` wrapper class (putText lives
      // here alongside the other namespace getters/shortcuts); client.ts is
      // covered too since it's the client factory every namespace routes through.
      // This reports whole-file coverage, not just the new putText method — see
      // the test task report for a line-range-scoped read of the new code
      // specifically.
      include: ["src/index.ts", "src/client.ts"],
      reporter: ["text", "json"],
      exclude: ["**/*.test.ts"],
    },
  },
});
