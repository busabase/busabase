import { defineConfig } from "@playwright/test";
import sourceConfig from "./playwright.agent-source-fidelity.config";

export default defineConfig({
  ...sourceConfig,
  testMatch: "agent-pdf-live.spec.ts",
  outputDir: "test-results/agent-pdf-live",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/agent-pdf-live", open: "never" }],
  ],
  use: { ...sourceConfig.use, video: "on" },
});
