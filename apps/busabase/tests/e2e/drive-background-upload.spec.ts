import type { Page, Route } from "@playwright/test";
import { expect, test } from "./_fixtures";

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
  page.on("request", (request) => {
    calls.push(...logicalRpcUrls(request.url(), request.postData()));
  });
  return () => calls.filter((url) => /fileTrees(?:%2F|\/|\.)createChangeRequest/i.test(url)).length;
};

const chooseFiles = async (page: Page, files: Array<{ name: string; body: string }>) => {
  await page.locator('input[type="file"]').setInputFiles(
    files.map((file) => ({
      buffer: Buffer.from(file.body),
      mimeType: "text/plain",
      name: file.name,
    })),
  );
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Upload files" }),
  ).toBeVisible();
};

const continueAfter = async (route: Route, release: Promise<void>) => {
  await release;
  try {
    await route.continue();
  } catch {
    // Cancelling the XHR while this route is held closes the request before
    // Playwright can continue it. That is the expected cancellation path.
  }
};

test("Drive upload leaves the dialog, survives SPA navigation, and refreshes on return", async ({
  page,
}, testInfo) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const name = `background-navigation-${suffix}.txt`;
  let releaseUpload = () => {};
  let uploadReached = () => {};
  const heldUpload = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const reachedUpload = new Promise<void>((resolve) => {
    uploadReached = resolve;
  });

  await page.route("**/api/storage/upload**", async (route) => {
    uploadReached();
    await continueAfter(route, heldUpload);
  });

  try {
    await page.goto("/dashboard/local/drive/team-files");
    await chooseFiles(page, [{ name, body: `delayed navigation ${suffix}\n` }]);
    await page.getByRole("dialog").getByRole("button", { name: "Upload now" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await reachedUpload;
    await expect(page.getByRole("complementary", { name: "Uploads" })).toBeVisible();
    await expect(page.getByText("Uploading files")).toBeVisible();

    await page.getByRole("link", { exact: true, name: "Home" }).click();
    await expect(page).toHaveURL(/\/dashboard\/local\/home$/);
    await expect(page.getByRole("complementary", { name: "Uploads" })).toBeVisible();
    await expect(page.getByText("Uploading files")).toBeVisible();

    releaseUpload();
    await expect(page.getByText("Upload complete")).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("drive-background-upload-after-navigation.png"),
    });

    await page.getByRole("link", { exact: true, name: "Team Files" }).click();
    await expect(page.getByRole("treeitem", { exact: true, name })).toBeVisible();
  } finally {
    releaseUpload();
  }
});

test("Drive upload can be cancelled before it creates a Change Request", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const changeRequestCount = watchFileTreeChangeRequests(page);
  let releaseUpload = () => {};
  let uploadReached = () => {};
  const heldUpload = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const reachedUpload = new Promise<void>((resolve) => {
    uploadReached = resolve;
  });

  await page.route("**/api/storage/upload**", async (route) => {
    uploadReached();
    await continueAfter(route, heldUpload);
  });

  try {
    await page.goto("/dashboard/local/drive/team-files");
    await chooseFiles(page, [
      { name: `background-cancel-${suffix}.txt`, body: `cancel ${suffix}\n` },
    ]);
    await page.getByRole("dialog").getByRole("button", { name: "Upload now" }).click();
    await reachedUpload;

    await page.getByRole("button", { exact: true, name: "Cancel" }).click();
    await expect(page.getByText("Upload cancelled")).toBeVisible();
    releaseUpload();
    await page.waitForTimeout(300);
    expect(changeRequestCount()).toBe(0);
  } finally {
    releaseUpload();
  }
});

test("Drive retry keeps successful children and submits one immediate Change Request", async ({
  page,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const firstName = `background-retry-first-${suffix}.txt`;
  const secondName = `background-retry-second-${suffix}.txt`;
  const changeRequestCount = watchFileTreeChangeRequests(page);
  let storageAttempts = 0;

  await page.route("**/api/storage/upload**", async (route) => {
    storageAttempts += 1;
    if (storageAttempts === 2) {
      await route.fulfill({ body: "temporary upload failure", status: 500 });
      return;
    }
    await route.continue();
  });

  await page.goto("/dashboard/local/drive/team-files");
  await chooseFiles(page, [
    { name: firstName, body: `first successful upload ${suffix}\n` },
    { name: secondName, body: `second retry upload ${suffix}\n` },
  ]);
  await page.getByRole("dialog").getByRole("button", { name: "Upload now" }).click();

  await expect(page.getByText("Upload failed", { exact: true })).toBeVisible();
  expect(storageAttempts).toBe(2);
  expect(changeRequestCount()).toBe(0);

  await page.getByRole("button", { exact: true, name: "Retry" }).click();
  await expect(page.getByText("Upload complete")).toBeVisible();
  expect(storageAttempts).toBe(3);
  expect(changeRequestCount()).toBe(1);
  await expect(page.getByRole("treeitem", { exact: true, name: firstName })).toBeVisible();
  await expect(page.getByRole("treeitem", { exact: true, name: secondName })).toBeVisible();
});

test("Drive review upload stays in place and creates one multi-file Change Request", async ({
  page,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const changeRequestCount = watchFileTreeChangeRequests(page);

  await page.goto("/dashboard/local/drive/team-files");
  await chooseFiles(page, [
    { name: `background-review-first-${suffix}.txt`, body: `review first ${suffix}\n` },
    { name: `background-review-second-${suffix}.txt`, body: `review second ${suffix}\n` },
  ]);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "More submit options" }).click();
  await dialog.getByRole("button", { name: "Request upload" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Upload ready for review")).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/local\/drive\/team-files$/);
  await expect.poll(changeRequestCount).toBe(1);

  await page.getByRole("button", { exact: true, name: "Review" }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/inbox\//);
});
