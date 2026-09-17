import type { Locator } from "@playwright/test";
import { expect, type Page, test } from "./_fixtures";

const WHITEBOARD_PATH = "/dashboard/local/whiteboard/product-launch-whiteboard?demo=node-types";
const WORKFLOW_PATH = "/dashboard/local/workflow/lead-intake-workflow?demo=node-types";

const sidePanel = (page: Page) => page.getByRole("region", { name: "Side panel" });
const mainSurface = (page: Page, type: "whiteboard" | "workflow") =>
  page.locator(`[data-dashboard-active-view] [data-visual-node-preview="${type}"]`);
const sideSurface = (page: Page, type: "whiteboard" | "workflow") =>
  sidePanel(page).locator(`[data-visual-node-preview="${type}"]`);

const expectFullscreenCoverage = async (page: Page, surface: Locator) => {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(await surface.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: viewport?.width,
    height: viewport?.height,
  });
  expect(
    await surface.evaluate((element) => {
      const points = [
        [1, 1],
        [window.innerWidth - 2, 1],
        [1, window.innerHeight - 2],
        [window.innerWidth - 2, window.innerHeight - 2],
      ];
      return points.every(([x, y]) => {
        const top = document.elementFromPoint(x, y);
        return Boolean(top && element.contains(top));
      });
    }),
  ).toBe(true);
};

test("Whiteboard keeps one editable canvas through main and pinned fullscreen", async ({
  page,
}, testInfo) => {
  await page.goto(WHITEBOARD_PATH);
  await expect(page.getByRole("heading", { name: "Product Launch Whiteboard" })).toBeVisible();
  const surface = mainSurface(page, "whiteboard");
  const canvas = surface.locator("[data-whiteboard-canvas]");
  const editor = canvas.locator(".excalidraw");
  await expect(editor).toBeVisible();
  await expect(canvas).toHaveAttribute("data-read-only", "false");
  await editor.evaluate((element) => element.setAttribute("data-e2e-identity", "main-whiteboard"));

  const inlineShot = testInfo.outputPath("whiteboard-main-preview.png");
  await page.screenshot({ path: inlineShot });
  await testInfo.attach("Whiteboard main preview", { path: inlineShot, contentType: "image/png" });

  await page.getByRole("button", { name: "Enter fullscreen" }).click();
  await expect(surface).toHaveAttribute("data-preview-fullscreen", "true");
  await expectFullscreenCoverage(page, surface);
  await expect(canvas.locator(".excalidraw")).toHaveAttribute(
    "data-e2e-identity",
    "main-whiteboard",
  );
  expect(new URL(page.url()).searchParams.get("demo")).toBe("node-types");
  expect(new URL(page.url()).searchParams.get("fullscreen")).toBe("1");
  const fullscreenShot = testInfo.outputPath("whiteboard-main-fullscreen.png");
  await page.screenshot({ path: fullscreenShot });
  await testInfo.attach("Whiteboard main fullscreen", {
    path: fullscreenShot,
    contentType: "image/png",
  });

  await surface.getByRole("button", { name: "Exit fullscreen" }).click();
  await expect(surface).toHaveAttribute("data-preview-fullscreen", "false");
  await expect(canvas.locator(".excalidraw")).toHaveAttribute(
    "data-e2e-identity",
    "main-whiteboard",
  );
  expect(new URL(page.url()).searchParams.get("fullscreen")).toBeNull();

  await page.getByRole("button", { name: "Pin to side panel" }).click();
  const panel = sidePanel(page);
  const pinnedSurface = sideSurface(page, "whiteboard");
  const pinnedCanvas = pinnedSurface.locator("[data-whiteboard-canvas]");
  await expect(panel).toBeVisible();
  await expect(pinnedCanvas.locator(".excalidraw")).toBeVisible();
  await expect(pinnedCanvas).toHaveAttribute("data-read-only", "true");
  await pinnedCanvas
    .locator(".excalidraw")
    .evaluate((element) => element.setAttribute("data-e2e-identity", "pinned-whiteboard"));

  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/home\?demo=node-types$/);
  await expect(pinnedCanvas.locator(".excalidraw")).toHaveAttribute(
    "data-e2e-identity",
    "pinned-whiteboard",
  );
  const pinnedShot = testInfo.outputPath("whiteboard-pinned-after-navigation.png");
  await page.screenshot({ path: pinnedShot });
  await testInfo.attach("Pinned Whiteboard after navigation", {
    path: pinnedShot,
    contentType: "image/png",
  });

  await panel.getByRole("button", { name: "Enter fullscreen" }).click();
  await expect(pinnedSurface).toHaveAttribute("data-preview-fullscreen", "true");
  await expectFullscreenCoverage(page, pinnedSurface);
  await expect(pinnedCanvas.locator(".excalidraw")).toHaveAttribute(
    "data-e2e-identity",
    "pinned-whiteboard",
  );
  expect(new URL(page.url()).searchParams.get("fullscreen")).toBeNull();
  const pinnedFullscreenShot = testInfo.outputPath("whiteboard-pinned-fullscreen.png");
  await page.screenshot({ path: pinnedFullscreenShot });
  await testInfo.attach("Pinned Whiteboard fullscreen", {
    path: pinnedFullscreenShot,
    contentType: "image/png",
  });
  await pinnedSurface.getByRole("button", { name: "Exit fullscreen" }).click();
  await expect(pinnedSurface).toHaveAttribute("data-preview-fullscreen", "false");
});

test("Workflow preserves unsaved selection while fullscreen focuses the canvas", async ({
  page,
}, testInfo) => {
  await page.goto(WORKFLOW_PATH);
  await expect(page.getByRole("heading", { name: "Lead Intake Workflow" })).toBeVisible();
  const surface = mainSurface(page, "workflow");
  const canvas = surface.locator("[data-workflow-canvas]");
  const flow = canvas.locator(".react-flow");
  await expect(flow).toBeVisible();
  await expect(canvas).toHaveAttribute("data-read-only", "false");
  await flow.evaluate((element) => element.setAttribute("data-e2e-identity", "main-workflow"));

  await page.locator(".react-flow__node").filter({ hasText: "Enrich company" }).click();
  const labelInput = page.getByLabel("Label");
  await expect(labelInput).toHaveValue("Enrich company");
  await labelInput.fill("Enrich company draft");
  await expect(labelInput).toHaveValue("Enrich company draft");

  await page.getByRole("button", { name: "Enter fullscreen" }).click();
  await expect(surface).toHaveAttribute("data-preview-fullscreen", "true");
  await expectFullscreenCoverage(page, surface);
  await expect(surface.locator("[data-workflow-configuration]")).toBeHidden();
  await expect(flow).toHaveAttribute("data-e2e-identity", "main-workflow");
  const fullscreenShot = testInfo.outputPath("workflow-main-fullscreen.png");
  await page.screenshot({ path: fullscreenShot });
  await testInfo.attach("Workflow canvas fullscreen", {
    path: fullscreenShot,
    contentType: "image/png",
  });

  await surface.getByRole("button", { name: "Exit fullscreen" }).click();
  await expect(surface).toHaveAttribute("data-preview-fullscreen", "false");
  await expect(surface.locator("[data-workflow-configuration]")).toBeVisible();
  await expect(labelInput).toHaveValue("Enrich company draft");
  await expect(flow).toHaveAttribute("data-e2e-identity", "main-workflow");

  await page.getByRole("button", { name: "Pin to side panel" }).click();
  const panel = sidePanel(page);
  const pinnedSurface = sideSurface(page, "workflow");
  const pinnedCanvas = pinnedSurface.locator("[data-workflow-canvas]");
  const pinnedFlow = pinnedCanvas.locator(".react-flow");
  await expect(pinnedFlow).toBeVisible();
  await expect(pinnedCanvas).toHaveAttribute("data-read-only", "true");
  await pinnedFlow.evaluate((element) =>
    element.setAttribute("data-e2e-identity", "pinned-workflow"),
  );
  const splitViewportTransform = await pinnedFlow
    .locator(".react-flow__viewport")
    .getAttribute("style");

  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/home\?demo=node-types$/);
  await expect(pinnedFlow).toHaveAttribute("data-e2e-identity", "pinned-workflow");
  await panel.getByRole("button", { name: "Enter fullscreen" }).click();
  await expect(pinnedSurface).toHaveAttribute("data-preview-fullscreen", "true");
  await expectFullscreenCoverage(page, pinnedSurface);
  await expect(pinnedFlow).toHaveAttribute("data-e2e-identity", "pinned-workflow");
  expect(new URL(page.url()).searchParams.get("fullscreen")).toBeNull();
  const nodeSpan = await pinnedFlow.locator(".react-flow__node").evaluateAll((elements) => {
    const boxes = elements.map((element) => element.getBoundingClientRect());
    return Math.max(...boxes.map((box) => box.right)) - Math.min(...boxes.map((box) => box.left));
  });
  expect(nodeSpan).toBeGreaterThan(500);
  const pinnedFullscreenShot = testInfo.outputPath("workflow-pinned-fullscreen.png");
  await page.screenshot({ path: pinnedFullscreenShot });
  await testInfo.attach("Pinned Workflow fullscreen", {
    path: pinnedFullscreenShot,
    contentType: "image/png",
  });
  await pinnedSurface.getByRole("button", { name: "Exit fullscreen" }).click();
  await expect(pinnedSurface).toHaveAttribute("data-preview-fullscreen", "false");
  await expect
    .poll(() => pinnedFlow.locator(".react-flow__viewport").getAttribute("style"))
    .toBe(splitViewportTransform);
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const [type, path, heading] of [
    ["whiteboard", WHITEBOARD_PATH, "Product Launch Whiteboard"],
    ["workflow", WORKFLOW_PATH, "Lead Intake Workflow"],
  ] as const) {
    test(`${heading} actions and fullscreen stay inside the viewport`, async ({
      page,
    }, testInfo) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      const header = page.locator("[data-dashboard-active-view] header");
      const topbar = page.locator("[data-dashboard-topbar]");
      for (const region of [header, topbar]) {
        const metrics = await region.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          rect: element.getBoundingClientRect().toJSON(),
        }));
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
        expect(metrics.rect.left).toBeGreaterThanOrEqual(0);
        expect(metrics.rect.right).toBeLessThanOrEqual(390);
      }

      const inlineShot = testInfo.outputPath(`${type}-mobile-preview.png`);
      await page.screenshot({ path: inlineShot });
      await testInfo.attach(`${heading} on mobile`, {
        path: inlineShot,
        contentType: "image/png",
      });

      const surface = mainSurface(page, type);
      await page.getByRole("button", { name: "Enter fullscreen" }).click();
      await expect(surface).toHaveAttribute("data-preview-fullscreen", "true");
      await expectFullscreenCoverage(page, surface);
      await surface.getByRole("button", { name: "Exit fullscreen" }).click();
      await expect(surface).toHaveAttribute("data-preview-fullscreen", "false");
    });
  }
});
