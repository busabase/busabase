import { createHash, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { APIRequestContext, Page, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { BaseVO, RecordVO } from "busabase-contract/types";

test.skip(
  process.env.TEXT_PREVIEW_E2E !== "1",
  "Run with the dedicated text-preview config and disposable local instances",
);

interface AttachmentRef {
  id: string;
  assetId?: string;
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
}

const text =
  "交接记录 🧭\r\n\r\n中文、é、العربية与 emoji 🚀 保持原样。\r\n\t负责人\t状态\r\n  Kelly  \t已核对\r\n\r\n# This is literal plain text\r\n<script>window.textAttachmentExecuted = true</script>\r\n";
const html =
  "<!doctype html>\n<h1>Source is readable</h1>\n<script>window.textAttachmentExecuted = true</script>\n";
const primaryName = "uploaded-handoff-中文.txt";
const sourceName = "uploaded-source.html";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const raw = (ref: AttachmentRef) => (ref.assetId ? `/api/assets/${ref.assetId}/raw` : ref.url);

async function rpc<T>(
  request: APIRequestContext,
  cloud: boolean,
  procedure: string,
  input: unknown,
): Promise<T> {
  const response = await request.post(`/api/rpc/${cloud ? "core/" : ""}${procedure}`, {
    headers: cloud ? { "x-busabase-space": "org_lookup_e2e" } : {},
    data: { json: input },
    timeout: 180_000,
  });
  expect(response.ok(), `${procedure}: ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()).json as T;
}

async function upload(
  request: APIRequestContext,
  cloud: boolean,
  fileName: string,
  mimeType: string,
  bytes: Buffer,
) {
  // Empty legacy objects exist even though the current upload contract requires bytes.
  const submittedBytes = bytes.length ? bytes : Buffer.from("\n");
  const input = {
    fileName,
    mimeType,
    sizeBytes: submittedBytes.length,
    context: "text-preview-acceptance",
  };
  const issued = await rpc<{ uploadUrl: string; storageKey: string }>(
    request,
    cloud,
    "assets/createUploadUrl",
    input,
  );
  const sent = await request.put(issued.uploadUrl, {
    data: submittedBytes,
    headers: { "content-type": mimeType },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  const confirmed = await rpc<{ assetId: string; attachmentId: string; publicUrl: string }>(
    request,
    cloud,
    "assets/confirm",
    { ...input, storageKey: issued.storageKey },
  );
  if (!bytes.length) expect((await request.put(issued.uploadUrl, { data: bytes })).ok()).toBe(true);
  const ref: AttachmentRef = {
    id: confirmed.assetId,
    assetId: confirmed.assetId,
    attachmentId: confirmed.attachmentId,
    fileName,
    mimeType,
    size: bytes.length,
    url: confirmed.publicUrl,
  };
  for (const url of [ref.url, raw(ref)]) {
    const response = await request.get(url);
    expect(response.ok(), `${url}: ${response.status()}`).toBe(true);
    expect(digest(await response.body())).toBe(digest(bytes));
  }
  return { ref, sha256: digest(bytes), storageKey: issued.storageKey };
}

async function shot(page: Page, info: TestInfo, name: string) {
  const dialog = page.getByTestId("attachment-preview-dialog");
  if (await dialog.isVisible()) {
    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds && viewport).toBeTruthy();
    if (bounds && viewport) {
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    }
  }
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

test("review TXT and source, recover reading, and download unchanged originals", async ({
  page,
  context,
  baseURL,
}, info) => {
  const origin = new URL(baseURL as string);
  expect(["localhost", "127.0.0.1"]).toContain(origin.hostname);
  expect(["15439", "15440"]).toContain(origin.port);
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
        secure: false,
        sameSite: "Lax",
      },
    ]);
    await page.request.post("/api/rpc/user/updateLanguage", { data: { json: { language: "en" } } });
  }
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const samples = [
    { name: "legacy-handoff.TXT", mime: "application/octet-stream", bytes: Buffer.from(text) },
    { name: "wrong-image-mime.txt", mime: "image/png", bytes: Buffer.from("仍然是文本。\n") },
    {
      name: "mime-only-note",
      mime: "text/plain; charset=iso-8859-1",
      bytes: Buffer.from("忽略错误的 HTTP charset。🚀\n"),
    },
    { name: "settings.json", mime: "application/json", bytes: Buffer.from('{"name":"中文"}\n') },
    { name: "settings.yaml", mime: "application/yaml", bytes: Buffer.from("owner: Kelly\n") },
    {
      name: "source.js",
      mime: "application/octet-stream",
      bytes: Buffer.from("window.textAttachmentExecuted = true;\n"),
    },
    { name: "invalid.txt", mime: "text/plain", bytes: Buffer.from([0xff, 0xfe, 0x61, 0x00]) },
    { name: "too-large.txt", mime: "text/plain", bytes: Buffer.alloc(1024 * 1024 + 1, 0x61) },
    { name: "empty.txt", mime: "text/plain", bytes: Buffer.alloc(0) },
    { name: "report.md", mime: "text/markdown", bytes: Buffer.from("# Review report\n\n中文。\n") },
    {
      name: "picture.png",
      mime: "image/png",
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    },
    { name: "unknown.bin", mime: "application/octet-stream", bytes: Buffer.from([0, 1, 2, 255]) },
  ];
  const uploaded = [];
  for (const sample of samples)
    uploaded.push(await upload(page.request, cloud, sample.name, sample.mime, sample.bytes));
  const refs = uploaded.map((item) => item.ref);
  const legacy = refs[0];
  if (!legacy) throw new Error("Missing legacy fixture");
  refs[0] = { ...legacy, id: legacy.attachmentId, assetId: undefined };
  const suffix = `${info.project.name}-${Date.now()}`;
  const base = await rpc<BaseVO>(page.request, cloud, "bases/create", {
    autoMerge: true,
    name: `Text review ${suffix}`,
    slug: `text-review-${suffix}`,
    fields: [
      { slug: "title", name: "Title", type: "text", required: true },
      { slug: "files", name: "Review files", type: "attachment" },
    ],
  });
  const record = await rpc<RecordVO>(page.request, cloud, "bases/createChangeRequest", {
    baseId: base.id,
    autoMerge: true,
    fields: { title: "Handoff files awaiting review", files: refs },
  });
  await page.goto(`/dashboard/${cloud ? "org_lookup_e2e" : "local"}/home`, {
    waitUntil: "commit",
  });
  const baseLink = page.getByRole("link", { name: base.name as string, exact: true }).first();
  const toggle = page.getByRole("button", { name: "Toggle sidebar", exact: true });
  await expect(toggle).toBeVisible();
  if (!(await baseLink.isVisible())) await toggle.click();
  await baseLink.click();
  await expect(page.locator(`[data-record-id="${record.id}"]`)).toBeVisible();
  await shot(page, info, "01-find-handoff-files-from-the-workspace");
  await page.getByRole("link", { name: "Handoff files awaiting review", exact: true }).click();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.locator('input[type="file"][aria-label="Review files"]').setInputFiles([
    { name: primaryName, mimeType: "text/plain", buffer: Buffer.from(text) },
    { name: sourceName, mimeType: "text/html", buffer: Buffer.from(html) },
  ]);
  for (const name of [primaryName, sourceName])
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await shot(page, info, "02-upload-the-original-txt-and-source");
  await page.getByRole("button", { name: "Update Now", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${record.id}$`));
  await page.reload({ waitUntil: "commit" });
  const saved = await rpc<RecordVO>(page.request, cloud, "records/get", { recordId: record.id });
  const savedRefs = saved.headCommit?.payload.files as AttachmentRef[];
  expect(savedRefs[0]?.assetId).toBeUndefined();
  const primary = savedRefs.find((ref) => ref.fileName === primaryName);
  const source = savedRefs.find((ref) => ref.fileName === sourceName);
  if (!primary || !source) throw new Error("Actual UI uploads were not persisted");
  const stored = await page.request.get(raw(primary));
  expect(stored.ok()).toBe(true);
  expect(digest(await stored.body())).toBe(digest(Buffer.from(text)));
  const opener = page
    .locator("[data-attachment-preview]")
    .getByRole("link", { name: primaryName, exact: true });
  await opener.click();
  const dialog = page.getByTestId("attachment-preview-dialog");
  const surface = dialog.getByTestId("attachment-text-preview");
  const content = surface.getByTestId("attachment-text-content");
  const choose = async (name: string) => {
    await dialog.getByRole("button", { name, exact: true }).click();
    await expect(dialog.getByRole("heading", { name, exact: true })).toBeVisible();
  };
  const expectText = async (expected: string) => {
    await expect(surface).toHaveAttribute("data-text-state", "ready");
    expect(await content.textContent()).toBe(expected);
    await content.scrollIntoViewIfNeeded();
  };
  const assertInert = async () => {
    expect(
      await page.evaluate(
        () => (window as unknown as { textAttachmentExecuted?: boolean }).textAttachmentExecuted,
      ),
    ).toBeUndefined();
  };
  await expectText(text);
  expect(await content.evaluate((node) => getComputedStyle(node).whiteSpace)).toMatch(
    /^(pre|pre-wrap|break-spaces)$/,
  );
  await expect(surface.getByRole("heading")).toHaveCount(0);
  await assertInert();
  await shot(page, info, "03-read-utf8-txt-with-original-whitespace");
  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download file", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(primaryName);
  const downloadedPath = await download.path();
  if (!downloadedPath) throw new Error("Original download did not finish");
  expect(digest(await readFile(downloadedPath))).toBe(digest(Buffer.from(text)));

  await choose(sourceName);
  await expectText(html);
  await expect(surface.getByRole("heading")).toHaveCount(0);
  await assertInert();
  await shot(page, info, "04-inspect-html-source-without-executing-it");
  const storedSource = await page.request.get(raw(source));
  expect(digest(await storedSource.body())).toBe(digest(Buffer.from(html)));
  for (const sample of samples.slice(0, 6)) {
    await choose(sample.name);
    await expectText(sample.bytes.toString("utf8"));
    await assertInert();
    if (sample.name === "legacy-handoff.TXT")
      await shot(page, info, "05-read-a-legacy-generic-mime-txt");
    if (sample.name === "wrong-image-mime.txt") {
      await expect(dialog.getByRole("img", { name: sample.name, exact: true })).toHaveCount(0);
      await shot(page, info, "06-read-txt-despite-incorrect-image-mime");
    }
  }
  await shot(page, info, "07-inspect-source-and-configuration-files");
  await choose("invalid.txt");
  await expect(surface.getByRole("alert")).toContainText("UTF-8");
  await expect(dialog.getByRole("link", { name: "Download file", exact: true })).toBeVisible();
  await shot(page, info, "08-explain-encoding-and-keep-the-original");
  await choose("too-large.txt");
  await expect(surface.getByRole("alert")).toContainText("1 MiB");
  await shot(page, info, "09-explain-the-text-size-limit");
  await choose("empty.txt");
  await expect(surface.getByRole("status")).toContainText("empty");
  await shot(page, info, "10-identify-an-empty-text-file");

  const pattern = `**/api/assets/${primary.assetId}/raw`;
  await page.route(pattern, (route) =>
    route.fulfill({ status: 503, body: "Temporary read failure" }),
  );
  await choose(primaryName);
  await expect(surface.getByRole("alert")).toBeVisible();
  await shot(page, info, "11-recover-from-a-temporary-read-failure");
  await page.unroute(pattern);
  await surface.getByRole("button", { name: "Retry", exact: true }).click();
  await expectText(text);
  await shot(page, info, "12-retry-reads-the-stored-original");
  await choose("empty.txt");
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-type": "text/plain; charset=iso-8859-1" },
    });
  });
  await choose(primaryName);
  await expectText(text);
  await page.unroute(pattern);

  await choose("empty.txt");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached = () => {};
  const started = new Promise<void>((resolve) => {
    reached = resolve;
  });
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    reached();
    await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await choose(primaryName);
  await started;
  await expect(surface.getByRole("status")).toBeVisible();
  await shot(page, info, "13-change-files-while-text-is-loading");
  await choose("wrong-image-mime.txt");
  release();
  await page.unroute(pattern);
  await expectText("仍然是文本。\n");
  await shot(page, info, "14-keep-the-new-selection-after-a-late-response");

  await choose("report.md");
  const markdown = dialog.getByTestId("attachment-markdown-preview");
  await expect(markdown.getByRole("heading", { name: "Review report", exact: true })).toBeVisible();
  await markdown.getByRole("button", { name: "Source", exact: true }).click();
  await expect(markdown).toContainText("# Review report");
  await shot(page, info, "15-markdown-still-has-rendered-and-source-modes");
  await choose("picture.png");
  const image = dialog.getByRole("img", { name: "picture.png", exact: true });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await choose("unknown.bin");
  await expect(surface).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Open file", exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Download file", exact: true })).toBeVisible();
  await assertInert();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await shot(page, info, "16-return-to-the-unchanged-record");
  const after = await rpc<RecordVO>(page.request, cloud, "records/get", { recordId: record.id });
  expect(after.headCommit).toEqual(saved.headCommit);
  expect(pageErrors).toEqual([]);
  const digests = {
    edition: cloud ? "cloud" : "oss",
    project: info.project.name,
    baseId: base.id,
    recordId: record.id,
    uploaded: uploaded.map((item, index) => ({
      fileName: samples[index]?.name,
      storageKey: item.storageKey,
      sha256: item.sha256,
    })),
    uiUpload: {
      fileName: primaryName,
      sha256: digest(Buffer.from(text)),
      storedSha256: digest(await stored.body()),
      downloadedSha256: digest(await readFile(downloadedPath)),
    },
    uiSourceUpload: {
      fileName: sourceName,
      sha256: digest(Buffer.from(html)),
      storedSha256: digest(await storedSource.body()),
    },
    storedRecordUnchangedByPreview: true,
    pageErrors,
  };
  const digestPath = info.outputPath("storage-and-download-digests.json");
  await writeFile(digestPath, JSON.stringify(digests, null, 2));
  await info.attach("storage-and-download-digests", {
    path: digestPath,
    contentType: "application/json",
  });
});
