import { defineConfig, devices } from "@playwright/test";

const appPort = Number(process.env.PLAYWRIGHT_AGENT_FIDELITY_PORT ?? 15441);
const fixturePort = Number(process.env.BUSABASE_ACP_FIDELITY_PORT ?? 15442);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "agent-fidelity.spec.ts",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report/acp-fidelity", open: "never" }]],
  outputDir: "test-results/acp-fidelity",
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: `http://localhost:${appPort}`,
    screenshot: "only-on-failure",
    // Event iterators remain open during a task; screenshots/video provide
    // evidence without waiting for an infinite response body during tracing.
    trace: "off",
    video: "on",
  },
  webServer: [
    {
      command: "pnpm exec tsx tests/e2e/fixtures/acp-fidelity-server.ts",
      url: `http://127.0.0.1:${fixturePort}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: { BUSABASE_ACP_FIDELITY_PORT: String(fixturePort) },
    },
    {
      command: `pnpm exec next dev -p ${appPort}`,
      url: `http://localhost:${appPort}`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        PG_DATABASE_URL: "pglite://memory://",
        NODE_OPTIONS: "--max-old-space-size=3072",
        BUDA_ACP_URL: `ws://127.0.0.1:${fixturePort}/api/acp`,
        BUDA_API_KEY: "sk_busabase_fidelity_fixture",
        BUDA_AGENT_ID: "agt_busabase_fidelity_fixture",
      },
    },
  ],
});
