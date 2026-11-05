import { defineConfig, devices } from "@playwright/test";

// Start the existing isolated real Buda source QA host + compiled Bunny daemon
// + deterministic loopback model fixture first. No paid provider is permitted.
// Buda source host must inherit BUDA_ACP_COMMAND_RECEIPTS_ENABLED=true.
const port = Number(process.env.PLAYWRIGHT_AGENT_SUPERVISION_PORT ?? 33941);
const qaOrigin = process.env.BUDA_ACP_QA_ORIGIN ?? "http://127.0.0.1:33919";
const modelOrigin = process.env.BUNNY_ACP_QA_MODEL_ORIGIN ?? "http://127.0.0.1:33918";
const agentId = process.env.BUDA_ACP_QA_AGENT_ID ?? "agt_acp_source_qa";
const token = process.env.BUDA_ACP_QA_TOKEN ?? "sk_qa_source_fidelity_ephemeral";
for (const origin of [qaOrigin, modelOrigin]) {
  const target = new URL(origin);
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
    throw new Error("Supervision browser acceptance requires isolated loopback services.");
}
if (!token.startsWith("sk_qa_"))
  throw new Error("Use a synthetic QA token, never a production API key.");
const acpUrl = new URL("/api/acp", qaOrigin);
acpUrl.protocol = "ws:";
acpUrl.searchParams.set("agentId", agentId);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "agent-session-supervision.spec.ts",
  timeout: 600_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/agent-session-supervision", open: "never" }],
  ],
  outputDir: "test-results/agent-session-supervision",
  use: {
    ...devices["Desktop Chrome"],
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome",
    baseURL: `http://localhost:${port}`,
    screenshot: "only-on-failure",
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
      BUSABASE_AGENT_SUPERVISOR_ENABLED: "true",
      BUSABASE_AGENT_LEGACY_WRITERS_DRAINED: "true",
      BUDA_ACP_URL: acpUrl.toString(),
      BUDA_API_KEY: token,
      BUDA_AGENT_ID: agentId,
      BUDA_ACP_QA_ORIGIN: qaOrigin,
      BUNNY_ACP_QA_MODEL_ORIGIN: modelOrigin,
    },
  },
});
