import type { Locator } from "@playwright/test";
import { expect, test } from "./_fixtures";

const RENDER_TIMEOUT = 45_000;
test.setTimeout(90_000);

const expectSingleLineScroller = async (tabs: Locator) => {
  await expect(tabs).toBeVisible({ timeout: RENDER_TIMEOUT });
  const items = tabs.locator(":scope > a, :scope > button");
  await expect(items.first()).toBeVisible();

  const geometry = await tabs.evaluate((element) => {
    const children = [...element.children] as HTMLElement[];
    const tops = children.map((child) => Math.round(child.getBoundingClientRect().top));
    const style = window.getComputedStyle(element);
    return {
      clientWidth: element.clientWidth,
      flexWrap: style.flexWrap,
      overflowX: style.overflowX,
      scrollWidth: element.scrollWidth,
      topDelta: tops.length > 0 ? Math.max(...tops) - Math.min(...tops) : 0,
    };
  });

  expect(geometry.flexWrap).toBe("nowrap");
  expect(geometry.overflowX).toBe("auto");
  expect(geometry.topDelta).toBeLessThanOrEqual(1);
  expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
};

test("desktop sidebar identifies the active workspace without marketing copy", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard/local/inbox?demo=1");

  const header = page.locator('[data-sidebar="header"]');
  await expect(header.getByText("Local Busabase", { exact: true })).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
  await expect(header.getByText("Local", { exact: true })).toBeVisible();
  await expect(header.getByText("Trusted Intelligent Database", { exact: true })).toHaveCount(0);

  await header.getByRole("button", { name: /Local Busabase.*Local/ }).click();
  await expect(page.getByRole("button", { name: "Invite members" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Add workspace" })).toHaveCount(0);
});

test("mobile Inbox views stay in one bounded, horizontally scrollable row", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/local/inbox?demo=1");

  const toolbar = page.getByTestId("inbox-toolbar");
  await expect(toolbar).toBeVisible({ timeout: RENDER_TIMEOUT });
  expect((await toolbar.boundingBox())?.height).toBeLessThanOrEqual(52);
  await expectSingleLineScroller(page.getByTestId("inbox-view-tabs"));
});

test("mobile Base views stay in one horizontally scrollable row", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/local/base/blog?demo=1");

  await expect(page.getByRole("link", { exact: true, name: "Ready to publish" })).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
  await expectSingleLineScroller(page.getByTestId("base-view-tabs"));
  await expect(page.getByTestId("base-new-view-button")).toBeVisible();
});
