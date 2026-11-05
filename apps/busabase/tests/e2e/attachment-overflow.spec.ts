import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Frame, Page } from "@playwright/test";
import type { BaseVO, RecordVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

test("all attachments remain accessible from grid overflow and wrapping record details", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const slug = `attachment-overflow-${Date.now()}`;
  const title = "Record with ten attachments";
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        name: slug,
        slug,
        fields: [
          { name: "Title", slug: "title", type: "text", required: true },
          { name: "Files", slug: "files", type: "attachment" },
        ],
      },
    }),
  );
  const files: {
    attachmentId: string;
    fileName: string;
    mimeType: string;
    size: number;
    url: string;
  }[] = [];
  const imageBytes = await readFile(
    path.resolve(process.cwd(), "public/assets/readme/scenarios/blog-cms-base.png"),
  );
  for (let index = 0; index < 10; index++) {
    const image = index % 3 === 0;
    const fileName = `attachment-with-a-long-name-for-overflow-verification-${index}.${image ? "png" : "txt"}`;
    const mimeType = image ? "image/png" : "text/plain";
    const bytes = image ? imageBytes : Buffer.from(`Attachment ${index}`);
    const upload = await json<{ storageKey: string; uploadUrl: string }>(
      await request.post("/api/v1/assets/upload-urls", {
        data: { fileName, mimeType, sizeBytes: bytes.length },
      }),
    );
    const uploaded = await request.put(upload.uploadUrl, {
      data: bytes,
      headers: { "content-type": mimeType },
    });
    expect(uploaded.ok()).toBe(true);
    const confirmed = await json<{ attachmentId: string }>(
      await request.post("/api/v1/assets/confirmations", {
        data: { fileName, mimeType, sizeBytes: bytes.length, storageKey: upload.storageKey },
      }),
    );
    files.push({
      attachmentId: confirmed.attachmentId,
      fileName,
      mimeType,
      size: bytes.length,
      url: `/api/storage/${upload.storageKey}`,
    });
  }
  const record = await json<RecordVO>(
    await request.post(`/api/v1/bases/${base.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: { title, files },
        message: "Create attachment overflow regression fixture",
        submittedBy: "playwright",
      },
    }),
  );

  let workspace: Page | Frame = page;
  if (testInfo.project.metadata.desktopShell) {
    const shellURL = process.env.DESKTOP_E2E_URL;
    if (!shellURL) throw new Error("Desktop acceptance requires DESKTOP_E2E_URL");
    const sidecarURL = testInfo.project.use.baseURL;
    if (!sidecarURL) throw new Error("Desktop acceptance requires an isolated sidecar URL");
    expect(["localhost", "127.0.0.1"]).toContain(new URL(shellURL).hostname);
    await page.addInitScript(
      ({ sidecarURL }) => {
        if (window.top !== window) return;
        // Native process lifecycle is unchanged. Exercise the real Desktop shell
        // and sandboxed iframe with the same synthetic bridge as startup tests.
        Object.assign(window, {
          __TAURI_INTERNALS__: {
            metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
            transformCallback: () => 1,
            unregisterCallback: () => {},
            invoke: async (command: string) => {
              if (command === "start_busabase_sidecar" || command === "busabase_sidecar_status")
                return {
                  running: true,
                  healthy: true,
                  port: Number(new URL(sidecarURL).port),
                  pid: null,
                  localUrl: sidecarURL,
                  apiUrl: `${sidecarURL}/api/v1`,
                  dataDir: "isolated-attachment-acceptance",
                  launchMode: "external",
                  error: null,
                };
              if (command.includes("get_current")) return [];
              if (command.includes("listen")) return 1;
              if (command.includes("is_enabled")) return false;
              return null;
            },
          },
          __TAURI_EVENT_PLUGIN_INTERNALS__: {
            registerListener: () => {},
            unregisterListener: () => {},
          },
        });
      },
      { sidecarURL },
    );
    await page.goto(shellURL);
    const iframe = page.locator('iframe[title="Busabase"]');
    await expect(iframe).toBeVisible();
    const frame = await (await iframe.elementHandle())?.contentFrame();
    if (!frame) throw new Error("Desktop sidecar iframe did not mount");
    workspace = frame;
  } else {
    await page.goto("/dashboard/local");
  }
  await workspace.getByRole("link", { name: slug, exact: true }).click();
  const cell = workspace.locator('[data-attachment-preview][data-attachment-presentation="grid"]');
  await expect(cell).toHaveAttribute("data-attachment-count", "10");
  await page.screenshot({ path: testInfo.outputPath("attachment-cell-compact.png") });
  const cellBounds = await cell.evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    height: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(cellBounds.scrollWidth).toBeLessThanOrEqual(cellBounds.width + 1);
  expect(cellBounds.scrollHeight).toBeLessThanOrEqual(cellBounds.height + 1);
  const visibleCount = Number(await cell.getAttribute("data-attachment-visible-count"));
  await expect(cell.locator("[data-attachment-overflow]")).toHaveText(`+${10 - visibleCount}`);
  await cell.locator("[data-attachment-overflow]").click();
  const expanded = workspace.getByTestId("attachment-cell-expanded");
  await expect(expanded).toBeVisible();
  await expect(expanded.locator("[data-attachment-cell-item]")).toHaveCount(10);
  await page.screenshot({ path: testInfo.outputPath("attachment-cell-expanded.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const bounds = await expanded.boundingBox();
      return Boolean(bounds && bounds.x >= -1 && bounds.x + bounds.width <= 391);
    })
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("attachment-cell-expanded-phone.png") });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await expanded.getByRole("button", { name: files[9]?.fileName, exact: true }).click();
  const preview = workspace.getByTestId("attachment-preview-dialog");
  await expect(expanded).toBeHidden();
  await expect(preview.getByRole("heading", { name: files[9]?.fileName })).toBeVisible();
  await expect(preview.locator("[data-attachment-index]")).toHaveCount(10);
  for (const file of files) {
    await preview.getByRole("button", { name: file.fileName, exact: true }).click();
    await expect(preview.getByRole("heading", { name: file.fileName, exact: true })).toBeVisible();
    const href = await preview.getByRole("link", { name: "Open in new tab" }).getAttribute("href");
    expect(href).toBeTruthy();
    expect((await request.get(href as string)).ok()).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("all-attachments-preview.png") });
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(cell.locator("[data-attachment-expand]")).toBeFocused();
  await cell.focus();
  await page.keyboard.press("Shift+Space");
  await expect(expanded).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(expanded).toBeHidden();

  // Widening the column reveals more thumbnails instead of stopping at three.
  const resize = workspace.getByTestId("field-resize-handle-files");
  const handle = await resize.boundingBox();
  if (!handle) throw new Error("Attachment resize handle is missing");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 220, handle.y + handle.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await cell.getAttribute("data-attachment-visible-count")))
    .toBeGreaterThan(3);
  await cell.locator("a").first().click();
  await expect(preview.getByRole("heading", { name: files[0]?.fileName })).toBeVisible();
  await page.keyboard.press("Escape");
  const wideHandle = await resize.boundingBox();
  if (!wideHandle) throw new Error("Attachment resize handle is missing after expansion");
  await page.mouse.move(wideHandle.x + wideHandle.width / 2, wideHandle.y + wideHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(wideHandle.x - 600, wideHandle.y + wideHandle.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() => cell.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
  await cell.locator("[data-attachment-expand]").click();
  await expect(expanded.locator("[data-attachment-cell-item]")).toHaveCount(10);
  await page.keyboard.press("Escape");
  await workspace.getByRole("link", { name: title, exact: true }).click();
  const detail = workspace.getByTestId("record-detail-dialog");
  const attachments = detail.locator("[data-attachment-preview]");
  await expect(attachments.locator("a")).toHaveCount(10);

  for (const viewport of [
    { width: 1500, height: 1000 },
    { width: 700, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    // DOM presence alone cannot catch the old `inline` + `truncate` clipping.
    await expect
      .poll(() =>
        attachments.evaluate((element) => {
          const parent = element.parentElement;
          if (!parent) return false;
          const bounds = parent.getBoundingClientRect();
          return Array.from(element.querySelectorAll("a")).every((link) => {
            const item = link.getBoundingClientRect();
            return (
              item.left >= bounds.left - 1 &&
              item.right <= bounds.right + 1 &&
              item.top >= bounds.top - 1 &&
              item.bottom <= bounds.bottom + 1
            );
          });
        }),
      )
      .toBe(true);
    await attachments.locator("a").last().click();
    await expect(preview.getByRole("heading", { name: files[9]?.fileName })).toBeVisible();
    await page.keyboard.press("Escape");
    await attachments.locator("a").last().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`record-attachments-${viewport.width}.png`),
    });
  }
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(workspace.getByTestId("base-records-grid")).toBeVisible();

  // Reuse ten real stored files to exercise a hundred attachment occurrences.
  const manyFiles = Array.from({ length: 100 }, (_, index) => ({
    ...files[index % files.length],
    fileName: `bulk-attachment-${index}.${index % 3 === 0 ? "png" : "txt"}`,
  }));
  await json(
    await request.post(`/api/v1/records/${record.id}/change-requests`, {
      data: {
        operation: "update",
        autoMerge: true,
        fields: { files: manyFiles },
        message: "Verify a hundred attachments in the expanded cell",
        submittedBy: "playwright",
      },
    }),
  );
  await page.setViewportSize({ width: 1500, height: 1000 });
  await workspace.goto(workspace.url(), { waitUntil: "commit" });
  // Large list values are intentionally omitted by the API's 4 KiB budget.
  // The existing full-content entry must still reach every stored attachment.
  await workspace.getByRole("link", { name: "View full content", exact: true }).click();
  await expect(detail).toBeVisible();
  await expect(attachments).toHaveAttribute("data-attachment-count", "100");
  const last = attachments.getByRole("link", { name: manyFiles[99]?.fileName, exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("attachment-hundred-files-detail.png") });
  await last.click();
  await expect(preview.getByRole("heading", { name: manyFiles[99]?.fileName })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(last).toBeFocused();
  expect(browserErrors, "The workspace and Desktop shell must have no uncaught errors").toEqual([]);
});
