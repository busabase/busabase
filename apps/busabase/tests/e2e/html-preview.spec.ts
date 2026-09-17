import { expect, type Page, test } from "./_fixtures";

const HTML_PATH = "/dashboard/local/html/waitlist-form-prototype?demo=node-types";
const previewFrameTitle = "Waitlist Form Prototype preview";

const mainPreview = (page: Page) =>
  page.locator(`[data-dashboard-active-view] iframe[title="${previewFrameTitle}"]:visible`);
const mainPreviewFrame = (page: Page) =>
  page.frameLocator(`[data-dashboard-active-view] iframe[title="${previewFrameTitle}"]:visible`);
const sidePanel = (page: Page) => page.getByRole("region", { name: "Side panel" });
const sidePreview = (page: Page) =>
  sidePanel(page).locator(`iframe[title="${previewFrameTitle}"]:visible`);
const sidePreviewFrame = (page: Page) =>
  page.frameLocator(`[aria-label="Side panel"] iframe[title="${previewFrameTitle}"]:visible`);
const fullscreenPreview = (page: Page) => page.locator('[data-html-fullscreen="true"]');

test("HTML preview keeps its iframe through fullscreen and pinned navigation", async ({
  page,
}, testInfo) => {
  await test.step("opens a fullscreen deep link without losing the demo query", async () => {
    await page.goto(`${HTML_PATH}&fullscreen=1`);
    await expect(page.getByRole("heading", { name: "Waitlist Form Prototype" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "data-state",
      "active",
    );
    const fullscreen = fullscreenPreview(page);
    await expect(fullscreen).toBeVisible();
    await expect(fullscreen).toHaveCSS("position", "fixed");
    await expect(fullscreen.locator("[data-preview-fullscreen-body]")).toHaveCSS("padding", "0px");
    await expect(fullscreen.locator("iframe")).toHaveCSS("border-top-width", "0px");
    expect(await fullscreen.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: page.viewportSize()?.width,
      height: page.viewportSize()?.height,
    });
    expect(new URL(page.url()).searchParams.get("demo")).toBe("node-types");
    expect(new URL(page.url()).searchParams.get("fullscreen")).toBe("1");
    await expect(mainPreview(page)).toBeVisible();
    await expect(page.locator(`iframe[title="${previewFrameTitle}"]:visible`)).toHaveCount(1);
  });

  await test.step("Escape restores the same iframe while focus remains in the host", async () => {
    await mainPreview(page).evaluate((iframe) => {
      iframe.setAttribute("data-e2e-iframe-identity", "main-html-preview");
    });

    await page.keyboard.press("Escape");

    await expect(fullscreenPreview(page)).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("fullscreen")).toBeNull();
    expect(new URL(page.url()).searchParams.get("demo")).toBe("node-types");
    await expect(mainPreview(page)).toHaveAttribute(
      "data-e2e-iframe-identity",
      "main-html-preview",
    );

    const topbar = page.locator("[data-dashboard-topbar]");
    const topbarActions = await Promise.all(
      ["Pin to side panel", "Enter fullscreen", "Agent prompts", "More actions", "Save"].map(
        async (name) => {
          const button = topbar.getByRole("button", { name });
          await expect(button).toBeVisible();
          return button.boundingBox();
        },
      ),
    );
    expect(topbarActions.every(Boolean)).toBe(true);
    const actionCenters = topbarActions.map((box) => (box?.y ?? 0) + (box?.height ?? 0) / 2);
    expect(Math.max(...actionCenters) - Math.min(...actionCenters)).toBeLessThan(2);
    await expect(topbar.getByText("Saved", { exact: true })).toBeVisible();
  });

  await test.step("the topbar enters fullscreen, forces Preview, and exits with the floating control", async () => {
    await page.getByRole("tab", { name: "Source" }).click();
    await expect(page.getByRole("textbox", { name: "HTML source" })).toBeVisible();
    await page.getByRole("button", { name: "Enter fullscreen" }).click();

    const fullscreen = fullscreenPreview(page);
    await expect(fullscreen).toBeVisible();
    await expect(page.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "data-state",
      "active",
    );
    await mainPreview(page).evaluate((iframe) => {
      iframe.setAttribute("data-e2e-iframe-identity", "main-html-after-source");
    });
    await mainPreviewFrame(page).getByPlaceholder("you@company.com").fill("owner@example.com");
    await mainPreviewFrame(page).getByRole("button", { name: "Request early access" }).click();
    await expect(
      mainPreviewFrame(page).getByRole("button", { name: "You are on the list" }),
    ).toBeVisible();
    await fullscreen.getByRole("button", { name: "Exit fullscreen" }).click();

    await expect(fullscreen).toHaveCount(0);
    await expect(mainPreview(page)).toHaveAttribute(
      "data-e2e-iframe-identity",
      "main-html-after-source",
    );
    await expect(mainPreviewFrame(page).getByPlaceholder("you@company.com")).toHaveValue(
      "owner@example.com",
    );
    await expect(
      mainPreviewFrame(page).getByRole("button", { name: "You are on the list" }),
    ).toBeVisible();
    const mainShot = testInfo.outputPath("html-main-preview-restored.png");
    await page.screenshot({ path: mainShot });
    await testInfo.attach("HTML main preview restored", {
      path: mainShot,
      contentType: "image/png",
    });
  });

  await test.step("a pinned preview stays alive across main navigation and owns its fullscreen", async () => {
    await page.getByRole("button", { name: "Pin to side panel" }).click();
    const panel = sidePanel(page);
    await expect(panel).toBeVisible();
    await sidePreview(page).evaluate((iframe) => {
      iframe.setAttribute("data-e2e-iframe-identity", "pinned-html-preview");
    });
    await sidePreviewFrame(page).getByPlaceholder("you@company.com").fill("pinned@example.com");
    await sidePreviewFrame(page).getByRole("button", { name: "Request early access" }).click();
    await expect(
      sidePreviewFrame(page).getByRole("button", { name: "You are on the list" }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/local\/home\?demo=node-types$/);
    await expect(sidePreview(page)).toHaveAttribute(
      "data-e2e-iframe-identity",
      "pinned-html-preview",
    );
    await expect(
      sidePreviewFrame(page).getByRole("button", { name: "You are on the list" }),
    ).toBeVisible();

    await panel.getByRole("button", { name: "Enter fullscreen" }).click();
    const fullscreen = fullscreenPreview(page);
    await expect(fullscreen).toBeVisible();
    expect(await fullscreen.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: page.viewportSize()?.width,
      height: page.viewportSize()?.height,
    });
    await expect(fullscreen.locator("iframe")).toHaveAttribute(
      "data-e2e-iframe-identity",
      "pinned-html-preview",
    );
    const pinnedShot = testInfo.outputPath("html-pinned-preview-fullscreen.png");
    await page.screenshot({ path: pinnedShot });
    await testInfo.attach("Pinned HTML preview fullscreen", {
      path: pinnedShot,
      contentType: "image/png",
    });
    await fullscreen.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(fullscreen).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(
      sidePreviewFrame(page).getByRole("button", { name: "You are on the list" }),
    ).toBeVisible();
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("HTML header, tabs, topbar, and fullscreen stay inside the viewport", async ({
    page,
  }, testInfo) => {
    await page.goto(HTML_PATH);
    const header = page.locator("[data-dashboard-active-view] header");
    const topbar = page.locator("[data-dashboard-topbar]");
    await expect(page.getByRole("heading", { name: "Waitlist Form Prototype" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Preview" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Source" })).toBeVisible();
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
    const mobileShot = testInfo.outputPath("html-mobile-preview.png");
    await page.screenshot({ path: mobileShot });
    await testInfo.attach("HTML preview on mobile", {
      path: mobileShot,
      contentType: "image/png",
    });

    await page.getByRole("button", { name: "Enter fullscreen" }).click();
    const fullscreen = fullscreenPreview(page);
    await expect(fullscreen).toBeVisible();
    expect(await fullscreen.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    await fullscreen.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(fullscreen).toHaveCount(0);
  });
});
