import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";

test(
  "background update failures stay non-blocking and manual checks retain feedback",
  { timeout: 90_000 },
  async () => {
    const shellUrl = process.env.DESKTOP_E2E_URL;
    const sidecarUrl = process.env.DESKTOP_E2E_SIDECAR_URL;
    const output = process.env.DESKTOP_E2E_OUTPUT_DIR;
    assert.ok(
      shellUrl && sidecarUrl && output,
      "Set DESKTOP_E2E_URL, DESKTOP_E2E_SIDECAR_URL and DESKTOP_E2E_OUTPUT_DIR.",
    );
    await mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1180, height: 780 } });
      const warnings = [];
      const errors = [];
      page.on("console", (message) => {
        if (message.type() === "warning") warnings.push(message.text());
        if (message.type() === "error") errors.push(message.text());
      });
      await page.addInitScript(
        ({ sidecarUrl }) => {
          if (window.top !== window) return;
          let callbackId = 0;
          const callbacks = new Map();
          const listeners = new Map();
          window.__UPDATE_TEST_CHECKS__ = 0;
          window.__UPDATE_TEST_SUCCEED__ = false;
          window.__UPDATE_TEST_MENU__ = () => {
            const handler = listeners.get("busabase://desktop-menu-action");
            assertHandler(handler);
            handler({
              event: "busabase://desktop-menu-action",
              id: 1,
              payload: { action: "check_for_updates" },
            });
          };
          function assertHandler(handler) {
            if (!handler) throw new Error("Desktop menu listener is not registered.");
          }
          window.__TAURI_INTERNALS__ = {
            metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
            transformCallback: (callback) => {
              const id = ++callbackId;
              callbacks.set(id, callback);
              return id;
            },
            unregisterCallback: (id) => callbacks.delete(id),
            invoke: async (command, args) => {
              if (command === "start_busabase_sidecar" || command === "busabase_sidecar_status") {
                return {
                  running: true,
                  healthy: true,
                  port: Number(new URL(sidecarUrl).port),
                  pid: null,
                  localUrl: sidecarUrl,
                  apiUrl: `${sidecarUrl}/api/v1`,
                  dataDir: "isolated-test-data",
                  launchMode: "external",
                  error: null,
                };
              }
              if (command === "plugin:updater|check") {
                window.__UPDATE_TEST_CHECKS__++;
                if (window.__UPDATE_TEST_SUCCEED__) return null;
                throw "invalid type: null, expected a string";
              }
              if (command === "plugin:event|listen") {
                listeners.set(args.event, callbacks.get(args.handler));
                return 1;
              }
              if (command.includes("get_current")) return [];
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
      assert.equal((await page.goto(shellUrl)).status(), 200);
      const frame = page.frameLocator("iframe[title='Busabase']");
      const workspaceContent = frame
        .getByText("Let an agent help fill this workspace", { exact: true })
        .or(frame.getByText("Recently visited", { exact: true }))
        .first();
      try {
        await expect(workspaceContent).toBeVisible({ timeout: 30_000 });
      } catch (error) {
        for (const current of page.frames()) {
          console.log(
            "Frame:",
            current.url(),
            (await current.locator("body").innerText()).slice(0, 2000),
          );
        }
        console.log("Console errors:", errors);
        await page.screenshot({ path: join(output, "updater-workspace-failure.png") });
        throw error;
      }
      await page.waitForFunction(() => window.__UPDATE_TEST_CHECKS__ >= 1, { timeout: 30_000 });
      await expect(page.locator("[data-update-status]")).toHaveCount(0);
      assert.ok(warnings.some((message) => message.includes("Update check failed")));
      assert.ok(!errors.some((message) => message.includes("Update check failed")));
      await expect(page.getByText("Console Error", { exact: true })).toHaveCount(0);
      await page.screenshot({
        path: join(output, "03-background-update-failure-keeps-workspace-open.png"),
      });
      await page.evaluate(() => window.__UPDATE_TEST_MENU__());
      const control = page.locator("[data-update-status='error']");
      await expect(control).toBeVisible();
      await control.getByRole("button", { name: "Update failed" }).hover();
      await expect(
        page.getByText("Update check failed. Try again after reopening Busabase Desktop.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(control.locator(".desktop-update-popover")).toHaveCSS("opacity", "1");
      await page.screenshot({
        path: join(output, "04-manual-update-check-shows-retry-feedback.png"),
      });
      await page.evaluate(() => {
        window.__UPDATE_TEST_SUCCEED__ = true;
      });
      await control.getByRole("button", { name: "Update failed" }).click();
      await expect(page.locator("[data-update-status='up-to-date']")).toBeVisible();
      await expect(page.locator(".desktop-update-popover")).toHaveCSS("opacity", "1");
      await expect(workspaceContent).toBeVisible();
      await page.screenshot({
        path: join(output, "05-update-retry-recovers-with-workspace-intact.png"),
      });
    } finally {
      await browser.close();
    }
  },
);
