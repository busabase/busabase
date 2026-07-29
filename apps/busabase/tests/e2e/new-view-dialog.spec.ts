import type { BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

test("new view opens in a modal without navigating away from the base", async ({ page }) => {
  await page.goto("/dashboard/local/base/blog?demo=blog");

  const newViewButton = page.getByRole("button", { name: "New view" });
  await expect(newViewButton).toBeVisible();
  await newViewButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "New View" })).toBeVisible();
  await expect(dialog).toContainText("Name");
  await expect(dialog.locator(":focus")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add View Now" })).toBeVisible();
  // "Add View Request" (review-first) lives behind the split-button dropdown —
  // "Add View Now" is the primary immediate action by default; see
  // changelog/20260722-submit-action-order-and-permissions.md.
  await dialog.getByRole("button", { name: "More submit options" }).click();
  await expect(dialog.getByRole("button", { name: "Add View Request" })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/local\/base\/blog\?demo=blog$/);

  await dialog.getByRole("button", { name: "Cancel" }).click();
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
  await json<RecordVO>(
    await request.post(`/api/v1/bases/${base.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: {
          cover: [
            {
              attachmentId: `att-gallery-cover-${suffix}`,
              fileName: "blog-cms-base.png",
              mimeType: "image/png",
              size: 1,
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
