import { expect, test } from "./_fixtures";

// Sidebar nav labels come from busabase-core's i18n catalog (CoreDashboardShell
// receives the resolved locale), and the language preference defaults to "Auto"
// (follow the browser language via detectBrowserLocale).

test("sidebar nav localizes on language switch (zh-CN)", async ({ page }) => {
  await page.goto("/dashboard/inbox");
  await page.evaluate(() => window.localStorage.setItem("busabaseLocale", "zh-CN"));
  await page.reload();
  await expect(page.getByRole("link", { name: "收件箱" })).toBeVisible();
  await expect(page.getByRole("link", { name: "动态" })).toBeVisible();
});

test("language switcher defaults to Auto (no stored preference)", async ({ page }) => {
  await page.goto("/dashboard/inbox");
  await page.evaluate(() => window.localStorage.removeItem("busabaseLocale"));
  await page.reload();
  await page.getByRole("button", { name: /Busabase/ }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Auto", { exact: true }).first()).toBeVisible();
});
