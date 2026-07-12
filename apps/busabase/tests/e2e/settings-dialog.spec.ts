import { expect, test } from "./_fixtures";

// The sidebar app-menu (Busabase logo dropdown) has a single "Settings" entry
// that opens a dialog containing the language switcher (moved out of the
// dropdown itself so the language list isn't mixed in with navigation items).

test("Settings menu item opens the settings dialog", async ({ page }) => {
  await page.goto("/dashboard/inbox");
  await page.getByRole("button", { name: /Busabase/ }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("switching language inside the settings dialog updates the UI", async ({ page }) => {
  await page.goto("/dashboard/inbox");
  await page.evaluate(() => window.localStorage.removeItem("busabaseLocale"));
  await page.reload();
  await page.getByRole("button", { name: /Busabase/ }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "简体中文" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("link", { name: "收件箱" })).toBeVisible();
});
