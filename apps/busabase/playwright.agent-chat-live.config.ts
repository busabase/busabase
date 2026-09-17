import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_AGENT_CHAT_PORT ?? 3286);
for (const key of ["BUDA_ACP_URL", "BUDA_API_KEY", "BUDA_AGENT_ID"]) {
  if (!process.env[key]) throw new Error(`${key} is required for live ACP acceptance`);
}
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "agent-chat-live.spec.ts",
  timeout: 240_000,
  expect: { timeout: 90_000 },
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report/live-acp", open: "never" }]],
  outputDir: "test-results/live-acp",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${port}`,
    screenshot: "only-on-failure",
    // Live credentials and remote session data must not enter network traces.
    trace: "off",
    video: "off",
  },
  webServer: {
    command: `pnpm exec next dev -p ${port}`,
    url: `http://localhost:${port}`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { PG_DATABASE_URL: "pglite://memory://", NODE_OPTIONS: "--dns-result-order=ipv4first" },
  },
});
