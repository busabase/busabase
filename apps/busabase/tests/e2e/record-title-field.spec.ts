import type { BaseVO, RecordVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

test("Base Design changes the record title used by Gallery", async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const baseSlug = `record-title-${suffix}`;
  const tableViewSlug = `table-${suffix}`;
  const viewSlug = `gallery-${suffix}`;
  const originalTitle = `Original title ${suffix}`;
  const nextTitle = `Promoted summary ${suffix}`;
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        fields: [
          { name: "Title", required: true, slug: "title", type: "text" },
          { name: "Summary", required: true, slug: "summary", type: "text" },
        ],
        name: `Record Title ${suffix}`,
        slug: baseSlug,
      },
    }),
  );
  const record = await json<RecordVO>(
    await request.post(`/api/v1/bases/${base.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: { summary: nextTitle, title: originalTitle },
        message: "Create record-title browser fixture",
        submittedBy: "playwright",
      },
    }),
  );
  const titleField = base.fields.find((field) => field.slug === "title");
  const summaryField = base.fields.find((field) => field.slug === "summary");
  if (!titleField || !summaryField) throw new Error("Expected title and summary fields");

  await page.goto(`/dashboard/local/base/${baseSlug}`);
  await page.getByRole("button", { name: "New view" }).click();
  const tableViewDialog = page.getByRole("dialog");
  await tableViewDialog.getByLabel("Name").fill("Record title Table");
  await tableViewDialog.getByLabel("Slug").fill(tableViewSlug);
  await tableViewDialog.getByRole("button", { name: "Add View Now" }).click();

  await expect(page.getByTestId(`field-drag-handle-${titleField.slug}`)).toHaveCount(0);
  await page.getByTestId(`field-header-actions-${titleField.slug}`).click();
  await expect(page.getByRole("button", { name: "Move left" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move right" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Hide field" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(`field-drag-handle-${summaryField.slug}`)).toBeVisible();
  await page.getByTestId(`field-header-actions-${summaryField.slug}`).click();
  await expect(page.getByRole("button", { name: "Move left" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "New view" }).click();
  const newViewDialog = page.getByRole("dialog");
  await newViewDialog.getByLabel("Name").fill("Record title Gallery");
  await newViewDialog.getByLabel("Slug").fill(viewSlug);
  await newViewDialog.getByRole("button", { name: "Gallery" }).click();
  await newViewDialog.getByRole("button", { name: "Add View Now" }).click();

  const card = page.locator(`[data-record-id="${record.id}"]`);
  await expect(card.getByRole("link", { name: originalTitle, exact: true })).toBeVisible();
  await page.getByTestId("view-control-fields").click();
  await expect(page.getByTestId("fixed-record-title-hint")).toHaveCount(0);
  const viewRecordTitleBadge = page.getByTestId(`view-record-title-${titleField.id}`);
  await expect(viewRecordTitleBadge).toBeVisible();
  const primaryFieldRow = page.locator('[data-view-field-slug="title"]');
  await expect(primaryFieldRow.getByRole("checkbox")).toBeChecked();
  await expect(primaryFieldRow.getByRole("checkbox")).toBeDisabled();
  await expect(primaryFieldRow.getByRole("button", { name: "Move Title up" })).toBeDisabled();
  await expect(primaryFieldRow.getByRole("button", { name: "Move Title down" })).toBeDisabled();
  await viewRecordTitleBadge.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "This Base record title is always visible and fixed first. Change it in Base Design.",
  );
  await page.getByTestId("view-editor-discard").click();

  await page.goto(`/dashboard/local/base/${baseSlug}/design`);
  const designRecordTitleBadge = page.getByTestId(`record-title-${titleField.id}`);
  await expect(designRecordTitleBadge).toBeVisible();
  await expect(
    page.getByText("Used in search, relationships, record pages, and record titles across views."),
  ).toHaveCount(0);
  await designRecordTitleBadge.focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "Identifies records in search, relationships, record pages, and every view. Table views always keep this field first.",
  );
  await page.getByTestId(`set-record-title-${summaryField.id}`).click();

  const recordTitleDialog = page.getByRole("dialog", { name: "Set record title field?" });
  await expect(recordTitleDialog).toContainText("Summary");
  await recordTitleDialog.getByRole("button", { name: "Change title now" }).click();
  await expect(recordTitleDialog).toBeHidden();
  await expect(page.getByTestId(`record-title-${summaryField.id}`)).toBeVisible();

  await page.goto(`/dashboard/local/base/${baseSlug}/${viewSlug}`);
  await expect(card.getByRole("link", { name: nextTitle, exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: originalTitle, exact: true })).toHaveCount(0);
});
