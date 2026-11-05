import { defineConfig } from "@playwright/test";

// Servers and their isolated PGLite/storage directories are provisioned explicitly.
// Never let an acceptance run silently attach to a user's normal local workspace.
const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) {
  throw new Error("Attachment acceptance requires an explicit local PLAYWRIGHT_BASE_URL");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "attachment-overflow.spec.ts",
  timeout: 180_000,
  expect: { timeout: 25_000 },
  workers: 1,
  reporter: "list",
  outputDir: "test-results/attachment-acceptance",
  use: {
    baseURL,
    viewport: { width: 1500, height: 1000 },
    locale: "en-US",
    video: "on",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    ...(["chromium", "firefox", "webkit"] as const).map((browserName) => ({
      name: `oss-${browserName}`,
      use: { browserName },
    })),
    ...(["chromium", "firefox", "webkit"] as const).map((browserName) => ({
      name: `desktop-${browserName}`,
      metadata: { desktopShell: true },
      use: { browserName },
    })),
  ],
});
