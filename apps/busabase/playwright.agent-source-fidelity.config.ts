import { defineConfig, devices } from "@playwright/test";

// Start the source QA host, compiled Bunny daemon and model-only HTTP fixture
// first using Buda's source acceptance host. No fake ACP producer is used.
const port = Number(process.env.PLAYWRIGHT_AGENT_SOURCE_PORT ?? 33920);
const qaOrigin = process.env.BUDA_ACP_QA_ORIGIN ?? "http://127.0.0.1:33919";
const modelOrigin = process.env.BUNNY_ACP_QA_MODEL_ORIGIN ?? "http://127.0.0.1:33918";
const agentId = process.env.BUDA_ACP_QA_AGENT_ID ?? "agt_acp_source_qa";
const token = process.env.BUDA_ACP_QA_TOKEN ?? "sk_qa_source_fidelity_ephemeral";
for (const origin of [qaOrigin, modelOrigin]) {
  const url = new URL(origin);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Source acceptance requires isolated loopback QA services.");
  }
}
if (!token.startsWith("sk_qa_"))
  throw new Error("Use a synthetic source QA credential, never a production API key.");
const acpUrl = new URL("/api/acp", qaOrigin);
acpUrl.protocol = "ws:";
acpUrl.searchParams.set("agentId", agentId);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "agent-source-fidelity.spec.ts",
  timeout: 600_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report/source-acp", open: "never" }]],
  outputDir: "test-results/source-acp",
  use: {
    ...devices["Desktop Chrome"],
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome",
    baseURL: `http://localhost:${port}`,
    screenshot: "only-on-failure",
    // These services contain synthetic QA identities and local test files only.
    trace: "off",
    video: "on",
  },
  webServer: {
    command: `pnpm exec next dev -p ${port}`,
    url: `http://localhost:${port}`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      PG_DATABASE_URL: "pglite://memory://",
      NODE_OPTIONS: "--dns-result-order=ipv4first --max-old-space-size=4096",
      BUDA_ACP_URL: acpUrl.toString(),
      BUDA_API_KEY: token,
      BUDA_AGENT_ID: agentId,
      BUDA_ACP_QA_ORIGIN: qaOrigin,
      BUNNY_ACP_QA_MODEL_ORIGIN: modelOrigin,
    },
  },
});
