import type { Download, Page } from "@playwright/test";
import { Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";
import { expect, test } from "./_fixtures";

test.describe.configure({ mode: "serial" });

const logicalRpcUrls = (url: string, postData: string | null): string[] => {
  if (!url.includes("/api/rpc")) return [];
  if (!url.includes("/__batch__") || !postData) return [url];
  try {
    const batch = JSON.parse(postData) as Array<{ url?: unknown }>;
    return batch.flatMap((entry) => (typeof entry.url === "string" ? [entry.url] : []));
  } catch {
    return [url];
  }
};

const watchFileTreeChangeRequests = (page: Page) => {
  const calls: string[] = [];
  page.on("request", (request) => calls.push(...logicalRpcUrls(request.url(), request.postData())));
  return () => calls.filter((url) => /fileTrees(?:%2F|\/|\.)createChangeRequest/i.test(url)).length;
};

const uploadFolder = async (page: Page, folder: string, fileNames: string[]) => {
  await page.locator('input[type="file"]').setInputFiles(
    fileNames.map((name) => ({
      buffer: Buffer.from(`${folder}/${name}\n`),
      mimeType: "text/plain",
      name,
    })),
  );
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Upload files" })).toBeVisible();
  await dialog.getByRole("button", { name: /New folder inside/ }).click();
  await dialog.getByLabel("Folder name").fill(folder);
  await dialog.getByRole("button", { name: "Upload now" }).click();
  for (const name of fileNames) {
    await expect(page.getByRole("treeitem", { name, exact: true })).toBeVisible();
  }
};

const downloadBytes = async (download: Download): Promise<Uint8Array> => {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
};

test("Drive selection deduplicates folders and children and downloads one structured ZIP", async ({
  page,
}, testInfo) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const folder = `zip-${suffix}`;
  const first = `first-${suffix}.txt`;
  await page.goto("/dashboard/local/drive/team-files");
  await expect(
    page.getByRole("heading", { name: "Team Files", exact: true }).first(),
  ).toBeVisible();
  await uploadFolder(page, folder, [first]);

  await page.getByRole("button", { name: "Select Drive files" }).click();
  await page.getByRole("checkbox", { name: `Select ${folder}` }).click();
  await page.getByRole("checkbox", { name: `Select ${first}` }).click();
  await expect(page.getByText("1 file selected", { exact: true })).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("drive-folder-child-selection-deduplicated.png"),
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download selected files" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/Team-Files-files\.zip$/);
  const reader = new ZipReader(new Uint8ArrayReader(await downloadBytes(download)));
  const entries = await reader.getEntries();
  expect(entries.map((entry) => entry.filename)).toEqual([`${folder}/${first}`]);
  await reader.close();

  await page.getByRole("button", { name: "Remove selected files" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("This removes 1 file from this Drive after the change is merged."),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select all", exact: true })).toBeDisabled();
  await expect(page.getByText(/^[1-9]\d* files selected$/)).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("drive-bulk-selection-and-actions.png"),
  });
});

test("Drive folder rename and deduplicated bulk removal each create one Change Request", async ({
  page,
}, testInfo) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const folder = `bulk-${suffix}`;
  const renamedFolder = `bulk-renamed-${suffix}`;
  const first = `first-${suffix}.txt`;
  const second = `second-${suffix}.txt`;
  const changeRequestCount = watchFileTreeChangeRequests(page);

  await page.goto("/dashboard/local/drive/team-files");
  await uploadFolder(page, folder, [first, second]);
  const baseline = changeRequestCount();

  await page.getByRole("button", { name: `Actions for folder ${folder}` }).click();
  await page.getByRole("menuitem", { name: "Rename folder" }).click();
  const renameDialog = page.getByRole("dialog");
  await expect(renameDialog.getByText(/keep all 2 files/)).toBeVisible();
  await renameDialog.getByLabel("Folder name").fill(renamedFolder);
  await renameDialog.getByRole("button", { name: "Rename folder now" }).click();
  await expect(
    page.getByRole("button", { name: `Actions for folder ${renamedFolder}` }),
  ).toBeVisible();
  expect(changeRequestCount() - baseline).toBe(1);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("drive-folder-renamed.png"),
  });

  await page.getByRole("button", { name: "Select Drive files" }).click();
  await page.getByRole("checkbox", { name: `Select ${renamedFolder}` }).click();
  await page.getByRole("checkbox", { name: `Select ${first}` }).click();
  await expect(page.getByText("2 files selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove selected files" }).click();
  const removeDialog = page.getByRole("dialog");
  await expect(
    removeDialog.getByText("This removes 2 files from this Drive after the change is merged."),
  ).toBeVisible();
  const beforeRemove = changeRequestCount();
  await removeDialog.getByRole("button", { name: "Remove now" }).click();
  await expect(page.getByRole("treeitem", { name: first, exact: true })).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: second, exact: true })).toHaveCount(0);
  await expect.poll(() => changeRequestCount() - beforeRemove).toBe(1);

  const removableFolder = `folder-remove-${suffix}`;
  const removableFirst = `remove-first-${suffix}.txt`;
  const removableSecond = `remove-second-${suffix}.txt`;
  await uploadFolder(page, removableFolder, [removableFirst, removableSecond]);
  await page.getByRole("button", { name: `Actions for folder ${removableFolder}` }).click();
  await page.getByRole("menuitem", { name: "Remove folder" }).click();
  const folderRemoveDialog = page.getByRole("dialog");
  await expect(
    folderRemoveDialog.getByText(
      "This removes 2 files from this Drive after the change is merged.",
    ),
  ).toBeVisible();
  const beforeFolderRemove = changeRequestCount();
  await folderRemoveDialog.getByRole("button", { name: "Remove now" }).click();
  await expect(page.getByRole("treeitem", { name: removableFirst, exact: true })).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: removableSecond, exact: true })).toHaveCount(0);
  await expect.poll(() => changeRequestCount() - beforeFolderRemove).toBe(1);
});

test("Drive bulk controls remain usable on a narrow viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/dashboard/local/drive/team-files");
  await page.getByRole("button", { name: "Select Drive files" }).click();
  await page.getByRole("checkbox", { name: "Select README.md" }).click();

  const [clearBox, downloadBox, removeBox] = await Promise.all([
    page.getByRole("button", { name: "Clear", exact: true }).boundingBox(),
    page.getByRole("button", { name: "Download selected files" }).boundingBox(),
    page.getByRole("button", { name: "Remove selected files" }).boundingBox(),
  ]);
  for (const box of [clearBox, downloadBox, removeBox]) {
    expect(box).not.toBeNull();
    expect((box?.x ?? 390) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  }
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("drive-bulk-actions-mobile.png"),
  });
});
