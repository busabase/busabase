import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", testTimeout: 20000, hookTimeout: 20000 },
  resolve: {
    alias: {
      "busabase-sdk": path.resolve(import.meta.dirname, "../../apps/busabase-sdk/src/index.ts"),
    },
  },
});
