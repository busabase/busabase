import { expect, test } from "@playwright/test";

// `lookup` columns were briefly excluded from the view filter/sort condition
// pickers on the theory that they can't be pushed down to SQL. They can't — but
// neither can select/relation/date, and the CLIENT filter (which is the
// authoritative one) reads the resolved lookup value straight off the record.
// Excluding them was over-restrictive; this guards against re-introducing it.
//
// Read-only on purpose: it adds a condition row to inspect the field picker but
// never saves the view, so it can't disturb the shared demo dataset.
test("lookup columns are offered as view filter and sort conditions", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/dashboard/local/base/invoices/needs-ap-review", { waitUntil: "commit" });
  await expect(page.getByTestId("view-control-filters")).toBeVisible({ timeout: 30000 });

  await page.getByTestId("view-control-filters").click();
  const filters = page.getByTestId("shared-view-filters");
  // Add a row rather than relying on the view already having one — otherwise
  // this passes or fails on seed state instead of on the picker's contents.
  await page.getByRole("button", { name: /add filter/i }).click();
  await expect(
    filters.locator("select").first().locator("option", { hasText: "PO Budget" }),
  ).toHaveCount(1);

  // Escape is intentionally swallowed once the draft is dirty, so discard
  // explicitly — this also throws away the filter row, leaving the view untouched.
  await page.getByTestId("view-editor-discard").click();
  await page.getByTestId("view-control-sorts").click();
  const sorts = page.getByTestId("shared-view-sorts");
  await page.getByRole("button", { name: /add sort/i }).click();
  await expect(
    sorts.locator("select").first().locator("option", { hasText: "PO Budget" }),
  ).toHaveCount(1);
});
