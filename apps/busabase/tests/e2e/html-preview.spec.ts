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
    await expect(page.locator("[data-topbar-current-item]")).toHaveText("Waitlist Form Prototype");
    // HTML opens in reading mode: no Preview/Source switch until Edit.
    await expect(page.getByRole("tab", { name: /^(Preview|Source)$/ })).toHaveCount(0);
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
      ["Pin to side panel", "Enter fullscreen", "Edit", "Agent prompts", "More actions"].map(
        async (name) => {
          const button = topbar.getByRole("button", { name, exact: name === "Edit" });
          await expect(button).toBeVisible();
          return button.boundingBox();
        },
      ),
    );
    expect(topbarActions.every(Boolean)).toBe(true);
    const actionCenters = topbarActions.map((box) => (box?.y ?? 0) + (box?.height ?? 0) / 2);
    expect(Math.max(...actionCenters) - Math.min(...actionCenters)).toBeLessThan(2);
    // Reading mode has nothing to save.
    await expect(topbar.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await expect(page.locator("[data-rich-node-save-status]")).toHaveCount(0);
  });

  await test.step("Edit opens Source; fullscreen shows the preview and comes back to Source", async () => {
    const topbar = page.locator("[data-dashboard-topbar]");
    await topbar.getByRole("button", { name: "Edit", exact: true }).click();
    const source = page.getByRole("textbox", { name: "HTML source" });
    await expect(source).toBeVisible();
    await expect(page.getByRole("tab", { name: "Source" })).toHaveAttribute("data-state", "active");
    // A desktop topbar keeps the secondary actions while editing.
    await expect(topbar.getByRole("button", { name: "Agent prompts" })).toBeVisible();
    await topbar.getByRole("button", { name: "Enter fullscreen" }).click();
    await expect(fullscreenPreview(page)).toBeVisible();
    await expect(page.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "data-state",
      "active",
    );
    await page.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(fullscreenPreview(page)).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Source" })).toHaveAttribute("data-state", "active");
    await expect(source).toBeVisible();
    // Nothing was changed, so Cancel goes straight back to reading.
    await topbar.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("tab", { name: /^(Preview|Source)$/ })).toHaveCount(0);
  });

  await test.step("the topbar enters fullscreen while reading and exits with the floating control", async () => {
    await page.getByRole("button", { name: "Enter fullscreen" }).click();

    const fullscreen = fullscreenPreview(page);
    await expect(fullscreen).toBeVisible();
    await mainPreview(page).evaluate((iframe) => {
      iframe.setAttribute("data-e2e-iframe-identity", "main-html-reading-fullscreen");
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
      "main-html-reading-fullscreen",
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
    await expect(page.locator("[data-topbar-current-item]")).toHaveText("Waitlist Form Prototype");
    const expectInsideViewport = async (surface: typeof topbar, name: string) => {
      const metrics = await surface.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        rect: element.getBoundingClientRect().toJSON(),
      }));
      expect(metrics.scrollWidth, name).toBeLessThanOrEqual(metrics.clientWidth);
      expect(metrics.rect.left, name).toBeGreaterThanOrEqual(0);
      expect(metrics.rect.right, name).toBeLessThanOrEqual(page.viewportSize()?.width ?? 390);
    };
    // Reading mode: Edit instead of the Preview/Source switch, and no editor header.
    const edit = topbar.getByRole("button", { name: "Edit", exact: true });
    await expect(edit).toBeVisible();
    await expect(page.getByRole("tab", { name: /^(Preview|Source)$/ })).toHaveCount(0);
    await expectInsideViewport(topbar, "reading topbar");
    const mobileShot = testInfo.outputPath("html-mobile-preview.png");
    await page.screenshot({ path: mobileShot });
    await testInfo.attach("HTML preview on mobile", {
      path: mobileShot,
      contentType: "image/png",
    });

    // Editing adds the header with the Preview/Source tabs; it fits too.
    await edit.click();
    await expect(page.getByRole("tab", { name: "Preview" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Source" })).toBeVisible();
    await expectInsideViewport(header, "editing header");
    await expectInsideViewport(topbar, "editing topbar");
    // A phone keeps only fullscreen, Cancel and Save while editing, so 375px fits too.
    await expect(topbar.getByRole("button", { name: "Agent prompts" })).toBeHidden();
    await expect(topbar.getByRole("button", { name: "More actions" })).toBeHidden();
    await page.setViewportSize({ width: 375, height: 844 });
    await expectInsideViewport(topbar, "editing topbar at 375px");
    await page.setViewportSize({ width: 390, height: 844 });
    await topbar.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("tab", { name: /^(Preview|Source)$/ })).toHaveCount(0);
    await expect(topbar.getByRole("button", { name: "More actions" })).toBeVisible();

    await page.getByRole("button", { name: "Enter fullscreen" }).click();
    const fullscreen = fullscreenPreview(page);
    await expect(fullscreen).toBeVisible();
    expect(await fullscreen.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    await fullscreen.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(fullscreen).toHaveCount(0);
  });
});
