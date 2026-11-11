import { createHash, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { APIRequestContext, Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { BaseVO, RecordVO } from "busabase-contract/types";

test.skip(
  process.env.UNIFIED_PREVIEW_E2E !== "1",
  "Use dedicated local servers and create-preview-acceptance-fixtures.cjs",
);
interface Sample {
  name: string;
  mimeType: string;
  type: string;
  marker: string;
  path: string;
}
interface Ref {
  id: string;
  assetId?: string;
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const raw = (file: Ref) => (file.assetId ? `/api/assets/${file.assetId}/raw` : file.url);
async function rpc<T>(
  request: APIRequestContext,
  cloud: boolean,
  procedure: string,
  input: unknown,
): Promise<T> {
  const response = await request.post(`/api/rpc/${cloud ? "core/" : ""}${procedure}`, {
    data: { json: input },
    headers: cloud ? { "x-busabase-space": "org_lookup_e2e" } : {},
    timeout: 180_000,
  });
  expect(response.ok(), `${procedure}: ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()).json as T;
}
async function upload(request: APIRequestContext, cloud: boolean, sample: Sample) {
  const bytes = await readFile(sample.path);
  const input = {
    fileName: sample.name,
    mimeType: sample.mimeType,
    sizeBytes: bytes.length || 1,
    context: "unified-preview-acceptance",
  };
  const issued = await rpc<{ storageKey: string; uploadUrl: string }>(
    request,
    cloud,
    "assets/createUploadUrl",
    input,
  );
  expect(
    (
      await request.put(issued.uploadUrl, {
        data: bytes.length ? bytes : Buffer.from("\n"),
        headers: { "content-type": sample.mimeType },
      })
    ).ok(),
  ).toBe(true);
  const confirmed = await rpc<{ assetId: string; attachmentId: string; publicUrl: string }>(
    request,
    cloud,
    "assets/confirm",
    { ...input, storageKey: issued.storageKey },
  );
  // The normal upload contract rejects empty files; exercise a genuine old empty object.
  if (!bytes.length) expect((await request.put(issued.uploadUrl, { data: bytes })).ok()).toBe(true);
  const ref: Ref = {
    id: confirmed.assetId,
    assetId: confirmed.assetId,
    attachmentId: confirmed.attachmentId,
    fileName: sample.name,
    mimeType: sample.mimeType,
    size: bytes.length,
    url: confirmed.publicUrl,
  };
  for (const url of [ref.url, raw(ref)]) {
    const response = await request.get(url);
    expect(response.ok()).toBe(true);
    expect(hash(await response.body())).toBe(hash(bytes));
  }
  return { ref, sha256: hash(bytes), storageKey: issued.storageKey };
}
async function shot(page: Page, info: TestInfo, name: string) {
  const modal = page.getByTestId("attachment-preview-dialog");
  if (await modal.isVisible()) {
    const b = await modal.boundingBox();
    const v = page.viewportSize();
    expect(b && v).toBeTruthy();
    if (b && v) {
      expect(b.x).toBeGreaterThanOrEqual(-1);
      expect(b.y).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.width).toBeLessThanOrEqual(v.width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(v.height + 1);
    }
  }
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}
async function downloaded(page: Page, dialog: Locator, fileName: string, expectedHash: string) {
  const event = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download file", exact: true }).click();
  const file = await event;
  expect(file.suggestedFilename()).toBe(fileName);
  const path = await file.path();
  if (!path) throw Error("Download missing");
  const actual = hash(await readFile(path));
  expect(actual).toBe(expectedHash);
  return actual;
}

test("review a mixed delivery through one PreviewFile modal and keep every original", async ({
  page,
  context,
  baseURL,
}, info) => {
  expect(new URL(baseURL as string).hostname).toBe("localhost");
  // Keep app/storage requests real; the unrelated third-party recorder is
  // outside attachment acceptance and can fail WebKit's access-control checks.
  await context.route(/https:\/\/(?:www\.)?clarity\.ms\/tag\//, (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
  const cloud = info.project.metadata.edition === "cloud";
  if (cloud) {
    const token = "markdown-preview-isolated-session-20261110";
    const signature = createHmac("sha256", "markdown-preview-isolated-acceptance-20261110")
      .update(token)
      .digest("base64");
    await context.addCookies([
      {
        name: "busabase-cloud.session_token",
        value: `${token}.${signature}`,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: false,
      },
    ]);
    expect(
      (
        await page.request.post("/api/rpc/user/updateLanguage", {
          data: { json: { language: "en" } },
          timeout: 180_000,
        })
      ).ok(),
    ).toBe(true);
  }
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const samples = JSON.parse(
    await readFile(
      process.env.UNIFIED_PREVIEW_MANIFEST ?? "/tmp/unified-preview-fixtures/manifest.json",
      "utf8",
    ),
  ) as Sample[];
  const uploaded = [];
  for (const sample of samples) uploaded.push(await upload(page.request, cloud, sample));
  const imageRef = uploaded.find((x) => x.ref.fileName === "photo.png")!.ref;
  const storagePath = new URL(imageRef.url, info.project.use.baseURL as string).pathname;
  const imagePattern = (url: URL) =>
    url.pathname === `/api/assets/${imageRef.assetId}/raw` || url.pathname === storagePath;
  await page.route(imagePattern, (route) =>
    route.fulfill({ status: 503, body: "Temporary image failure" }),
  );
  const refs = uploaded.map((x) =>
    x.ref.fileName === "empty.md"
      ? { ...x.ref, id: x.ref.attachmentId, assetId: undefined }
      : x.ref,
  );
  if (!refs[0]) throw Error("No samples");
  refs[0] = { ...refs[0], id: refs[0].attachmentId, assetId: undefined };
  const suffix = `${info.project.name}-${Date.now()}`;
  const base = await rpc<BaseVO>(page.request, cloud, "bases/create", {
    name: `Delivery review ${suffix}`,
    slug: `delivery-review-${suffix}`,
    autoMerge: true,
    fields: [
      { slug: "title", name: "Title", type: "text", required: true },
      { slug: "files", name: "Delivery files", type: "attachment" },
    ],
  });
  const record = await rpc<RecordVO>(page.request, cloud, "bases/createChangeRequest", {
    baseId: base.id,
    autoMerge: true,
    fields: { title: "Review the mixed customer delivery", files: refs },
  });
  const space = cloud ? "org_lookup_e2e" : "local";
  await page.goto(`/dashboard/${space}/home`, { waitUntil: "commit" });
  const baseLink = page.getByRole("link", { name: base.name as string, exact: true }).first();
  await expect(page.getByRole("button", { name: "Toggle sidebar", exact: true })).toBeVisible();
  if (!(await baseLink.isVisible()))
    await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
  await baseLink.click();
  await expect(page.locator(`[data-record-id="${record.id}"]`)).toBeVisible();
  await shot(page, info, "01-find-the-customer-delivery");
  await page.getByRole("link", { name: "Review the mixed customer delivery", exact: true }).click();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  const original = await readFile(samples[0]!.path);
  const primaryName = "uploaded-review-中文.md";
  await page
    .getByLabel("Delivery files", { exact: true })
    .setInputFiles({ name: primaryName, mimeType: "text/markdown", buffer: original });
  await expect(page.getByRole("link", { name: primaryName, exact: true })).toBeVisible();
  await shot(page, info, "02-upload-and-save-the-original");
  await page.getByRole("button", { name: "Update Now", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${record.id}$`));
  await page.reload({ waitUntil: "commit" });
  const saved = await rpc<RecordVO>(page.request, cloud, "records/get", { recordId: record.id });
  const savedRefs = saved.headCommit?.payload.files as Ref[];
  const primary = savedRefs.find((x) => x.fileName === primaryName);
  if (!primary) throw Error("UI upload not persisted");
  expect(savedRefs[0]?.assetId).toBeUndefined();
  const stored = await page.request.get(raw(primary));
  expect(hash(await stored.body())).toBe(hash(original));
  await page
    .locator("[data-attachment-preview]")
    .getByRole("link", { name: primaryName, exact: true })
    .click();
  const dialog = page.getByTestId("attachment-preview-dialog");
  const viewer = dialog.locator("[data-previewfile-type]");
  const choose = async (name: string, type?: string) => {
    await dialog.getByRole("button", { name, exact: true }).click();
    await expect(dialog.getByRole("heading", { name, exact: true })).toBeVisible();
    if (type) await expect(viewer).toHaveAttribute("data-previewfile-type", type);
  };
  const md = dialog.getByTestId("attachment-markdown-preview");
  await expect(viewer).toHaveAttribute("data-previewfile-type", "markdown");
  await expect(md.getByRole("heading", { name: "审核报告 🧭", exact: true })).toBeVisible();
  await shot(page, info, "03-read-markdown-through-previewfile");
  await md.getByRole("button", { name: "Source", exact: true }).click();
  await expect(md).toContainText("<script>window.previewExecuted = true</script>");
  await shot(page, info, "04-inspect-safe-source");
  expect(
    await page.evaluate(() => (window as unknown as { previewExecuted?: boolean }).previewExecuted),
  ).toBeUndefined();
  const primaryDownload = await downloaded(page, dialog, primaryName, hash(original));
  const downloads = [];
  for (const sample of samples) {
    const entry = uploaded.find((x) => x.ref.fileName === sample.name)!;
    const failingDatabase =
      sample.type === "sqlite" ? `**/api/assets/${entry.ref.assetId}/raw` : null;
    if (failingDatabase)
      await page.route(failingDatabase, (route) =>
        route.fulfill({ status: 503, body: "Temporary database preview failure" }),
      );
    await choose(
      sample.name,
      sample.type === "unsupported" || sample.type === "presentation" ? undefined : sample.type,
    );
    if (sample.name === "invalid.md") {
      await expect(dialog.getByRole("alert")).toContainText("UTF-8");
      await shot(page, info, "05-encoding-error-keeps-original");
    } else if (sample.name === "oversized.txt") {
      await expect(dialog.getByRole("alert")).toContainText("1 MiB");
    } else if (sample.name === "empty.md") {
      await expect(dialog.getByRole("status")).toContainText("empty");
    } else if (sample.type === "markdown") {
      await expect(md.getByRole("heading", { name: sample.marker, exact: true })).toBeVisible();
    } else if (sample.type === "code") {
      await expect(dialog.getByTestId("attachment-text-preview")).toContainText(sample.marker);
      await shot(page, info, `06-${sample.name}-readable-source`);
    } else if (sample.type === "image") {
      await expect(
        viewer.getByRole("paragraph").filter({ hasText: /^Failed to load image$/ }),
      ).toBeVisible();
      await shot(page, info, "18a-retry-a-binary-preview");
      await page.unroute(imagePattern);
      await dialog.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(viewer.locator("img")).toBeVisible();
      await expect
        .poll(() => viewer.locator("img").evaluate((el) => (el as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      await shot(page, info, "07-inspect-the-photo");
    } else if (sample.type === "pdf") {
      await expect(viewer.locator("canvas").first()).toBeVisible();
      await expect(viewer).toContainText(sample.marker);
      await shot(page, info, "08-read-the-pdf");
    } else if (sample.type === "tiff" || sample.type === "psd") {
      const canvas = viewer.locator("canvas");
      await expect(canvas).toBeVisible();
      await expect
        .poll(() => canvas.evaluate((el) => (el as HTMLCanvasElement).width))
        .toBe(sample.type === "psd" ? 96 : 480);
      await shot(page, info, `08-render-${sample.type}`);
    } else if (sample.type === "subtitle") {
      await expect(viewer).toContainText(sample.marker);
      await shot(page, info, "08-read-the-subtitles");
    } else if (sample.type === "spreadsheet") {
      await expect(viewer.locator("canvas")).toBeVisible();
      await viewer
        .getByRole("listitem")
        .filter({ hasText: /^Details$/ })
        .click();
      await expect(viewer.getByRole("listitem").filter({ hasText: /^Details$/ })).toBeVisible();
      await shot(page, info, "09-switch-the-spreadsheet-sheet");
    } else if (sample.type === "word") {
      await expect(viewer).toContainText(sample.marker);
      await shot(page, info, "10-read-the-word-document");
    } else if (sample.type === "archive") {
      await expect(viewer).toContainText(sample.marker);
      await shot(page, info, "11-inspect-the-archive-entries");
    } else if (sample.type === "epub") {
      await expect
        .poll(async () => {
          for (const f of page.frames())
            if (
              f !== page.mainFrame() &&
              (
                await f
                  .locator("body")
                  .textContent()
                  .catch(() => "")
              )?.includes(sample.marker)
            )
              return true;
          return false;
        })
        .toBe(true);
      await shot(page, info, "12-read-the-book");
    } else if (sample.type === "sqlite") {
      await expect(viewer.getByRole("button", { name: "Try Again", exact: true })).toBeVisible();
      await shot(page, info, "13a-retry-the-database-in-place");
      if (failingDatabase) await page.unroute(failingDatabase);
      let navigated = false;
      const onNavigate = () => {
        navigated = true;
      };
      page.on("domcontentloaded", onNavigate);
      await viewer.getByRole("button", { name: "Try Again", exact: true }).click();
      await expect(viewer).toContainText(sample.marker);
      expect(navigated).toBe(false);
      page.off("domcontentloaded", onNavigate);
      await shot(page, info, "13-query-the-database");
    } else if (sample.type === "model_3d") {
      await expect(viewer.locator("canvas")).toBeVisible();
      await expect(viewer).toContainText("Size: 1.0 × 1.0 × 0.0");
      const canvas = await viewer.locator("canvas").boundingBox();
      if (!canvas) throw new Error("3D canvas has no rendered bounds");
      await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      await page.mouse.down();
      await page.mouse.move(canvas.x + canvas.width / 2 + 35, canvas.y + canvas.height / 2 + 20, {
        steps: 5,
      });
      await page.mouse.up();
      await shot(page, info, "14-view-the-3d-model");
    } else if (sample.type === "audio" || sample.type === "video") {
      const media = viewer.locator(sample.type);
      await expect(media).toBeVisible();
      await expect
        .poll(() => media.evaluate((el) => (el as HTMLMediaElement).readyState))
        .toBeGreaterThan(0);
      await media.evaluate((el) => (el as HTMLMediaElement).play());
      await expect
        .poll(() => media.evaluate((el) => (el as HTMLMediaElement).currentTime))
        .toBeGreaterThan(0);
      await media.evaluate((el) => (el as HTMLMediaElement).pause());
      await shot(page, info, `15-play-${sample.type}`);
    } else if (sample.type === "unsupported") {
      await expect(dialog.getByRole("link", { name: "Open file", exact: true })).toBeVisible();
      await shot(page, info, "16-unknown-format-still-downloads");
    } else if (sample.type === "presentation") {
      if (cloud) {
        await expect(viewer.locator("canvas").first()).toBeVisible({ timeout: 120_000 });
        await expect(viewer).toContainText(sample.marker, { timeout: 120_000 });
      } else
        await expect(dialog.getByRole("link", { name: "Open file", exact: true })).toBeVisible();
      await shot(page, info, "17-conversion-capability");
    }
    downloads.push({
      name: sample.name,
      sha256: await downloaded(page, dialog, sample.name, entry.sha256),
    });
  }
  await choose(primaryName, "markdown");
  await choose("report.json", "code");
  const pattern = `**/api/assets/${primary.assetId}/raw`;
  await page.route(pattern, (route) =>
    route.fulfill({ status: 503, body: "Temporary read failure" }),
  );
  await choose(primaryName, "markdown");
  await expect(md.getByRole("alert")).toBeVisible();
  await shot(page, info, "18-retry-without-leaving-the-record");
  await page.unroute(pattern);
  await md.getByRole("button", { name: /^(Retry|Try Again)$/ }).click();
  await expect(md.getByRole("heading", { name: "审核报告 🧭", exact: true })).toBeVisible();
  await choose("photo.png", "image");
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-type": "text/markdown; charset=iso-8859-1" },
    });
  });
  await choose(primaryName, "markdown");
  await expect(md.getByRole("heading", { name: "审核报告 🧭", exact: true })).toBeVisible();
  await page.unroute(pattern);
  await choose("photo.png", "image");
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  let reached = () => {};
  const started = new Promise<void>((r) => {
    reached = r;
  });
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    reached();
    await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await choose(primaryName, "markdown");
  await started;
  await expect(md.getByRole("status")).toBeVisible();
  await choose("budget.xlsx", "spreadsheet");
  release();
  await page.unroute(pattern);
  await expect(viewer.locator("canvas")).toBeVisible();
  await expect(md).toHaveCount(0);
  await shot(page, info, "19-late-text-never-replaces-the-new-file");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.locator("[data-attachment-preview]").getByRole("link", { name: primaryName, exact: true }),
  ).toBeFocused();
  await shot(page, info, "20-return-to-the-unchanged-record");
  expect(
    (await rpc<RecordVO>(page.request, cloud, "records/get", { recordId: record.id })).headCommit,
  ).toEqual(saved.headCommit);
  expect(errors).toEqual([]);
  const evidence = {
    project: info.project.name,
    baseId: base.id,
    recordId: record.id,
    uiUpload: {
      sha256: hash(original),
      storedSha256: hash(await stored.body()),
      downloadedSha256: primaryDownload,
    },
    uploaded,
    downloads,
    pageErrors: errors,
    recordUnchanged: true,
  };
  const output = info.outputPath("storage-and-download-digests.json");
  await writeFile(output, JSON.stringify(evidence, null, 2));
  await info.attach("storage-and-download-digests", {
    path: output,
    contentType: "application/json",
  });
});
