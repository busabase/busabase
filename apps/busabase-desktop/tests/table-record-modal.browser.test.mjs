import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";

// Only the unchanged native lifecycle is substituted. The Desktop iframe,
// records, RPC, PGLite persistence, pagination and record dialogs are real.
test(
  "Desktop table previews and full-page Back retain the user's second-page work",
  { timeout: 300_000 },
  async () => {
    const shellUrl = process.env.DESKTOP_E2E_URL;
    const sidecarUrl = process.env.DESKTOP_E2E_SIDECAR_URL;
    const output = process.env.DESKTOP_E2E_OUTPUT_DIR;
    assert.ok(
      shellUrl && sidecarUrl && output,
      "Set isolated Desktop shell, sidecar and output URLs",
    );
    await mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1180, height: 800 },
      locale: "en-US",
      recordVideo: { dir: join(output, "video"), size: { width: 1180, height: 800 } },
    });
    const rpc = async (procedure, input) => {
      const response = await context.request.post(`${sidecarUrl}/api/rpc/${procedure}`, {
        data: { json: input },
      });
      assert.ok(response.ok(), `${procedure}: ${await response.text()}`);
      return (await response.json()).json;
    };
    let base;
    try {
      const suffix = Date.now();
      base = await rpc("bases/create", {
        autoMerge: true,
        name: `Desktop customer follow-ups ${suffix}`,
        slug: `desktop-table-${suffix}`,
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "notes", name: "Notes", type: "text" },
          { slug: "due", name: "Due", type: "date" },
          { slug: "reference", name: "Reference", type: "text" },
        ],
      });
      await rpc("bases/createBulkChangeRequest", {
        autoMerge: true,
        baseId: base.id,
        records: Array.from({ length: 60 }, (_, i) => ({
          title: `Follow-up ${String(i).padStart(2, "0")}`,
          notes: `Review customer ${String(i).padStart(2, "0")}`,
          due: "2026-10-26",
          reference: `Customer reference ${i}`,
        })),
      });
      const all = await rpc("records/listPage", { baseId: base.id, page: 1, pageSize: 100 });
      const record = all.records.find((item) => item.headCommit.payload.title === "Follow-up 45");
      const nextRecord = all.records.find(
        (item) => item.headCommit.payload.title === "Follow-up 46",
      );
      assert.ok(record && nextRecord, "Both follow-ups must exist on the second sorted page");
      await rpc("views/changeRequest", {
        operation: "create",
        autoMerge: true,
        baseId: base.id,
        name: "Customer follow-ups",
        slug: "customer-follow-ups",
        type: "table",
        config: {
          filters: [],
          sorts: [{ fieldSlug: "title", direction: "asc" }],
          fieldWidths: { title: 320, notes: 420, due: 240, reference: 360 },
        },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      const browserErrors = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      await page.addInitScript(
        ({ sidecarUrl }) => {
          if (window.top !== window) return;
          window.__TAURI_INTERNALS__ = {
            metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
            transformCallback: () => 1,
            unregisterCallback: () => {},
            invoke: async (command) => {
              if (command === "start_busabase_sidecar" || command === "busabase_sidecar_status")
                return {
                  running: true,
                  healthy: true,
                  port: Number(new URL(sidecarUrl).port),
                  pid: null,
                  localUrl: sidecarUrl,
                  apiUrl: `${sidecarUrl}/api/v1`,
                  dataDir: "isolated-table-modal-test",
                  launchMode: "external",
                  error: null,
                };
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
      await page.goto(shellUrl, { waitUntil: "domcontentloaded" });
      await expect(page.locator("iframe[title='Busabase']")).toBeVisible();
      const frame = page.frameLocator("iframe[title='Busabase']");
      await frame
        .getByRole("link", { name: base.name, exact: true })
        .first()
        .click({ timeout: 90_000 });
      await frame.getByRole("link", { name: "Customer follow-ups", exact: true }).click();
      await frame.getByRole("combobox", { name: "Rows per page", exact: true }).click();
      await frame.getByRole("option", { name: "25", exact: true }).click();
      await frame.getByRole("link", { name: "Go to next page", exact: true }).click();
      const row = frame.locator(`[data-record-id="${record.id}"]`);
      const title = row.getByRole("link", { name: "Follow-up 45", exact: true });
      const selected = row.getByTestId("base-record-select");
      await selected.check();
      await title.scrollIntoViewIfNeeded();
      const sidecarFrame = page
        .frames()
        .find((child) => child.url().includes(`/base/${base.slug}/customer-follow-ups`));
      assert.ok(sidecarFrame, "The table must render in the real OSS sidecar iframe");
      const tableUrl = sidecarFrame.url();
      assert.equal(new URL(tableUrl).searchParams.get("recordPage"), "2");
      const vertical = frame.locator("[data-base-detail-scroll]");
      const horizontal = frame.getByTestId("base-records-grid").locator("..");
      await horizontal.evaluate((element) => {
        element.scrollLeft = 200;
      });
      const before = {
        top: await vertical.evaluate((el) => el.scrollTop),
        left: await horizontal.evaluate((el) => el.scrollLeft),
      };
      assert.ok(
        before.top > 0 && before.left > 0,
        "The fixture must exercise both actual scroll axes",
      );
      const shot = (name) => page.screenshot({ path: join(output, name), animations: "disabled" });
      const expectSourceState = async () => {
        assert.equal(sidecarFrame.url(), tableUrl);
        assert.equal(page.url(), shellUrl);
        await expect(selected).toBeChecked();
        await expect.poll(() => vertical.evaluate((el) => el.scrollTop)).toBe(before.top);
        await expect.poll(() => horizontal.evaluate((el) => el.scrollLeft)).toBe(before.left);
      };
      await shot("01-desktop-selected-second-page.png");
      await title.click();
      const detail = frame.getByRole("dialog", { name: "Follow-up 45", exact: true });
      await expect(detail).toBeVisible();
      await expect(detail).toBeInViewport({ ratio: 1 });
      await expect(detail.getByText("Review customer 45", { exact: true })).toBeVisible();
      assert.equal(sidecarFrame.url(), tableUrl);
      assert.equal(page.url(), shellUrl);
      await shot("02-desktop-record-modal.png");
      await page.keyboard.press("Escape");
      await expect(detail).toBeHidden();
      await expect(title).toBeFocused();
      await expectSourceState();
      await page.keyboard.press("Enter");
      await expect(detail).toBeVisible();
      await detail.getByRole("button", { name: "Close", exact: true }).click();
      // Bring Notes out from behind the sticky title column before activating it.
      await horizontal.evaluate((element) => {
        element.scrollLeft = 0;
      });
      await row.getByRole("link", { name: "Review customer 45", exact: true }).click();
      await expect(detail).toBeVisible();
      await detail.getByRole("button", { name: "Close", exact: true }).click();
      await horizontal.evaluate((element) => {
        element.scrollLeft = 200;
      });
      await expectSourceState();
      await title.click();
      await detail.getByRole("link", { name: "Open full page", exact: true }).click();
      await expect(detail).toBeHidden();
      await expect(
        frame.getByRole("heading", { name: "Follow-up 45", level: 1, exact: true }),
      ).toBeVisible();
      assert.equal(
        new URL(sidecarFrame.url()).pathname.endsWith(`/base/${base.slug}/${record.id}`),
        true,
      );
      await shot("03-desktop-full-record.png");
      await sidecarFrame.evaluate(() => window.history.back());
      await expect.poll(() => sidecarFrame.url()).toBe(tableUrl);
      await expect(frame.getByTestId("base-records-grid")).toBeVisible();
      await expectSourceState();
      assert.equal(new URL(sidecarFrame.url()).searchParams.get("recordPage"), "2");
      await shot("04-desktop-restored-table-work.png");
      await title.click();
      await detail.getByRole("link", { name: "Edit", exact: true }).click();
      await expect(detail).toBeHidden();
      await expect(frame.locator('[data-dashboard-scroll="record-editor"]')).toBeVisible();
      await sidecarFrame.evaluate(() => window.history.back());
      await expect.poll(() => sidecarFrame.url()).toBe(tableUrl);
      await expect(frame.getByTestId("base-records-grid")).toBeVisible();
      await expectSourceState();
      await shot("05-desktop-editor-back-restores-work.png");
      const nextTitle = frame
        .locator(`[data-record-id="${nextRecord.id}"]`)
        .getByRole("link", { name: "Follow-up 46", exact: true });
      await nextTitle.click();
      const nextDetail = frame.getByRole("dialog", { name: "Follow-up 46", exact: true });
      await expect(nextDetail).toBeVisible();
      await nextDetail.getByRole("button", { name: "Close", exact: true }).click();
      await expect(nextDetail).toBeHidden();
      const persisted = await rpc("records/get", { recordId: record.id });
      assert.deepEqual(persisted.headCommit.payload, record.headCommit.payload);
      assert.deepEqual(
        browserErrors,
        [],
        "Desktop and iframe must not report uncaught browser errors",
      );
    } finally {
      try {
        if (base)
          await rpc("nodes/createChangeRequest", {
            autoMerge: true,
            message: "Archive isolated Desktop table-modal acceptance fixture",
            operations: [{ kind: "delete", nodeId: base.nodeId }],
          });
      } finally {
        await context.close();
        await browser.close();
      }
    }
  },
);
