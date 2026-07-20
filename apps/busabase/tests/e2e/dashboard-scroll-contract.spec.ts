import { expect, test } from "./_fixtures";

interface ScrollContractCase {
  name: string;
  route: string;
  scrollOwner: string;
  viewport: { height: number; width: number };
}

const cases: ScrollContractCase[] = [
  {
    name: "Base Design at desktop height",
    route: "/dashboard/base/blog/design",
    scrollOwner: "base-design",
    viewport: { width: 1280, height: 720 },
  },
  {
    name: "Record Editor at desktop height",
    route: "/dashboard/base/field-type-lab/new",
    scrollOwner: "record-editor",
    viewport: { width: 1280, height: 720 },
  },
  {
    name: "Assets at desktop height",
    route: "/dashboard/assets",
    scrollOwner: "assets",
    viewport: { width: 1280, height: 720 },
  },
  {
    name: "Asset Detail at compact height",
    route: "/dashboard/assets/ast_grep_demo_invoice",
    scrollOwner: "assets",
    viewport: { width: 1024, height: 320 },
  },
  {
    name: "Activity at compact height",
    route: "/dashboard/activity",
    scrollOwner: "activity",
    viewport: { width: 1024, height: 320 },
  },
  {
    name: "Trash at compact height",
    route: "/dashboard/archived",
    scrollOwner: "archived",
    viewport: { width: 1024, height: 320 },
  },
  {
    name: "Doc Detail at compact height",
    route: "/dashboard/doc/agent-operating-guide",
    scrollOwner: "doc-detail",
    viewport: { width: 1024, height: 320 },
  },
  {
    name: "Folder Detail at compact height",
    route: "/dashboard/folder/docs",
    scrollOwner: "folder-detail",
    viewport: { width: 1024, height: 320 },
  },
];

test.describe("dashboard scroll contract", () => {
  for (const scrollCase of cases) {
    test(`${scrollCase.name} owns its overflow and reaches the bottom`, async ({ page }) => {
      await page.setViewportSize(scrollCase.viewport);
      await page.goto(scrollCase.route);

      const activeView = page.locator("[data-dashboard-active-view]");
      const scrollOwner = page.locator(`[data-dashboard-scroll="${scrollCase.scrollOwner}"]`);
      await expect(activeView).toBeVisible({ timeout: 45_000 });
      await expect(scrollOwner).toBeVisible({ timeout: 45_000 });

      await expect
        .poll(() =>
          activeView.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
        )
        .toBe(true);
      await expect
        .poll(() => scrollOwner.evaluate((element) => element.scrollHeight > element.clientHeight))
        .toBe(true);

      await scrollOwner.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll"));
      });

      await expect
        .poll(() =>
          scrollOwner.evaluate(
            (element) =>
              Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 1,
          ),
        )
        .toBe(true);
    });
  }
});
