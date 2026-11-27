import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.FORUM_GREEN_PORT ?? 15428);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "workflow-toolbar-overlap.spec.ts",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    channel: "chrome",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: process.env.FORUM_GREEN_REUSE_SERVER === "1",
    timeout: 240_000,
    env: {
      PG_DATABASE_URL: process.env.PG_DATABASE_URL ?? "pglite:///tmp/busabase-forum-toolbar",
      STORAGE_URL:
        "local:/tmp/busabase-forum-toolbar-storage?base_url=/api/storage&upload_url=/api/storage/upload",
    },
  },
});
