import { expect, test } from "./_fixtures";

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
