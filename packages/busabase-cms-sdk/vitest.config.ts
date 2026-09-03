import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    alias: {
      "server-only": path.resolve(__dirname, "./tests/mocks/server-only.ts"),
      "busabase-sdk": path.resolve(__dirname, "../../apps/busabase-sdk/src/index.ts"),
      "busabase-contract/contract/cloud": path.resolve(
        __dirname,
        "../busabase-contract/src/contract/cloud.ts",
      ),
      "busabase-contract/domains": path.resolve(
        __dirname,
        "../busabase-contract/src/domains/registry.ts",
      ),
      "busabase-contract/types": path.resolve(__dirname, "../busabase-contract/src/types/index.ts"),
      "open-domains/attachments/types": path.resolve(
        __dirname,
        "../open-domains/attachments/types/attachments.ts",
      ),
      "openlib/i18n/i-string": path.resolve(__dirname, "../openlib/i18n/i-string.ts"),
    },
  },
});
