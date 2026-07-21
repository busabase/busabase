import { expect, test } from "./_fixtures";

const designUrl = "/dashboard/local/base/blog/design?demo=blog";

test("Add Field opens in a responsive modal and cancel preserves the design page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(designUrl);

  const fields = page.locator("[data-base-fields]");
  const addFieldButton = page.getByRole("button", { name: "Add Field", exact: true });
  await expect(fields).toBeVisible();
  await expect(addFieldButton).toBeVisible();
  const initialUrl = page.url();
  const initialFieldsHeight = await fields.evaluate(
    (element) => (element as HTMLElement).offsetHeight,
  );

  await addFieldButton.click();

  const dialog = page.getByRole("dialog", { name: "Add Field" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(initialUrl);
  await expect
    .poll(() => fields.evaluate((element) => (element as HTMLElement).offsetHeight))
    .toBe(initialFieldsHeight);
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= 0 &&
          bounds.right <= window.innerWidth &&
          element.scrollWidth <= bounds.width
        );
      }),
    )
    .toBe(true);

  await dialog.locator("input").first().fill("Temporary field");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(initialUrl);

  await addFieldButton.click();
  await expect(dialog.locator("input").first()).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("Rename Field opens in a modal without expanding the field list", async ({ page }) => {
  await page.goto(designUrl);

  const fields = page.locator("[data-base-fields]");
  const renameButton = page.getByRole("button", { name: "Rename Title", exact: true });
  await expect(fields).toBeVisible();
  const initialUrl = page.url();
  const initialFieldsHeight = await fields.evaluate(
    (element) => (element as HTMLElement).offsetHeight,
  );

  await renameButton.click();

  const dialog = page.getByRole("dialog", { name: /Rename field: Title/i });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(initialUrl);
  await expect
    .poll(() => fields.evaluate((element) => (element as HTMLElement).offsetHeight))
    .toBe(initialFieldsHeight);

  await dialog.locator("input").first().fill("Temporary title");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(initialUrl);
  await expect
    .poll(() => fields.evaluate((element) => (element as HTMLElement).offsetHeight))
    .toBe(initialFieldsHeight);

  await renameButton.click();
  await expect(dialog.locator("input").first()).toHaveValue("Title");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});
