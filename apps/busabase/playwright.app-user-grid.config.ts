import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "app-user-grid-fallback.spec.ts",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: "list",
  outputDir: process.env.APP_USER_GRID_OUTPUT_DIR ?? "test-results/app-user-grid",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:15419",
    viewport: { width: 1440, height: 1000 },
    video: "on",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
