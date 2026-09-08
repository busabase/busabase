import type { Locator } from "@playwright/test";
import { expect, test } from "./_fixtures";

test("Drive files can be previewed, uploaded, renamed, and removed", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const originalName = `drive-ui-${suffix}.md`;
  const renamedName = `drive-ui-${suffix}-renamed.md`;
  const folderName = `drive-ui-folder-${suffix}`;

  await page.goto("/dashboard/local/drive/team-files");
  await expect(
    page.getByRole("heading", { name: "Team Files", exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("A shared Drive for plain files", { exact: false })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from("# Drive GUI upload\n\nThis file was uploaded from the Drive interface.\n"),
    mimeType: "text/markdown",
    name: originalName,
  });
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Upload files" }),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("radio", { name: "onboarding" }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "New folder inside onboarding" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "New folder inside onboarding" })
    .click();
  await page.getByRole("dialog").getByLabel("Folder name").fill(folderName);
  await expect(
    page.getByRole("dialog").getByText("Parent folder", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText(/created inside onboarding/, { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("drive-upload-destination-picker.png"),
  });
  await page.getByRole("button", { name: "Upload now" }).click();

  await expect(page.getByRole("treeitem", { name: originalName, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Drive GUI upload" })).toBeVisible();

  await page.getByRole("button", { name: `Actions for ${originalName}` }).click();
  await page.getByRole("menuitem", { name: "Rename file" }).click();
  const renameDialog = page.getByRole("dialog");
  await renameDialog.getByLabel("New file name").fill(renamedName);
  await renameDialog.getByRole("button", { name: "Rename now" }).click();

  await expect(page.getByRole("treeitem", { name: renamedName, exact: true })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: originalName, exact: true })).toHaveCount(0);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("drive-file-actions.png") });

  await page.getByRole("button", { name: `Actions for ${renamedName}` }).click();
  await page.getByRole("menuitem", { name: "Remove from Drive" }).click();
  await expect(
    page.getByRole("dialog").getByText("underlying Asset", { exact: false }),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Remove now" }).click();

  await expect(page.getByRole("treeitem", { name: renamedName, exact: true })).toHaveCount(0);
});

test("Drive file names line up with sibling folder names and nest to the right", async ({
  page,
}) => {
  await page.goto("/dashboard/local/drive/team-files");
  await expect(page.getByRole("treeitem", { name: "README.md", exact: true })).toBeVisible();
  await page
    .getByRole("treeitem", { name: /onboarding/ })
    .first()
    .click();
  await expect(page.getByRole("treeitem", { name: "first-week.md", exact: true })).toBeVisible();

  // Read each row's own label position. A folder treeitem is a wrapper whose
  // first <button> is its row; a file treeitem is the button itself. Scoping to
  // that button's direct span children avoids picking up a child row's label
  // (a folder's accessible name also contains its children's names).
  const labelX = (row: Locator) =>
    row.evaluate((item: HTMLElement) => {
      const button = item.matches("button") ? item : item.querySelector("button");
      const own = Array.from(button?.children ?? []).find(
        (child) => child.tagName === "SPAN" && (child.textContent || "").trim().length > 0,
      );
      return Math.round((own as HTMLElement).getBoundingClientRect().left);
    });

  const [rootFolder, rootFile, nestedFile] = await Promise.all([
    labelX(page.getByRole("treeitem", { name: /onboarding/ }).first()),
    labelX(page.getByRole("treeitem", { name: "README.md", exact: true })),
    labelX(page.getByRole("treeitem", { name: "first-week.md", exact: true })),
  ]);

  // A root file lines up with the root folders beside it. Regression: the inline
  // indent sits on a folder's own button but on a file's wrapper, where the
  // button's px-2 added another 8px, so file names sat 8px to the right.
  expect(rootFile).toBe(rootFolder);
  // A file inside a folder still sits further right than the root level. A
  // per-level chevron-column rule broke this: dropping the spacer for a
  // folder-less level outweighed the depth step and pushed them 8px left.
  expect(nestedFile).toBeGreaterThan(rootFile);
});

test("Drive preview and file controls remain usable on a narrow viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/dashboard/local/drive/team-files");

  await expect(page.getByRole("button", { name: "Upload files" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "README.md", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toBeVisible();
  // The Drive root holds both files and folders, so a root file keeps the
  // chevron-width spacer and its name lines up with the folder names.
  await expect(
    page
      .getByRole("treeitem", { name: "README.md", exact: true })
      .locator('span[class="size-4 shrink-0"]'),
  ).toHaveCount(1);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("drive-file-actions-mobile.png"),
  });
});

test("Drive previews an uploaded SVG as an image, not as source", async ({ page }, testInfo) => {
  const name = `svg-preview-${Date.now()}.svg`;
  await page.goto("/dashboard/local/drive/team-files");
  await expect(
    page.getByRole("heading", { name: "Team Files", exact: true }).first(),
  ).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">' +
        '<rect width="120" height="60" fill="#3366ff"/></svg>\n',
    ),
    mimeType: "image/svg+xml",
    name,
  });
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Upload files" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Upload now" }).click();
  await expect(page.getByRole("treeitem", { name, exact: true })).toBeVisible();

  // An SVG arrives as utf8 text labelled text/plain, so it used to render as
  // source in a code block with no <img> at all.
  const preview = page.locator("main.flex.min-h-0");
  const image = preview.locator("img");
  await expect(image).toHaveCount(1);

  const decoded = await image.evaluate((el: HTMLImageElement) =>
    (el.complete
      ? Promise.resolve()
      : new Promise((resolve) => {
          el.addEventListener("load", resolve, { once: true });
          el.addEventListener("error", resolve, { once: true });
        })
    ).then(() => ({ naturalHeight: el.naturalHeight, naturalWidth: el.naturalWidth })),
  );
  expect(decoded.naturalWidth).toBeGreaterThan(0);
  expect(decoded.naturalHeight).toBeGreaterThan(0);

  await page.screenshot({ fullPage: true, path: testInfo.outputPath("drive-svg-preview.png") });
});

test("Drive upload keeps the chosen destination when files are re-picked", async ({ page }) => {
  await page.goto("/dashboard/local/drive/team-files");

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    buffer: Buffer.from("first pick\n"),
    mimeType: "text/plain",
    name: "repick-first.txt",
  });

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Upload files" })).toBeVisible();
  await dialog.getByRole("radio", { name: "onboarding" }).click();
  await expect(dialog.getByRole("radio", { name: "onboarding" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Re-picking from the already-open dialog must not snap the destination back
  // to the default folder — the user cannot see that happen mid-dialog.
  await fileInput.setInputFiles({
    buffer: Buffer.from("second pick\n"),
    mimeType: "text/plain",
    name: "repick-second.txt",
  });

  await expect(dialog.getByText("repick-second.txt")).toBeVisible();
  await expect(dialog.getByText("repick-first.txt")).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "onboarding" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("Drive upload reports a bad new-folder name as a folder-name problem", async ({ page }) => {
  await page.goto("/dashboard/local/drive/team-files");

  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from("copy check\n"),
    mimeType: "text/plain",
    name: "folder-name-check.txt",
  });

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Upload files" })).toBeVisible();
  await dialog.getByRole("button", { name: /New folder inside/ }).click();
  await dialog.getByLabel("Folder name").fill("nested/name");

  // The generic "Enter a valid relative Drive folder path." fallback used to
  // cover this, which points the user at the wrong field.
  await expect(dialog.getByText("Enter a folder name without slashes.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Upload now" })).toBeDisabled();
});

test("Drive upload actions remain visible with many selected files", async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 600, width: 900 });
  await page.goto("/dashboard/local/drive/team-files");

  await page.locator('input[type="file"]').setInputFiles(
    Array.from({ length: 14 }, (_, index) => ({
      buffer: Buffer.from(`file ${index + 1}\n`),
      mimeType: "text/plain",
      name: `overflow-check-${index + 1}.txt`,
    })),
  );

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Files", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Choose files" })).toBeVisible();
  const uploadButton = dialog.getByRole("button", { name: "Upload now" });
  await expect(uploadButton).toBeVisible();
  const buttonBox = await uploadButton.boundingBox();
  expect(buttonBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(600);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("drive-upload-overflow.png"),
  });
});
