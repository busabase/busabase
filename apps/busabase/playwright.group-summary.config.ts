import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 15531);

export default defineConfig({
  ...base,
  testMatch: "group-summary.spec.ts",
  testIgnore: [],
  workers: 1,
  use: {
    ...base.use,
    baseURL: `http://localhost:${port}`,
    video: "on",
  },
  webServer: {
    ...base.webServer,
    command: `pnpm exec next dev -p ${port}`,
    // The streamed dashboard can remain open; a finite API response proves readiness.
    url: `http://localhost:${port}/api/v1/bases`,
    env: {
      PG_DATABASE_URL: "pglite:///tmp/busabase-group-summary-acceptance-db",
      STORAGE_URL:
        "local:/tmp/busabase-group-summary-acceptance-storage?base_url=/api/storage&upload_url=/api/storage/upload",
    },
  },
});
