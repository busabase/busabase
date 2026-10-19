import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";

test(
  "reports startup failure and opens the real workspace after retry",
  { timeout: 120_000 },
  async () => {
    const shellUrl = process.env.DESKTOP_E2E_URL;
    const sidecarUrl = process.env.DESKTOP_E2E_SIDECAR_URL;
    const output = process.env.DESKTOP_E2E_OUTPUT_DIR;
    assert.ok(
      shellUrl && sidecarUrl && output,
      "Set DESKTOP_E2E_URL, DESKTOP_E2E_SIDECAR_URL and DESKTOP_E2E_OUTPUT_DIR to isolated local services.",
    );
    await mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1180, height: 780 } });
      page.on("pageerror", (error) => console.error("Browser error:", error.message));
      await page.addInitScript(
        ({ sidecarUrl }) => {
          if (window.top !== window) return;
          window.__STARTUP_TEST_READY__ = false;
          window.__TAURI_INTERNALS__ = {
            metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
            transformCallback: () => 1,
            unregisterCallback: () => {},
            invoke: async (command) => {
              if (command === "start_busabase_sidecar" || command === "busabase_sidecar_status") {
                return {
                  running: true,
                  healthy: window.__STARTUP_TEST_READY__,
                  port: new URL(sidecarUrl).port,
                  pid: null,
                  localUrl: sidecarUrl,
                  apiUrl: `${sidecarUrl}/api/v1`,
                  dataDir: "isolated-test-data",
                  launchMode: "external",
                  error: window.__STARTUP_TEST_READY__
                    ? null
                    : "/dashboard/local/home returned HTTP 500. See sidecar.log.",
                };
              }
              if (command.includes("get_current")) return [];
              if (command.includes("listen")) return 1;
              if (command.includes("is_enabled")) return false;
              return null;
            },
          };
          window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
            registerListener: () => {},
            unregisterListener: () => {},
          };
        },
        { sidecarUrl },
      );
      const response = await page.goto(shellUrl);
      assert.equal(response.status(), 200);
      await expect(page.getByRole("heading", { name: "Busabase is not ready" })).toBeVisible();
      await expect(page.getByText(/returned HTTP 500/)).toBeVisible();
      await expect(page.locator("iframe")).toHaveCount(0);
      await page.screenshot({ path: join(output, "01-startup-error-with-retry.png") });
      await page.evaluate(() => {
        window.__STARTUP_TEST_READY__ = true;
      });
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.locator("iframe[title='Busabase']")).toBeVisible();
      const frame = page.frameLocator("iframe[title='Busabase']");
      await frame.locator("body").waitFor({ timeout: 30_000 });
      await expect(frame.getByText("Internal Server Error", { exact: true })).toHaveCount(0);
      try {
        await expect(
          frame.getByText("Let an agent help fill this workspace", { exact: true }),
        ).toBeVisible({
          timeout: 30_000,
        });
        await expect(frame.locator("[data-dashboard-content-loading]")).toHaveCount(0);
      } catch (error) {
        await page.screenshot({ path: join(output, "startup-workspace-failure.png") });
        throw error;
      }
      await page.screenshot({ path: join(output, "02-retry-opens-real-workspace.png") });
      const cssUrls = await page
        .locator("link[rel='stylesheet']")
        .evaluateAll((links) => links.map((link) => link.href));
      assert.ok(cssUrls.length > 0);
      for (const url of cssUrls) {
        const cssResponse = await page.request.get(url);
        assert.equal(cssResponse.status(), 200);
        assert.doesNotMatch(await cssResponse.text(), /@(apply|theme|custom-variant)\b/);
      }
    } finally {
      await browser.close();
    }
  },
);
