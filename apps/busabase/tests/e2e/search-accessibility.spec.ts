import { expect, type Page, test } from "./_fixtures";

const openSearch = async (page: Page) => {
  const trigger = page.getByRole("button", { name: "Search", exact: true });
  await expect(trigger).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const field = page.locator("#busabase-dashboard-search");
    if (await field.isVisible())
      return { dialog: page.getByRole("dialog", { name: "Search" }), trigger };
    await trigger.click();
    try {
      await field.waitFor({ state: "visible", timeout: 3_000 });
      return { dialog: page.getByRole("dialog", { name: "Search" }), trigger };
    } catch {
      await page.waitForTimeout(250);
    }
  }
  throw new Error("Search dialog did not open");
};

test("quick search exposes combobox semantics and standard focus order", async ({ page }) => {
  await page.goto("/dashboard/local?demo=1");
  const { dialog, trigger } = await openSearch(page);
  const input = dialog.getByRole("combobox", { name: "Search" });
  await input.fill("AI");

  const listbox = dialog.getByRole("listbox");
  const options = listbox.getByRole("option");
  await expect(options.first()).toBeVisible();
  await expect(input).toHaveAttribute("aria-controls", "busabase-search-results");
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(input).toHaveAttribute("aria-activedescendant", "busabase-search-result-0");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");

  await input.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", "busabase-search-result-1");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");

  await input.press("Tab");
  await expect(dialog.getByRole("button", { name: "Clear search" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Advanced search" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("late results from an old query never replace the current query", async ({ page }) => {
  await page.goto("/dashboard/local?demo=1");
  await page.route("**/api/rpc/search*", async (route) => {
    if (route.request().postData()?.includes('"Plaid"')) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    await route.continue();
  });
  const { dialog } = await openSearch(page);
  const input = dialog.getByRole("combobox", { name: "Search" });
  await input.fill("Plaid");
  await page.waitForTimeout(250);
  await input.fill("Newsletter");

  await expect(dialog.getByRole("option", { name: /Newsletter/ }).first()).toBeVisible();
  await page.waitForTimeout(1_750);
  await expect(input).toHaveValue("Newsletter");
  await expect(dialog.getByRole("option", { name: /Plaid/ })).toHaveCount(0);
});

test("quick and advanced search errors retain state and retry", async ({ page }) => {
  await page.goto("/dashboard/local?demo=1");
  let failingQuery = "network-only-query";
  await page.route("**/api/rpc/**", (route) => {
    const body = route.request().postData() ?? "";
    return failingQuery && body.includes(failingQuery)
      ? route.fulfill({ status: 503, contentType: "text/plain", body: "Unavailable" })
      : route.continue();
  });
  const { dialog } = await openSearch(page);
  const quickInput = dialog.getByRole("combobox", { name: "Search" });
  await quickInput.fill("network-only-query");
  await expect(dialog.getByText("Search failed").last()).toBeVisible({ timeout: 20_000 });
  await expect(quickInput).toHaveValue("network-only-query");
  failingQuery = "";
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByText("No matches").last()).toBeVisible();

  await quickInput.fill("AI");
  await expect(dialog.getByRole("option").first()).toBeVisible();
  failingQuery = "AI";
  await dialog.getByRole("button", { name: "Advanced search" }).click();
  await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();
  const advancedInput = page.getByRole("textbox", { name: "Search" });
  await expect(page.getByText("Search failed").last()).toBeVisible({ timeout: 20_000 });
  await expect(advancedInput).toHaveValue("AI");
  failingQuery = "";
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator('[data-dashboard-scroll="search"] a').first()).toBeVisible();
});

test("advanced search renders readable highlighted snippets instead of raw HTML", async ({
  page,
}) => {
  await page.goto("/dashboard/local/search?demo=1&q=AI");
  const searchView = page.locator('[data-dashboard-scroll="search"]');
  await expect(searchView.locator("a").first()).toBeVisible({ timeout: 30_000 });
  await expect(searchView.locator("mark").first()).toBeVisible();
  const text = await searchView.innerText();
  expect(text).not.toContain("<article>");
  expect(text).not.toContain("<h2>");
});

test("search quality events share an anonymous session without sending query text", async ({
  page,
}) => {
  const metricBodies: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/rpc/searchMetrics/report")) {
      metricBodies.push(request.postData() ?? "");
    }
  });

  await page.goto("/dashboard/local?demo=1");
  const { dialog } = await openSearch(page);
  const input = dialog.getByRole("combobox", { name: "Search" });
  await input.fill("AI");
  const firstResult = dialog.getByRole("option").first();
  await expect(firstResult).toBeVisible();

  await expect.poll(() => metricBodies.some((body) => body.includes("results_shown"))).toBe(true);
  await firstResult.click();
  await expect.poll(() => metricBodies.some((body) => body.includes("result_click"))).toBe(true);

  const resultsBody = metricBodies.find((body) => body.includes("results_shown")) ?? "";
  const clickBody = metricBodies.find((body) => body.includes("result_click")) ?? "";
  const sessionPattern = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  expect(resultsBody.match(sessionPattern)?.[0]).toBe(clickBody.match(sessionPattern)?.[0]);
  for (const body of [resultsBody, clickBody]) {
    expect(body).not.toContain('"query"');
    expect(body).not.toContain('"AI"');
  }
});
