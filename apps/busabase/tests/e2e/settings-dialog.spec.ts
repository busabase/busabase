import { expect, type Page, test } from "./_fixtures";

// The sidebar app-menu (Busabase logo dropdown) has a single "Settings" entry
// that opens a dialog containing the language switcher (moved out of the
// dropdown itself so the language list isn't mixed in with navigation items).

const openSettingsDialog = async (page: Page) => {
  const trigger = page.getByRole("button", { name: /Busabase/ });
  const menuItem = page.getByRole("menuitem", { name: "Settings" });

  // The streamed dashboard markup can become visible just before React attaches
  // the dropdown handler. Retry the trigger only while the menu is still closed.
  await expect
    .poll(
      async () => {
        if (!(await menuItem.isVisible())) await trigger.click();
        return menuItem.isVisible();
      },
      { message: "Settings menu should open after dashboard hydration" },
    )
    .toBe(true);
  await menuItem.click();
  await expect(page.getByRole("dialog")).toBeVisible();
};

test("Settings menu item opens the settings dialog", async ({ page }) => {
  await page.goto("/dashboard/local/inbox");
  await openSettingsDialog(page);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("switching language inside the settings dialog updates the UI", async ({ page }) => {
  await page.goto("/dashboard/local/inbox");
  await page.evaluate(() => window.localStorage.removeItem("busabaseLocale"));
  await page.reload();
  await openSettingsDialog(page);
  await page.getByRole("button", { name: "简体中文" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("link", { name: "收件箱" })).toBeVisible();
});
