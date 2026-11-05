import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_AGENT_PERMISSION_PORT ?? 15529);
for (const key of [
  "BUDA_ACP_URL",
  "BUDA_API_KEY",
  "BUDA_AGENT_ID",
  "BUDA_ACP_QA_ORIGIN",
  "BUNNY_ACP_QA_MODEL_ORIGIN",
]) {
  if (!process.env[key]) throw new Error(`${key} is required for source ACP permission acceptance`);
}
for (const key of ["BUDA_ACP_QA_ORIGIN", "BUNNY_ACP_QA_MODEL_ORIGIN"]) {
  const url = new URL(process.env[key] ?? "");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Source permission acceptance requires isolated loopback QA services.");
  }
}
const source = new URL(process.env.BUDA_ACP_QA_ORIGIN ?? "");
const acp = new URL(process.env.BUDA_ACP_URL ?? "");
if (acp.protocol !== "ws:" || acp.host !== source.host) {
  throw new Error("The ACP endpoint must belong to the isolated Buda source QA service.");
}
if (!process.env.BUDA_API_KEY?.startsWith("sk_qa_")) {
  throw new Error("Use a synthetic source QA credential for permission acceptance.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "agent-permission-live.spec.ts",
  timeout: 240_000,
  expect: { timeout: 45_000 },
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/acp-permission-live", open: "never" }],
  ],
  outputDir: process.env.ACP_PERMISSION_EVIDENCE_DIR ?? "test-results/agent-permission-live",
  use: {
    ...devices["Desktop Chrome"],
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome",
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 900 },
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
      NODE_OPTIONS: "--max-old-space-size=4096 --no-experimental-webstorage",
    },
  },
});
