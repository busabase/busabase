import { defineConfig, devices } from "@playwright/test";

const appPort = Number(process.env.PLAYWRIGHT_AGENT_PERMISSION_PORT ?? 15529);
const fixturePort = Number(process.env.BUSABASE_ACP_PERMISSION_PORT ?? 15530);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "agent-permission.spec.ts",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/acp-permission", open: "never" }],
  ],
  outputDir: process.env.ACP_PERMISSION_EVIDENCE_DIR ?? "test-results/agent-permission",
  use: {
    ...devices["Desktop Chrome"],
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome",
    baseURL: `http://localhost:${appPort}`,
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
    trace: "off",
    video: "on",
  },
  webServer: [
    {
      command: "pnpm exec tsx tests/e2e/fixtures/acp-permission-server.ts",
      url: `http://127.0.0.1:${fixturePort}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: { BUSABASE_ACP_PERMISSION_PORT: String(fixturePort) },
    },
    {
      command: `pnpm exec next dev -p ${appPort}`,
      url: `http://localhost:${appPort}`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        PG_DATABASE_URL: "pglite://memory://",
        NODE_OPTIONS: "--max-old-space-size=4096 --no-experimental-webstorage",
        BUDA_ACP_URL: `ws://127.0.0.1:${fixturePort}/api/acp`,
        BUDA_API_KEY: "sk_busabase_permission_fixture",
        BUDA_AGENT_ID: "agt_busabase_permission_fixture",
      },
    },
  ],
});
