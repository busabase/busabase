import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";

// Exercise the shipped Desktop web shell and its real OSS sidecar. Only the
// unchanged native lifecycle boundary is substituted, as in startup.browser.test.
// Records, relations, RPC, persistence, routing, and dialog rendering are real.
test(
  "Desktop shell reads calendar records without leaving its real sidecar calendar",
  { timeout: 240_000 },
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
      viewport: { width: 1180, height: 900 },
      locale: "en-US",
      recordVideo: { dir: join(output, "video"), size: { width: 1180, height: 900 } },
    });
    const rpc = async (procedure, input) => {
      const response = await context.request.post(`${sidecarUrl}/api/rpc/${procedure}`, {
        data: { json: input },
      });
      assert.ok(response.ok(), `${procedure}: ${await response.text()}`);
      return (await response.json()).json;
    };
    const bases = [];
    try {
      const suffix = Date.now();
      const customer = await rpc("bases/create", {
        autoMerge: true,
        name: `Calendar Customers ${suffix}`,
        slug: `calendar-customers-${suffix}`,
        fields: [{ slug: "name", name: "Name", type: "text", required: true }],
      });
      bases.push(customer);
      const company = await rpc("bases/createChangeRequest", {
        baseId: customer.id,
        autoMerge: true,
        fields: { name: "Acme customer" },
      });
      const base = await rpc("bases/create", {
        autoMerge: true,
        name: `Customer Follow-ups ${suffix}`,
        slug: `customer-followups-${suffix}`,
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "due", name: "Due", type: "date" },
          {
            slug: "customer",
            name: "Customer",
            type: "relation",
            options: { targetBaseId: customer.id, multiple: false },
          },
          { slug: "notes", name: "Notes", type: "markdown" },
        ],
      });
      bases.push(base);
      const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 10);
      const due = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-10`;
      const record = await rpc("bases/createChangeRequest", {
        baseId: base.id,
        autoMerge: true,
        fields: {
          title: "Follow up Acme",
          due,
          customer: [company.id],
          notes: "## Discussion notes\n\nConfirm the revised schedule.",
        },
      });
      await rpc("views/changeRequest", {
        operation: "create",
        baseId: base.id,
        autoMerge: true,
        name: "Follow-up Calendar",
        slug: "follow-up-calendar",
        type: "calendar",
        config: { dateFieldSlug: "due", filters: [], sorts: [] },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
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
                  dataDir: "isolated-calendar-test",
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
      const iframe = page.locator("iframe[title='Busabase']");
      await expect(iframe).toBeVisible();
      const frame = page.frameLocator("iframe[title='Busabase']");
      await frame
        .getByRole("link", { name: base.name, exact: true })
        .first()
        .click({ timeout: 90_000 });
      await frame.getByRole("link", { name: "Follow-up Calendar", exact: true }).click();
      await frame.getByRole("button", { name: "Next month", exact: true }).click();
      const card = frame
        .locator(`[data-calendar-record-id="${record.id}"]`)
        .getByRole("link", { name: "Follow up Acme" });
      await expect(card).toBeVisible();
      const sidecarFrame = page
        .frames()
        .find((child) => child.url().includes("follow-up-calendar"));
      assert.ok(sidecarFrame, "The calendar must render in the real sidecar iframe");
      const calendarUrl = sidecarFrame.url();
      await page.screenshot({
        path: join(output, "01-desktop-shell-calendar.png"),
        animations: "disabled",
      });
      await card.click();
      const detail = frame.getByRole("dialog", { name: "Follow up Acme", exact: true });
      await expect(detail).toBeVisible();
      await expect(detail).toBeInViewport({ ratio: 1 });
      await expect(detail.getByText("Acme customer", { exact: true })).toBeVisible();
      await expect(
        detail.getByRole("heading", { name: "Discussion notes", exact: true }),
      ).toBeVisible();
      assert.equal(sidecarFrame.url(), calendarUrl);
      assert.equal(page.url(), shellUrl);
      await page.screenshot({
        path: join(output, "02-desktop-shell-record-modal.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(detail).toBeHidden();
      await expect(card).toBeFocused();
      await expect(
        frame.getByText(nextMonth.toLocaleDateString("en", { year: "numeric", month: "long" }), {
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(detail).toBeVisible();
      await detail.getByRole("link", { name: "Open full page", exact: true }).click();
      await expect(detail).toBeHidden();
      await expect(
        frame.getByRole("heading", { name: "Follow up Acme", level: 1, exact: true }),
      ).toBeVisible();
      assert.match(sidecarFrame.url(), new RegExp(`/base/${base.slug}/${record.id}(?:\\?|$)`));
      await page.screenshot({
        path: join(output, "03-desktop-shell-full-record.png"),
        animations: "disabled",
      });
      await sidecarFrame.evaluate(() => window.history.back());
      await expect.poll(() => sidecarFrame.url()).toBe(calendarUrl);
      await expect(detail).toBeHidden();
      await frame.getByRole("button", { name: "Next month", exact: true }).click();
      await expect(card).toBeVisible();
      await card.click();
      await detail.getByRole("button", { name: "Close", exact: true }).click();
      await expect(detail).toBeHidden();
      await expect(card).toBeVisible();
      await page.screenshot({
        path: join(output, "04-desktop-shell-back-to-calendar.png"),
        animations: "disabled",
      });
      const persisted = await rpc("records/get", { recordId: record.id });
      assert.deepEqual(persisted.headCommit.payload.customer, [company.id]);
      assert.equal(persisted.headCommit.payload.due, due);
      assert.equal(
        persisted.headCommit.payload.notes,
        "## Discussion notes\n\nConfirm the revised schedule.",
      );
    } finally {
      try {
        for (const base of bases.reverse())
          await rpc("nodes/createChangeRequest", {
            autoMerge: true,
            message: "Archive isolated Desktop calendar acceptance fixture",
            operations: [{ kind: "delete", nodeId: base.nodeId }],
          });
      } finally {
        await context.close();
        await browser.close();
      }
    }
  },
);
