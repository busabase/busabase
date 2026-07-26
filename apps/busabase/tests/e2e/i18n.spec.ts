import { expect, openSettingsDialog, test } from "./_fixtures";

// Sidebar nav labels come from busabase-core's i18n catalog (CoreDashboardShell
// receives the resolved locale), and the language preference defaults to "Auto"
// (follow the browser language via detectBrowserLocale).

test("sidebar nav localizes on language switch (zh-CN)", async ({ page }) => {
  // Two localized rows are assertable from /inbox: the pinned Home row, and the
  // contextual Inbox row that being *on* Inbox surfaces (Activity/Archive/Assets
  // are workspace-menu entries now, so they have no resting sidebar row).
  await page.goto("/dashboard/local/inbox");
  await page.evaluate(() => window.localStorage.setItem("busabaseLocale", "zh-CN"));
  await page.reload();
  await expect(page.getByRole("link", { name: "首页" })).toBeVisible();
  await expect(page.getByRole("link", { name: "收件箱" })).toBeVisible();
});

test("language switcher defaults to Auto (no stored preference)", async ({ page }) => {
  await page.goto("/dashboard/local/inbox");
  await page.evaluate(() => window.localStorage.removeItem("busabaseLocale"));
  await page.reload();
  await openSettingsDialog(page);
  await expect(page.getByText("Auto", { exact: true }).first()).toBeVisible();
});
