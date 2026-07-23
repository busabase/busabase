import type { BaseVO, ChangeRequestVO, ViewVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

test("field header actions require a saved view and support keyboard quick sorting", async ({
  page,
  request,
}) => {
  const bases = await json<BaseVO[]>(await request.get("/api/v1/bases"));
  const blog = bases.find((base) => base.slug === "blog");
  if (!blog) {
    throw new Error("The seeded blog base is required for the field header actions test");
  }

  const viewSlug = `field-header-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const createViewRequest = await json<ChangeRequestVO>(
    await request.post(`/api/v1/bases/${blog.id}/views/change-requests`, {
      data: {
        config: { filters: [], sorts: [] },
        name: "Field header actions",
        slug: viewSlug,
        submittedBy: "playwright",
      },
    }),
  );
  await json(
    await request.post(`/api/v1/change-requests/${createViewRequest.id}/reviews`, {
      data: { verdict: "approved" },
    }),
  );
  const merged = await json<{ view: ViewVO | null }>(
    await request.post(`/api/v1/change-requests/${createViewRequest.id}/merge`, { data: {} }),
  );
  if (!merged.view) {
    throw new Error("Expected the field header actions saved view to be merged");
  }

  await page.goto("/dashboard/local/base/blog");

  const allViewAction = page.getByRole("button", { name: "Actions for Title" });
  await allViewAction.focus();
  await page.keyboard.press("Enter");
  const savedViewPrompt = page.getByText(/Create or open a saved view to sort, filter/);
  await expect(savedViewPrompt).toBeVisible();
  await savedViewPrompt
    .locator("xpath=..")
    .getByRole("button", { name: "New view", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "New View" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  await page.goto(`/dashboard/local/base/blog/${merged.view.slug}`);
  const titleHeader = page.locator('[role="columnheader"][data-field-slug="title"]');
  const titleAction = titleHeader.getByRole("button", { name: "Actions for Title" });
  await titleAction.focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("header-view-sort-title").click();
  let editor = page.getByTestId("shared-view-config-editor");
  await expect(editor).toHaveAttribute("data-editor-source", "header");
  await expect(editor.getByTestId("header-contextual-view-editor")).toContainText("Title");
  const focusedSort = editor.locator('[data-focused-condition="true"]');
  await expect(focusedSort.getByLabel("Sort 1 field")).toHaveValue(blog.fields[0].id);
  await expect(focusedSort.getByLabel("Sort 1 field")).toBeFocused();
  await editor.getByTestId("view-editor-discard").click();

  await titleAction.click();
  await page.getByTestId("header-view-filter-title").click();
  editor = page.getByTestId("shared-view-config-editor");
  await expect(editor).toHaveAttribute("data-editor-source", "header");
  await expect(editor.getByTestId("header-contextual-view-editor")).toContainText("Title");
  const focusedFilter = editor.locator('[data-focused-condition="true"]');
  await expect(focusedFilter.getByLabel("Filter 1 field")).toHaveValue(blog.fields[0].id);
  await expect(focusedFilter.getByLabel("Filter 1 field")).toBeFocused();
  await editor.getByTestId("view-editor-discard").click();

  const coverHeader = page.locator('[role="columnheader"][data-field-slug="cover_image"]');
  await coverHeader.getByRole("button", { name: "Actions for Cover Image" }).click();
  await expect(page.getByRole("link", { name: "Edit field" })).toHaveAttribute(
    "href",
    "/dashboard/local/base/blog/design",
  );
  await page.getByRole("button", { name: "Hide field" }).click();
  await expect(coverHeader).toHaveCount(0);
});

test("record status is the final responsive grid column", async ({ page }) => {
  await page.goto("/dashboard/local/base/field-type-lab");
  const grid = page.getByTestId("base-records-grid");
  const headers = grid.getByRole("columnheader");
  const statusHeader = headers.last();

  await expect(statusHeader).toHaveText("Record status");
  await expect(statusHeader).toHaveAttribute("aria-label", "Record status");
  await expect(grid.getByRole("columnheader", { name: "Commit" })).toHaveCount(0);
  await expect
    .poll(() => statusHeader.evaluate((element) => getComputedStyle(element).position))
    .toBe("sticky");

  await page.setViewportSize({ height: 844, width: 390 });
  await expect
    .poll(() => statusHeader.evaluate((element) => getComputedStyle(element).position))
    .toBe("static");
});
