import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 15559);

export default defineConfig({
  ...base,
  testMatch: "gallery-linked-record-names.spec.ts",
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  outputDir: "test-results/gallery",
  use: {
    ...base.use,
    baseURL: `http://localhost:${port}`,
    video: "on",
  },
  webServer: {
    ...base.webServer,
    command: `node tests/e2e/fixtures/gallery-server.mjs ${port}`,
    url: `http://127.0.0.1:${port}/api/v1/bases`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
