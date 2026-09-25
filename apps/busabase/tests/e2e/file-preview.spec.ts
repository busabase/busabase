import { expect, type Page, test } from "./_fixtures";

const FILE_PATH = "/dashboard/local/file/visual-preview-map?demo=node-types";
const FILE_NAME = "visual-preview-map.svg";

const mainPreview = (page: Page) =>
  page.locator(`[data-dashboard-active-view] img[alt="${FILE_NAME}"]:visible`);
const sidePanel = (page: Page) => page.getByRole("region", { name: "Side panel" });
const sidePreview = (page: Page) => sidePanel(page).locator(`img[alt="${FILE_NAME}"]:visible`);
const fullscreenPreview = (page: Page) => page.locator('[data-file-fullscreen="true"]');

const expectFullscreenCoverage = async (page: Page) => {
  const fullscreen = fullscreenPreview(page);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(await fullscreen.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: viewport?.width,
    height: viewport?.height,
  });
  expect(
    await fullscreen.evaluate((surface) => {
      const points = [
        [1, 1],
        [window.innerWidth - 2, 1],
        [1, window.innerHeight - 2],
        [window.innerWidth - 2, window.innerHeight - 2],
      ];
      return points.every(([x, y]) => {
        const top = document.elementFromPoint(x, y);
        return Boolean(top && surface.contains(top));
      });
    }),
  ).toBe(true);
};

test("visual File preview keeps its image through main and pinned fullscreen", async ({
  page,
}, testInfo) => {
  await test.step("opens a deep fullscreen link and keeps the demo query", async () => {
    await page.goto(`${FILE_PATH}&fullscreen=1`);
    // Identity lives in the topbar now: the name in the breadcrumb, the
    // description behind the Details button's tooltip (asserted below, out of
    // fullscreen — the fullscreen surface covers the topbar).
    await expect(page.locator("[data-topbar-current-item]")).toHaveText("Visual Preview Map");
    await expect(mainPreview(page)).toBeVisible();
    await expectFullscreenCoverage(page);
    expect(new URL(page.url()).searchParams.get("demo")).toBe("node-types");
    expect(new URL(page.url()).searchParams.get("fullscreen")).toBe("1");

    const fullscreenShot = testInfo.outputPath("file-main-preview-fullscreen.png");
    await page.screenshot({ path: fullscreenShot });
    await testInfo.attach("File main preview fullscreen", {
      path: fullscreenShot,
      contentType: "image/png",
    });
  });

  await test.step("exits to the same image and exposes aligned topbar actions", async () => {
    await mainPreview(page).evaluate((image) => {
      image.setAttribute("data-e2e-media-identity", "main-file-preview");
    });
    await fullscreenPreview(page).getByRole("button", { name: "Exit fullscreen" }).click();

    await expect(fullscreenPreview(page)).toHaveCount(0);
    await expect(mainPreview(page)).toHaveAttribute("data-e2e-media-identity", "main-file-preview");
    expect(new URL(page.url()).searchParams.get("fullscreen")).toBeNull();
    expect(new URL(page.url()).searchParams.get("demo")).toBe("node-types");
    const topbar = page.locator("[data-dashboard-topbar]");
    for (const name of ["Agent prompts", "Pin to side panel", "Enter fullscreen", "More actions"]) {
      await expect(topbar.getByRole("button", { name })).toBeVisible();
    }
    await topbar.getByRole("button", { name: "Details" }).hover();
    await expect(page.getByRole("tooltip")).toContainText(
      "A visual SVG File node for inspecting native media previews.",
    );

    const inlineShot = testInfo.outputPath("file-main-preview.png");
    await page.screenshot({ path: inlineShot });
    await testInfo.attach("File main preview", { path: inlineShot, contentType: "image/png" });
  });

  await test.step("pins a preview-only File that survives navigation and owns fullscreen", async () => {
    await page.getByRole("button", { name: "Pin to side panel" }).click();
    const panel = sidePanel(page);
    await expect(panel).toBeVisible();
    await expect(sidePreview(page)).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Visual Preview Map" })).toHaveCount(0);
    await sidePreview(page).evaluate((image) => {
      image.setAttribute("data-e2e-media-identity", "pinned-file-preview");
    });

    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/local\/home\?demo=node-types$/);
    await expect(sidePreview(page)).toHaveAttribute(
      "data-e2e-media-identity",
      "pinned-file-preview",
    );

    const pinnedShot = testInfo.outputPath("file-pinned-preview-after-navigation.png");
    await page.screenshot({ path: pinnedShot });
    await testInfo.attach("Pinned File preview after navigation", {
      path: pinnedShot,
      contentType: "image/png",
    });

    await panel.getByRole("button", { name: "Enter fullscreen" }).click();
    await expectFullscreenCoverage(page);
    await expect(fullscreenPreview(page).locator(`img[alt="${FILE_NAME}"]`)).toHaveAttribute(
      "data-e2e-media-identity",
      "pinned-file-preview",
    );
    expect(new URL(page.url()).searchParams.get("fullscreen")).toBeNull();

    const pinnedFullscreenShot = testInfo.outputPath("file-pinned-preview-fullscreen.png");
    await page.screenshot({ path: pinnedFullscreenShot });
    await testInfo.attach("Pinned File preview fullscreen", {
      path: pinnedFullscreenShot,
      contentType: "image/png",
    });

    await fullscreenPreview(page).getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(fullscreenPreview(page)).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(sidePreview(page)).toHaveAttribute(
      "data-e2e-media-identity",
      "pinned-file-preview",
    );
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("File title, topbar, preview, and fullscreen stay inside the viewport", async ({
    page,
  }, testInfo) => {
    await page.goto(FILE_PATH);
    // A File node draws no in-page header any more — the topbar is the only
    // chrome above the preview, so it is the only thing left to fit.
    const topbar = page.locator("[data-dashboard-topbar]");
    await expect(page.locator("[data-topbar-current-item]")).toHaveText("Visual Preview Map");
    await expect(mainPreview(page)).toBeVisible();
    for (const surface of [topbar]) {
      const metrics = await surface.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        rect: element.getBoundingClientRect().toJSON(),
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
      expect(metrics.rect.left).toBeGreaterThanOrEqual(0);
      expect(metrics.rect.right).toBeLessThanOrEqual(390);
    }

    const mobileShot = testInfo.outputPath("file-mobile-preview.png");
    await page.screenshot({ path: mobileShot });
    await testInfo.attach("File preview on mobile", {
      path: mobileShot,
      contentType: "image/png",
    });

    await page.getByRole("button", { name: "Enter fullscreen" }).click();
    await expectFullscreenCoverage(page);
    expect(await fullscreenPreview(page).boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: 390,
      height: 844,
    });
    await fullscreenPreview(page).getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(fullscreenPreview(page)).toHaveCount(0);
  });
});
