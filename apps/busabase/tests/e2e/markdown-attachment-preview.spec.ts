import { createHash, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { APIRequestContext, Page, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { BaseVO, RecordVO } from "busabase-contract/types";

// Explicit opt-in: this writes fixtures to two disposable local instances.
test.skip(
  process.env.MARKDOWN_PREVIEW_E2E !== "1",
  "Run with the dedicated markdown config and isolated databases",
);

interface Ref {
  id: string;
  assetId?: string;
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
}
const body =
  "# 审计报告 🧭\n\n中文、é、العربية与 emoji 🚀 保持原样。\n\n| 指标 | 数值 |\n| --- | --- |\n| 访问 | 550 |\n\n```ts\nconst greeting = '你好';\n```\n\n<script>window.markdownExecuted = true</script>\n\n[参考资料](https://example.com)\n";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const raw = (ref: Ref) => (ref.assetId ? `/api/assets/${ref.assetId}/raw` : ref.url);

async function shot(page: Page, info: TestInfo, name: string) {
  const visibleDialog = page.getByTestId("attachment-preview-dialog");
  if (await visibleDialog.isVisible()) {
    const bounds = await visibleDialog.boundingBox();
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
  const submittedBytes = bytes.length ? bytes : Buffer.from("\n");
  const input = {
    fileName,
    mimeType,
    sizeBytes: submittedBytes.length,
    context: "markdown-preview-acceptance",
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
  // The current upload contract rejects zero-byte files. Exercise a legacy empty object
  // by truncating our own confirmed fixture through the real storage upload route.
  if (!bytes.length) expect((await request.put(issued.uploadUrl, { data: bytes })).ok()).toBe(true);
  const ref: Ref = {
    id: confirmed.assetId,
    assetId: confirmed.assetId,
    attachmentId: confirmed.attachmentId,
    fileName,
    mimeType,
    size: bytes.length,
    url: confirmed.publicUrl,
  };
  // Read the actual object through the public storage route AND the permission-aware raw route.
  for (const url of [confirmed.publicUrl, raw(ref)]) {
    const response = await request.get(url);
    expect(response.ok(), `${url}: ${response.status()}`).toBe(true);
    expect(hash(await response.body())).toBe(hash(bytes));
  }
  return { ref, sha256: hash(bytes), storageKey: issued.storageKey };
}

test("review uploaded Markdown, recover failures, switch attachments and download the original", async ({
  page,
  context,
  baseURL,
}, info) => {
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL as string).hostname);
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
    { name: "legacy-audit.MD", mime: "text/plain", bytes: Buffer.from(body) },
    {
      name: "wrong-image-mime.md",
      mime: "image/png",
      bytes: Buffer.from("# MIME 标记错误也能读\n\n这仍然是 Markdown。"),
    },
    {
      name: "mime-only-note",
      mime: "text/markdown; charset=iso-8859-1",
      bytes: Buffer.from("# UTF-8 优先\n\n忽略错误的 HTTP charset。"),
    },
    {
      name: "invalid-encoding.md",
      mime: "text/markdown",
      bytes: Buffer.from([0xff, 0xfe, 0x23, 0x00, 0x61, 0x00]),
    },
    { name: "too-large.md", mime: "text/markdown", bytes: Buffer.alloc(1024 * 1024 + 1, 0x61) },
    { name: "empty.md", mime: "text/markdown", bytes: Buffer.alloc(0) },
    {
      name: "ordinary.txt",
      mime: "text/plain",
      bytes: Buffer.from("A generic file keeps its open and download actions."),
    },
    {
      name: "picture.png",
      mime: "image/png",
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    },
  ];
  const uploaded = [];
  for (const sample of samples)
    uploaded.push(await upload(page.request, cloud, sample.name, sample.mime, sample.bytes));
  const refs = uploaded.map((item) => item.ref);
  // A pre-assets attachment reference: deliberately has NO assetId.
  const legacy = refs[0];
  if (!legacy) throw new Error("Missing legacy upload");
  refs[0] = { ...legacy, id: legacy.attachmentId, assetId: undefined };
  const suffix = `${info.project.name}-${Date.now()}`;
  const base = await rpc<BaseVO>(page.request, cloud, "bases/create", {
    autoMerge: true,
    name: `Markdown review ${suffix}`,
    slug: `markdown-review-${suffix}`,
    fields: [
      { slug: "title", name: "Title", type: "text", required: true },
      { slug: "files", name: "Review files", type: "attachment" },
    ],
  });
  const record = await rpc<RecordVO>(page.request, cloud, "bases/createChangeRequest", {
    baseId: base.id,
    autoMerge: true,
    fields: { title: "Audit documents awaiting review", files: refs },
  });
  const space = cloud ? "org_lookup_e2e" : "local";
  await page.goto(`/dashboard/${space}/home`, { waitUntil: "commit" });
  const baseLink = page.getByRole("link", { name: base.name as string, exact: true }).first();
  await expect(page.getByRole("button", { name: "Toggle sidebar", exact: true })).toBeVisible();
  if (!(await baseLink.isVisible())) {
    await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
  }
  await baseLink.click();
  await expect(page.locator(`[data-record-id="${record.id}"]`)).toBeVisible();
  await shot(page, info, "01-find-the-audit-in-the-workspace");
  await page.getByRole("link", { name: "Audit documents awaiting review", exact: true }).click();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.locator('input[type="file"][aria-label="Review files"]').setInputFiles({
    name: "uploaded-audit-中文.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(body),
  });
  await expect(
    page.getByRole("link", { name: "uploaded-audit-中文.md", exact: true }),
  ).toBeVisible();
  await shot(page, info, "02-upload-the-original-markdown");
  await page.getByRole("button", { name: "Update Now", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${record.id}$`));
  await page.reload({ waitUntil: "commit" });
  const saved = await rpc<RecordVO>(page.request, cloud, "records/get", { recordId: record.id });
  const savedRefs = saved.headCommit?.payload.files as Ref[];
  const primary = savedRefs.find((item) => item.fileName === "uploaded-audit-中文.md");
  if (!primary) throw new Error("Real UI upload was not persisted");
  expect(savedRefs[0]?.assetId).toBeUndefined();
  const storageRead = await page.request.get(raw(primary));
  expect(hash(await storageRead.body())).toBe(hash(Buffer.from(body)));
  const dialog = page.getByTestId("attachment-preview-dialog");
  const surface = dialog.getByTestId("attachment-markdown-preview");
  await page
    .locator("[data-attachment-preview]")
    .getByRole("link", { name: primary.fileName, exact: true })
    .click();
  await expect(surface.getByRole("heading", { name: "审计报告 🧭", exact: true })).toBeVisible();
  await expect(surface.getByRole("table")).toContainText("550");
  expect(
    await page.evaluate(
      () => (window as unknown as { markdownExecuted?: boolean }).markdownExecuted,
    ),
  ).toBeUndefined();
  await shot(page, info, "03-read-rendered-chinese-markdown");
  await surface.getByRole("button", { name: "Source", exact: true }).click();
  await expect(surface).toContainText("# 审计报告 🧭");
  await expect(surface).toContainText("<script>window.markdownExecuted = true</script>");
  await shot(page, info, "04-inspect-the-original-source");
  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download file", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(primary.fileName);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Download did not complete");
  expect(hash(await readFile(downloadPath))).toBe(hash(Buffer.from(body)));
  const choose = async (name: string) => {
    await dialog.getByRole("button", { name, exact: true }).click();
    await expect(dialog.getByRole("heading", { name, exact: true })).toBeVisible();
  };
  await choose("legacy-audit.MD");
  await expect(surface.getByRole("heading", { name: "审计报告 🧭", exact: true })).toBeVisible();
  await shot(page, info, "05-read-a-legacy-attachment-reference");
  await choose("wrong-image-mime.md");
  await expect(surface.getByRole("heading", { name: "MIME 标记错误也能读" })).toBeVisible();
  await shot(page, info, "06-ignore-an-incorrect-image-mime");
  await choose("mime-only-note");
  await expect(surface.getByRole("heading", { name: "UTF-8 优先" })).toBeVisible();
  await choose("invalid-encoding.md");
  await expect(surface.getByRole("alert")).toContainText("UTF-8");
  await expect(dialog.getByRole("link", { name: "Download file", exact: true })).toBeVisible();
  await shot(page, info, "07-explain-invalid-encoding-and-keep-download");
  await choose("too-large.md");
  await expect(surface.getByRole("alert")).toContainText("1 MiB");
  await shot(page, info, "08-explain-the-preview-size-limit");
  await choose("empty.md");
  await expect(surface).toContainText("empty");
  await choose("ordinary.txt");
  await expect(surface).toHaveCount(0);
  await expect(dialog.getByTestId("attachment-text-content")).toHaveText(
    "A generic file keeps its open and download actions.",
  );
  await choose("picture.png");
  await expect(dialog.getByRole("img", { name: "picture.png", exact: true })).toBeVisible();
  // A failed request recovers by retrying the exact same real stored object.
  const pattern = `**/api/assets/${primary.assetId}/raw`;
  await page.route(pattern, (route) =>
    route.fulfill({ status: 503, body: "Temporary storage read failure" }),
  );
  await choose(primary.fileName);
  await expect(surface.getByRole("alert")).toBeVisible();
  await shot(page, info, "09-recover-from-a-storage-read-failure");
  await page.unroute(pattern);
  await surface.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(surface.getByRole("heading", { name: "审计报告 🧭", exact: true })).toBeVisible();
  await shot(page, info, "10-retry-reads-the-stored-original");
  // Preserve real response bytes while deliberately mislabelling HTTP charset.
  await choose("empty.md");
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-type": "text/markdown; charset=iso-8859-1" },
    });
  });
  await choose(primary.fileName);
  await expect(surface.getByRole("heading", { name: "审计报告 🧭", exact: true })).toBeVisible();
  await page.unroute(pattern);
  // Switch away while a real storage response is delayed; late completion must not overwrite it.
  await choose("empty.md");
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
  await choose(primary.fileName);
  await started;
  await expect(surface.getByRole("status")).toBeVisible();
  await shot(page, info, "11-switch-documents-during-loading");
  await choose("wrong-image-mime.md");
  release();
  await page.unroute(pattern);
  await expect(surface.getByRole("heading", { name: "MIME 标记错误也能读" })).toBeVisible();
  await expect(surface.getByRole("heading", { name: "审计报告 🧭" })).toHaveCount(0);
  await shot(page, info, "12-the-new-selection-survives-the-late-response");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page
      .locator("[data-attachment-preview]")
      .getByRole("link", { name: primary.fileName, exact: true }),
  ).toBeFocused();
  await shot(page, info, "13-return-to-the-record-without-changing-it");
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
      fileName: primary.fileName,
      sha256: hash(Buffer.from(body)),
      storedSha256: hash(await storageRead.body()),
      downloadedSha256: hash(await readFile(downloadPath)),
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
