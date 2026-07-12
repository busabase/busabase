import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // The dashboard is a client SPA that streams its RSC response, so each full-page
  // navigation reloads the bundle and refetches over RPC before content mounts.
  // Give web-first assertions and whole tests room for that (paired with the
  // waitUntil:"commit" navigation default in tests/e2e/_fixtures.ts).
  timeout: 60 * 1000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:15419",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:15419",
    reuseExistingServer: !process.env.CI,
    // 120s wasn't enough on a real (cold, 2-core) GitHub Actions runner: the
    // first Turbopack dev compile + first PGLite migration, with no warm
    // `.next`/pnpm build cache, genuinely took longer than that — confirmed
    // by a real CI run timing out at ~121s, essentially exactly the old
    // limit, not failing fast with a startup error. 240s gives real cold
    // starts headroom without masking an actual crash (a crashed process
    // still fails immediately, well under either timeout).
    timeout: 240 * 1000,
  },
});
