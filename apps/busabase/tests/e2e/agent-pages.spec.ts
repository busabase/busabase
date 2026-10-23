import { expect, test } from "./_fixtures";

const capture = async (
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
  name: string,
) => {
  // Keep framework-only dev controls out of product evidence.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
};

const expectNoHorizontalOverflow = async (page: import("@playwright/test").Page) => {
  expect(
    await page.evaluate(() =>
      Math.max(
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        document.body.scrollWidth - document.body.clientWidth,
      ),
    ),
  ).toBeLessThanOrEqual(1);
};

test("right panel: connecting an agent keeps the catalog readable through resize and restore", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => window.localStorage.setItem("busabaseLocale", "en"));
  await page.goto("/dashboard/local/home?demo=1", { waitUntil: "commit" });
  await page.getByRole("button", { name: "Open side panel", exact: true }).click();
  const panel = page.getByRole("region", { name: "Side panel", exact: true });
  await panel.getByRole("button", { name: /Agents/ }).click();
  await panel.getByRole("button", { name: "Connect an agent", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add agent", exact: true })).toBeVisible();

  const cards = page.getByTestId("agent-catalog-card");
  await expect(cards).toHaveCount(4);
  const canvas = page.locator("[data-dashboard-active-view]");
  const expectReadableCatalog = async () => {
    await expect
      .poll(async () => {
        const bounds = await cards.evaluateAll((elements) =>
          elements.map((element) => ({
            width: element.getBoundingClientRect().width,
            overflow: element.scrollWidth - element.clientWidth,
          })),
        );
        return bounds.every((box) => box.width >= 255 && box.overflow <= 1);
      })
      .toBe(true);
    await expectNoHorizontalOverflow(page);
  };
  await expectReadableCatalog();
  await capture(page, testInfo, "06-panel-connect-keeps-catalog-readable");

  // Save a wide preference, then shrink the window without changing it.
  const handle = panel.getByRole("button", { name: "Resize side panel", exact: true });
  const handleBounds = await handle.boundingBox();
  expect(handleBounds).not.toBeNull();
  await page.mouse.move(handleBounds!.x + handleBounds!.width / 2, 300);
  await page.mouse.down();
  await page.mouse.move(20, 300, { steps: 12 });
  await page.mouse.up();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(359);
  await expectReadableCatalog();
  await capture(page, testInfo, "07-resized-panel-preserves-main-column");
  await page.reload({ waitUntil: "commit" });
  await expect(cards).toHaveCount(4);
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(359);
  await expectReadableCatalog();

  // Resizing a restored, clamped preference starts from its visible width.
  const restoredHandle = await handle.boundingBox();
  const restoredWidth = (await panel.boundingBox())!.width;
  expect(restoredHandle).not.toBeNull();
  await page.mouse.move(restoredHandle!.x + restoredHandle!.width / 2, 300);
  await page.mouse.down();
  await page.mouse.move(restoredHandle!.x + restoredHandle!.width / 2 + 24, 300, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await panel.boundingBox())?.width ?? 0)
    .toBeCloseTo(restoredWidth - 24, 0);

  await panel.getByRole("button", { name: "Maximize side panel", exact: true }).click();
  await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBe(1280);
  await panel.getByRole("button", { name: "Restore side panel", exact: true }).click();
  await expectReadableCatalog();
  await panel.getByRole("button", { name: "Collapse side panel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open side panel", exact: true })).toBeVisible();
  await expectReadableCatalog();
  await capture(page, testInfo, "08-collapse-restores-catalog-space");

  // Navigation width also changes the workspace without a viewport breakpoint.
  await page.setViewportSize({ width: 1024, height: 900 });
  const navigationHandle = page.getByRole("button", { name: "Resize sidebar", exact: true });
  const navigationBounds = await navigationHandle.boundingBox();
  expect(navigationBounds).not.toBeNull();
  await page.mouse.move(navigationBounds!.x + navigationBounds!.width / 2, 300);
  await page.mouse.down();
  await page.mouse.move(480, 300, { steps: 12 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Open side panel", exact: true }).click();
  await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBe(1024);
  await capture(page, testInfo, "10-wide-navigation-uses-full-width-panel");
  const collapse = panel.getByRole("button", { name: "Collapse side panel", exact: true });
  await collapse.focus();
  await page.keyboard.press("Enter");
  await expectReadableCatalog();
  const expandedNavigation = await navigationHandle.boundingBox();
  expect(expandedNavigation).not.toBeNull();
  await page.mouse.move(expandedNavigation!.x + expandedNavigation!.width / 2, 300);
  await page.mouse.down();
  await page.mouse.move(256, 300, { steps: 12 });
  await page.mouse.up();

  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "Open side panel", exact: true }).click();
    if (width < 1024) {
      await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBe(width);
    } else {
      await expect
        .poll(async () => (await canvas.boundingBox())?.width ?? 0)
        .toBeGreaterThanOrEqual(359);
    }
    await expectNoHorizontalOverflow(page);
    await panel.getByRole("button", { name: "Collapse side panel", exact: true }).click();
    await expectReadableCatalog();
  }
  await capture(page, testInfo, "09-mobile-return-to-readable-catalog");
});

test.describe
  .serial("Agent List and Add Agent", () => {
    test("desktop: moves from the inventory through Add Agent and into Agent Detail", async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.addInitScript(() => window.localStorage.setItem("busabaseLocale", "en"));
      await page.goto("/dashboard/local/agents?demo=1", { waitUntil: "commit" });

      const heading = page.getByRole("heading", { name: "Agents", exact: true });
      await expect(heading).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await heading
        .locator("xpath=ancestor::header")
        .getByRole("button", { name: "Add agent", exact: true })
        .click();
      await expect(page).toHaveURL(/\/dashboard\/local\/agents\/new\?demo=1$/);
      await expect(page.getByRole("heading", { name: "Add agent", exact: true })).toBeVisible();

      const catalogCards = page.getByTestId("agent-catalog-card");
      await expect(catalogCards).toHaveCount(4);
      const firstThreeBounds = await Promise.all(
        [0, 1, 2].map((index) => catalogCards.nth(index).boundingBox()),
      );
      expect(firstThreeBounds.every((box) => box !== null)).toBe(true);
      expect(new Set(firstThreeBounds.map((box) => Math.round(box?.y ?? -1))).size).toBe(1);
      await expectNoHorizontalOverflow(page);
      await capture(page, testInfo, "01-desktop-add-agent-catalog");

      const demoCard = catalogCards.filter({ hasText: "Demo Agent (scripted)" });
      await demoCard.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard\/local\/agents\/busabase-demo-agent\?demo=1$/);
      await expect(page.getByTestId("agent-detail-view")).toBeVisible();
      await capture(page, testInfo, "02-desktop-agent-detail");

      await page.goto("/dashboard/local/agents?demo=1", { waitUntil: "commit" });
      const connectionCard = page
        .getByTestId("agent-connection-card")
        .filter({ hasText: "Demo Agent (scripted)" });
      await expect(connectionCard).toContainText(/\d+ sessions?/);
      await expect(connectionCard).toContainText("idle");
      await capture(page, testInfo, "03-desktop-connected-agent-list");

      const detailButton = connectionCard.locator("button").first();
      await detailButton.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/dashboard\/local\/agents\/busabase-demo-agent\?demo=1$/);
    });

    test("mobile: keeps localized catalog and inventory usable without overflow", async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(() => window.localStorage.setItem("busabaseLocale", "zh-CN"));
      await page.goto("/dashboard/local/agents/new?demo=1&lang=zh-CN", { waitUntil: "commit" });

      await expect(page.getByRole("heading", { name: "添加 Agent", exact: true })).toBeVisible();
      const back = page.getByRole("button", { name: "返回", exact: true });
      const backBounds = await back.boundingBox();
      expect(backBounds?.height).toBeGreaterThanOrEqual(44);

      const catalogCards = page.getByTestId("agent-catalog-card");
      await expect(catalogCards).toHaveCount(4);
      const firstBounds = await catalogCards.nth(0).boundingBox();
      const secondBounds = await catalogCards.nth(1).boundingBox();
      expect(Math.round(firstBounds?.x ?? -1)).toBe(Math.round(secondBounds?.x ?? -2));
      expect(secondBounds?.y ?? 0).toBeGreaterThan(
        (firstBounds?.y ?? 0) + (firstBounds?.height ?? 0),
      );
      // The server's real reason, not a translated stand-in.
      await expect(
        page.getByText("Connecting to agents is disabled in the demo.").first(),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await capture(page, testInfo, "04-mobile-zh-add-agent-catalog");

      const demoCard = catalogCards.filter({ hasText: "演示 Agent（脚本）" });
      const connect = demoCard.getByRole("button", { name: "连接", exact: true });
      const connectBounds = await connect.boundingBox();
      expect(connectBounds?.height).toBeGreaterThanOrEqual(44);
      await connect.click();
      await expect(page).toHaveURL(
        /\/dashboard\/local\/agents\/busabase-demo-agent\?demo=1&lang=zh-CN$/,
      );

      await page.goto("/dashboard/local/agents?demo=1&lang=zh-CN", { waitUntil: "commit" });
      const connectionCard = page.locator(
        '[data-testid="agent-connection-card"][data-agent-slug="busabase-demo-agent"]',
      );
      await expect(connectionCard).toContainText(/\d+ 个会话/);
      const actions = connectionCard.getByRole("button", { name: /的操作$/ });
      const actionBounds = await actions.boundingBox();
      expect(actionBounds?.width).toBeGreaterThanOrEqual(44);
      expect(actionBounds?.height).toBeGreaterThanOrEqual(44);
      await expectNoHorizontalOverflow(page);
      await capture(page, testInfo, "05-mobile-zh-connected-agent-list");
    });
  });
