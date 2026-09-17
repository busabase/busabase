import { expect, type Page, test } from "./_fixtures";

const FORM_PATH = "/dashboard/local/form/insurance-consult-form?demo=insurance-agency";

const mainPreview = (page: Page) =>
  page.locator('[data-dashboard-active-view] iframe[title="Form"]:visible');
const mainPreviewFrame = (page: Page) =>
  page.frameLocator('[data-dashboard-active-view] iframe[title="Form"]:visible');
const sidePanel = (page: Page) => page.getByRole("region", { name: "Side panel" });
const sidePreview = (page: Page) => sidePanel(page).locator('iframe[title="Form"]:visible');
const sidePreviewFrame = (page: Page) =>
  page.frameLocator('[aria-label="Side panel"] iframe[title="Form"]:visible');
const fullscreenPreview = (page: Page) => page.locator('[data-form-fullscreen="true"]');

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

test("Form preview keeps its iframe through fullscreen and offers a preview-only pinned view", async ({
  page,
}, testInfo) => {
  await test.step("opens a fullscreen deep link without dropping the demo query", async () => {
    await page.goto(`${FORM_PATH}&fullscreen=1`);
    await expect(page.getByRole("heading", { name: "Request a Consultation" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Form" })).toHaveAttribute("data-state", "active");
    await expect(page.getByRole("button", { name: "Details" })).toBeVisible();
    const fullscreen = fullscreenPreview(page);
    await expect(fullscreen).toBeVisible();
    await expect(fullscreen.locator("iframe")).toHaveCSS("border-top-width", "0px");
    await expectFullscreenCoverage(page);
    expect(new URL(page.url()).searchParams.get("demo")).toBe("insurance-agency");
    expect(new URL(page.url()).searchParams.get("fullscreen")).toBe("1");
    const fullscreenShot = testInfo.outputPath("form-main-preview-fullscreen.png");
    await page.screenshot({ path: fullscreenShot });
    await testInfo.attach("Form main preview fullscreen", {
      path: fullscreenShot,
      contentType: "image/png",
    });
    await page.keyboard.press("Escape");
    await expect(fullscreenPreview(page)).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("fullscreen")).toBeNull();
    expect(new URL(page.url()).searchParams.get("demo")).toBe("insurance-agency");
  });

  await test.step("enters and leaves fullscreen with the same filled iframe", async () => {
    await mainPreview(page).evaluate((iframe) => {
      iframe.setAttribute("data-e2e-iframe-identity", "main-form-preview");
    });
    await page.getByRole("button", { name: "Enter fullscreen" }).click();
    await mainPreviewFrame(page).getByPlaceholder("e.g. Owen Castellanos").fill("Ada Lovelace");
    await fullscreenPreview(page).getByRole("button", { name: "Exit fullscreen" }).click();

    await expect(fullscreenPreview(page)).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("fullscreen")).toBeNull();
    expect(new URL(page.url()).searchParams.get("demo")).toBe("insurance-agency");
    await expect(mainPreview(page)).toHaveAttribute(
      "data-e2e-iframe-identity",
      "main-form-preview",
    );
    await expect(mainPreviewFrame(page).getByPlaceholder("e.g. Owen Castellanos")).toHaveValue(
      "Ada Lovelace",
    );
    const restoredShot = testInfo.outputPath("form-main-preview-restored.png");
    await page.screenshot({ path: restoredShot });
    await testInfo.attach("Form main preview restored", {
      path: restoredShot,
      contentType: "image/png",
    });
  });

  await test.step("Code enters the same Form preview and topbar actions stay aligned", async () => {
    await page.getByRole("tab", { name: "Code" }).click();
    await expect(page.getByText("Page source", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Enter fullscreen" }).click();

    await expect(page.getByRole("tab", { name: "Form" })).toHaveAttribute("data-state", "active");
    await expect(mainPreview(page)).toHaveAttribute(
      "data-e2e-iframe-identity",
      "main-form-preview",
    );
    await expect(mainPreviewFrame(page).getByPlaceholder("e.g. Owen Castellanos")).toHaveValue(
      "Ada Lovelace",
    );
    await fullscreenPreview(page).getByRole("button", { name: "Exit fullscreen" }).click();

    const topbar = page.locator("[data-dashboard-topbar]");
    for (const name of [
      "Pin to side panel",
      "Enter fullscreen",
      "Agent prompts",
      "Share",
      "More actions",
    ]) {
      await expect(topbar.getByRole("button", { name })).toBeVisible();
    }
  });

  await test.step("pins a preview-only Form that can own fullscreen", async () => {
    await page.getByRole("button", { name: "Pin to side panel" }).click();
    const panel = sidePanel(page);
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Form", { exact: true })).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Code" })).toHaveCount(0);
    await sidePreview(page).evaluate((iframe) => {
      iframe.setAttribute("data-e2e-iframe-identity", "pinned-form-preview");
    });
    await sidePreviewFrame(page)
      .getByPlaceholder("e.g. Owen Castellanos")
      .fill("Pinned Ada Lovelace");

    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/local\/home\?demo=insurance-agency$/);
    await expect(sidePreview(page)).toHaveAttribute(
      "data-e2e-iframe-identity",
      "pinned-form-preview",
    );
    await expect(sidePreviewFrame(page).getByPlaceholder("e.g. Owen Castellanos")).toHaveValue(
      "Pinned Ada Lovelace",
    );
    const pinnedShot = testInfo.outputPath("form-pinned-preview-after-navigation.png");
    await page.screenshot({ path: pinnedShot });
    await testInfo.attach("Pinned Form preview after navigation", {
      path: pinnedShot,
      contentType: "image/png",
    });

    await panel.getByRole("button", { name: "Enter fullscreen" }).click();
    const fullscreen = fullscreenPreview(page);
    await expect(fullscreen).toBeVisible();
    await expectFullscreenCoverage(page);
    await expect(fullscreen.locator("iframe")).toHaveAttribute(
      "data-e2e-iframe-identity",
      "pinned-form-preview",
    );
    const pinnedFullscreenShot = testInfo.outputPath("form-pinned-preview-fullscreen.png");
    await page.screenshot({ path: pinnedFullscreenShot });
    await testInfo.attach("Pinned Form preview fullscreen", {
      path: pinnedFullscreenShot,
      contentType: "image/png",
    });

    await fullscreen.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(fullscreen).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(sidePreview(page)).toHaveAttribute(
      "data-e2e-iframe-identity",
      "pinned-form-preview",
    );
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Form header, tabs, topbar, and fullscreen stay inside the viewport", async ({
    page,
  }, testInfo) => {
    await page.goto(FORM_PATH);
    const header = page.locator("[data-dashboard-active-view] header");
    const topbar = page.locator("[data-dashboard-topbar]");
    await expect(page.getByRole("heading", { name: "Request a Consultation" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Form" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Code" })).toBeVisible();
    for (const surface of [header, topbar]) {
      const metrics = await surface.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        rect: element.getBoundingClientRect().toJSON(),
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
      expect(metrics.rect.left).toBeGreaterThanOrEqual(0);
      expect(metrics.rect.right).toBeLessThanOrEqual(390);
    }

    const inlineShot = testInfo.outputPath("form-mobile-preview.png");
    await page.screenshot({ path: inlineShot });
    await testInfo.attach("Form preview on mobile", {
      path: inlineShot,
      contentType: "image/png",
    });

    await page.getByRole("button", { name: "Enter fullscreen" }).click();
    await expect(fullscreenPreview(page)).toBeVisible();
    await expectFullscreenCoverage(page);
    await fullscreenPreview(page).getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(fullscreenPreview(page)).toHaveCount(0);
  });
});
