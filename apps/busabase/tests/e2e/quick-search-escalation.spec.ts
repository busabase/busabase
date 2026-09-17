import { expect, type Page, test } from "./_fixtures";

const openSearch = async (page: Page) => {
  const trigger = page.getByRole("button", { name: "Search", exact: true });
  await expect(trigger).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const field = page.locator("#busabase-dashboard-search");
    if (await field.isVisible()) return page.getByRole("dialog", { name: "Search" });
    await trigger.click();
    try {
      await field.waitFor({ state: "visible", timeout: 3_000 });
      return page.getByRole("dialog", { name: "Search" });
    } catch {
      await page.waitForTimeout(250);
    }
  }
  throw new Error("Search dialog did not open");
};

test("quick search keeps advanced search visible above a bounded result list", async ({ page }) => {
  await page.goto("/dashboard/local?demo=1");
  const dialog = await openSearch(page);
  await dialog.getByRole("combobox", { name: "Search" }).fill("agent");

  const advanced = dialog.getByRole("button", { name: "Advanced search" });
  await expect(advanced).toBeInViewport();
  const results = dialog.getByTestId("search-result");
  await expect(results.first()).toBeVisible();
  expect(await results.count()).toBeLessThanOrEqual(6);
  expect((await advanced.boundingBox())?.y).toBeLessThan(
    (await results.first().boundingBox())?.y ?? 0,
  );
  await dialog.getByRole("button", { name: "Clear search" }).click();
  await expect(dialog.getByRole("combobox", { name: "Search" })).toHaveValue("");
  await expect(advanced).toBeHidden();
  await dialog.getByRole("combobox", { name: "Search" }).fill("agent");

  await advanced.click();
  await expect(page).toHaveURL(/\/dashboard\/local\/search\?/);
  const advancedUrl = new URL(page.url());
  expect(advancedUrl.searchParams.get("demo")).toBe("1");
  expect(advancedUrl.searchParams.get("q")).toBe("agent");
  await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();
});

test("slow quick search offers the durable search page instead of waiting indefinitely", async ({
  page,
}) => {
  await page.goto("/dashboard/local?demo=1");
  const dialog = await openSearch(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 4_000,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await dialog.getByRole("combobox", { name: "Search" }).fill("content-only-marker");

  await expect(dialog.getByText("This search needs more time").last()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue in advanced search" })).toBeVisible();
});

test("mobile search closes the sidebar before focusing the quick-search dialog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/local?demo=1");
  await page.getByRole("button", { name: "Toggle Sidebar" }).last().click();
  await page.getByRole("button", { name: "Search", exact: true }).click();

  const dialog = page.getByRole("dialog");
  const field = dialog.getByRole("combobox", { name: "Search" });
  await expect(field).toBeVisible();
  await expect(field).toBeFocused();
  await field.fill("agent");
  await expect(dialog.getByRole("button", { name: "Advanced search" })).toBeVisible();
});
