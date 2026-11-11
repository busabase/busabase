import { defineConfig, devices } from "@playwright/test";

// Uses isolated servers; never creates acceptance data on a hosted workspace.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "unified-file-preview.spec.ts",
  timeout: 600_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: "list",
  outputDir: process.env.UNIFIED_PREVIEW_OUTPUT_DIR ?? "test-results/unified-preview",
  use: {
    video: "on",
    trace: "retain-on-failure",
    navigationTimeout: 180_000,
    actionTimeout: 30_000,
  },
  projects: ["oss", "cloud"].flatMap((edition) => [
    {
      name: `${edition}-desktop-chrome`,
      metadata: { edition },
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1440, height: 1000 },
        baseURL: edition === "oss" ? "http://localhost:15429" : "http://localhost:15430",
      },
    },
    {
      name: `${edition}-mobile-safari`,
      metadata: { edition },
      use: {
        ...devices["iPhone 13"],
        baseURL: edition === "oss" ? "http://localhost:15429" : "http://localhost:15430",
      },
    },
  ]),
});
