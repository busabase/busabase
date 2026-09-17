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

test("a Chinese demo localizes Home, activity, and sidebar across navigation", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("busabaseLocale"));
  await page.goto("/dashboard/local/inbox?demo=1&lang=zh-CN");
  await expect(page.getByRole("link", { name: "首页", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/home\?demo=1&lang=zh-CN$/);
  await expect(page.getByText("最近动态", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "调整侧栏宽度" })).toBeAttached();
  await expect(page.getByTitle("拖动以调整顺序").first()).toBeAttached();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

test("an explicit language preference overrides the demo URL locale", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("busabaseLocale", "en"));
  await page.goto("/dashboard/local/home?demo=1&lang=zh-CN");
  await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByText("Recent activity", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("a Japanese deep link localizes the non-demo dashboard", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("busabaseLocale"));
  await page.goto("/dashboard/local/home?lang=ja");
  await expect(page.getByRole("link", { name: "ホーム", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "検索" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
});

test("the first server-rendered dashboard document uses the explicit URL locale", async ({
  request,
}) => {
  const japanese = await request.get("/dashboard/local/home?lang=ja", {
    headers: { "Accept-Language": "en" },
  });
  expect(japanese.status()).toBe(200);
  expect(await japanese.text()).toContain('<html lang="ja"');

  const englishDemo = await request.get("/dashboard/local/home?demo=1&lang=ja", {
    headers: { "Accept-Language": "zh-CN" },
  });
  expect(englishDemo.status()).toBe(200);
  expect(await englishDemo.text()).toContain('<html lang="en"');
});

test("the workspace menu preserves an explicit Japanese URL locale", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("busabaseLocale"));
  await page.goto("/dashboard/local/home?lang=ja");
  await expect(page.getByRole("link", { name: "ホーム", exact: true })).toBeVisible();
  const workspaceButton = page.getByRole("button", { name: /ローカル Busabase/ });
  const activityItem = page.getByRole("menuitem", { name: "アクティビティ" });
  await expect
    .poll(
      async () => {
        if (!(await activityItem.isVisible())) await workspaceButton.click();
        return activityItem.isVisible();
      },
      { message: "Workspace menu should open after dashboard hydration" },
    )
    .toBe(true);
  await activityItem.click();
  await expect(page).toHaveURL(/\/dashboard\/local\/activity\?lang=ja$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
});

test("Cloud Connect shows an actionable translated invalid-URL error", async ({ page }) => {
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.route("**/api/cloud-connect/connect", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "A valid Cloud URL is required." }),
    }),
  );
  await page.goto("/dashboard/local/inbox");
  await openSettingsDialog(page);
  await page.getByRole("button", { name: "简体中文" }).click();
  await page.getByRole("button", { name: "云端连接", exact: true }).click();
  await page.getByRole("textbox", { name: "云端地址" }).fill("not-a-url");
  await page.getByRole("button", { name: "连接到 Busabase Cloud" }).click();
  await expect(page.getByText("请输入有效的 Busabase Cloud 地址。")).toBeVisible();
  await expect(page.getByText("启动云端连接流程失败，请重试。")).toHaveCount(0);
});

test("Agents, Templates, and graph controls use Chinese UI labels", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("busabaseLocale", "zh-CN"));

  await page.goto("/dashboard/local/agents/new?demo=1&lang=zh-CN");
  await expect(page.getByRole("heading", { name: "添加 Agent" })).toBeVisible();
  await expect(page.getByText("此 Agent 暂不可用。").first()).toBeVisible();

  await page.goto("/dashboard/local/templates?demo=1&lang=zh-CN");
  await expect(page.getByRole("heading", { name: "模板", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("搜索模板…")).toBeVisible();

  await page.goto("/dashboard/local/graph?demo=1&lang=zh-CN");
  const controls = page.locator(".react-flow__controls");
  await expect(controls.getByRole("button", { name: "放大" })).toBeVisible();
  await expect(controls.getByRole("button", { name: "缩小" })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Zoom In" })).toHaveCount(0);
});

test("mobile sidebar toggle has a localized accessible name", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => window.localStorage.setItem("busabaseLocale", "ja"));
  await page.goto("/dashboard/local/home?demo=1");
  await expect(page.getByRole("button", { name: "サイドバーを切り替え" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Toggle Sidebar" })).toHaveCount(0);
  await page.getByRole("button", { name: "サイドバーを切り替え" }).click();
  const sidebar = page.getByRole("dialog", { name: "サイドバー" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toContainText("モバイルのナビゲーションメニューを表示します。");
  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveCount(0);
});

test("Auto matches the default English demo dataset even in a Chinese browser", async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.removeItem("busabaseLocale"));
  await page.setExtraHTTPHeaders({ "Accept-Language": "zh-CN" });
  await page.goto("/dashboard/local/home?demo=1");
  await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("unknown pages and Cloud sign-in errors use the request language", async ({ request }) => {
  const notFound = await request.get("/not-a-busabase-page", {
    headers: { "Accept-Language": "zh-CN" },
  });
  expect(notFound.status()).toBe(404);
  const notFoundBody = await notFound.text();
  expect(notFoundBody).toContain('<html lang="zh-CN"');
  expect(notFoundBody).toContain("找不到页面");
  expect(notFoundBody).toContain("返回首页");

  const callback = await request.get("/api/cloud-connect/callback?error=access_denied", {
    headers: { "Accept-Language": "ja" },
  });
  expect(callback.status()).toBe(400);
  const body = await callback.text();
  expect(body).toContain('<html lang="ja">');
  expect(body).toContain("サインインに失敗しました");
  expect(body).not.toContain("Cloud reported:");
});
