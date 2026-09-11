import { defineConfig, devices } from "@playwright/test";

const appPort = Number(process.env.PLAYWRIGHT_AGENT_CHAT_PORT ?? 15429);
const acpPort = Number(process.env.PLAYWRIGHT_ACP_FIXTURE_PORT ?? 15430);
const fixtureToken = "sk_busabase_agent_chat_e2e";
const fixtureAgentId = "agt_agent_chat_e2e";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "agent-chat.spec.ts",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],
  outputDir: "test-results/agent-chat",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${appPort}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm exec tsx tests/e2e/fixtures/acp-agent-server.ts",
      url: `http://127.0.0.1:${acpPort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        BUSABASE_ACP_FIXTURE_PORT: String(acpPort),
        BUSABASE_ACP_FIXTURE_TOKEN: fixtureToken,
        BUSABASE_ACP_FIXTURE_AGENT_ID: fixtureAgentId,
      },
    },
    {
      command: `pnpm exec next dev -p ${appPort}`,
      url: `http://localhost:${appPort}`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        PG_DATABASE_URL: process.env.BUSABASE_AGENT_CHAT_E2E_DATABASE_URL ?? "pglite://memory://",
        BUDA_ACP_URL: `ws://127.0.0.1:${acpPort}/api/acp`,
        BUDA_API_KEY: fixtureToken,
        BUDA_AGENT_ID: fixtureAgentId,
      },
    },
  ],
});
