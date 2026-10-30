import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import { type APIRequestContext, dragSortableTo, expect, json, test } from "./_fixtures";

// The server rejects an attachment reference it never stored, so the cover is uploaded for real.
const uploadCover = async (request: APIRequestContext) => {
  const fileName = "blog-cms-base.png";
  const bytes = await readFile(
    path.resolve(process.cwd(), "public/assets/readme/scenarios", fileName),
  );
  const requested = await json<{ storageKey: string; uploadUrl: string }>(
    await request.post("/api/v1/assets/upload-urls", {
      data: { fileName, mimeType: "image/png", sizeBytes: bytes.byteLength },
    }),
  );
  const uploaded = await request.put(requested.uploadUrl, {
    data: bytes,
    headers: { "content-type": "image/png" },
  });
  expect(uploaded.ok(), `Cover upload failed: ${uploaded.status()}`).toBe(true);
  const confirmed = await json<{ attachmentId: string }>(
    await request.post("/api/v1/assets/confirmations", {
      data: {
        fileName,
        mimeType: "image/png",
        sizeBytes: bytes.byteLength,
        storageKey: requested.storageKey,
      },
    }),
  );
  return { fileName, size: bytes.byteLength, attachmentId: confirmed.attachmentId };
};

test("new view opens in a modal without navigating away from the base", async ({ page }) => {
  await page.goto("/dashboard/local/base/blog?demo=blog");
  // The bare Base route opens the leftmost saved view, keeping `?demo`.
  await expect(page).toHaveURL(/\/dashboard\/local\/base\/blog\/all-records\?demo=blog$/);

  const newViewButton = page.getByRole("button", { name: "New view" });
  await expect(newViewButton).toBeVisible();
  await newViewButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "New View" })).toBeVisible();
  await expect(dialog).toContainText("Name");
  await expect(dialog.locator(":focus")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add View Now" })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/local\/base\/blog\/all-records\?demo=blog$/);

  const fieldsEditor = dialog.getByTestId("new-view-shared-fields");
  const draggableRows = fieldsEditor.locator(
    '[data-view-field-slug]:has([data-testid^="view-field-drag-handle-"])',
  );
  const firstDraggableSlug = await draggableRows.first().getAttribute("data-view-field-slug");
  const secondDraggableSlug = await draggableRows.nth(1).getAttribute("data-view-field-slug");
  // The dialog scrolls as a whole and dnd-kit autoscrolls it when the pointer nears the bottom
  // edge. On a short viewport the first rows sit just above that edge, below the "automatically
  // show new fields" option, so bring them to the middle before dragging.
  await draggableRows.first().evaluate((row) => row.scrollIntoView({ block: "center" }));
  await dragSortableTo(
    page,
    draggableRows.first().getByRole("button", { name: /Drag to reorder/ }),
    draggableRows.nth(1),
  );
  const reorderedSlugs = await draggableRows.evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-view-field-slug")),
  );
  expect(reorderedSlugs).toEqual([
    secondDraggableSlug,
    firstDraggableSlug,
    ...reorderedSlugs.slice(2),
  ]);

  // "Add View Request" (review-first) lives behind the split-button dropdown as
  // a menuitem — "Add View Now" is the primary immediate action by default. The
  // dropdown content is a Radix portal rendered as a sibling of the dialog in
  // `document.body`, not nested inside it, so it has to be found from `page`.
  await dialog.getByRole("button", { name: "More submit options" }).click();
  const addViewRequestItem = page.getByRole("menuitem", { name: "Add View Request" });
  await expect(addViewRequestItem).toBeVisible();
  // Escape closes the topmost open layer first — the dropdown, not the dialog
  // underneath it — so it takes two presses to get back to a closed dialog.
  await page.keyboard.press("Escape");
  await expect(addViewRequestItem).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("new Gallery view keeps its selected type and Auto cover after immediate creation", async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const baseSlug = `gallery-base-${suffix}`;
  const recordTitle = `Gallery cover ${suffix}`;
  const viewName = `Gallery regression ${suffix}`;
  const viewSlug = `gallery-regression-${suffix}`;
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        fields: [
          { name: "Title", required: true, slug: "title", type: "text" },
          { name: "Cover", slug: "cover", type: "attachment" },
        ],
        name: `Gallery Base ${suffix}`,
        slug: baseSlug,
      },
    }),
  );
  const cover = await uploadCover(request);
  await json<RecordVO>(
    await request.post(`/api/v1/bases/${base.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: {
          cover: [
            {
              attachmentId: cover.attachmentId,
              fileName: cover.fileName,
              mimeType: "image/png",
              size: cover.size,
              url: "/assets/readme/scenarios/blog-cms-base.png",
            },
          ],
          title: recordTitle,
        },
        message: "Create Gallery Auto cover fixture",
        submittedBy: "playwright",
      },
    }),
  );

  await page.goto(`/dashboard/local/base/${baseSlug}`);
  await expect(page).toHaveURL(new RegExp(`/dashboard/local/base/${baseSlug}/grid-view$`));
  await page.getByRole("button", { name: "New view" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(viewName);
  await dialog.getByLabel("Slug").fill(viewSlug);
  await dialog.getByRole("button", { name: "Gallery" }).click();
  await dialog.getByRole("button", { name: "Add View Now" }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/local/base/${baseSlug}/${viewSlug}$`));
  await expect(page.getByTestId("base-gallery")).toBeVisible();
  await expect(page.getByTestId("base-records-grid")).toHaveCount(0);
  await expect(page.getByRole("img", { name: recordTitle })).toBeVisible();

  await expect
    .poll(async () => {
      const views = await json<ViewVO[]>(await request.get(`/api/v1/bases/${base.id}/views`));
      const view = views.find((candidate) => candidate.slug === viewSlug);
      return {
        coverMode:
          view?.config.coverFieldSlug === null
            ? "none"
            : view?.config.coverFieldSlug === undefined
              ? "auto"
              : view.config.coverFieldSlug,
        type: view?.type,
      };
    })
    .toEqual({ coverMode: "auto", type: "gallery" });
});
