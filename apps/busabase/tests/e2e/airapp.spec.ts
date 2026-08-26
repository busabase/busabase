import { type APIRequestContext, expect, json, type Page, test, unique } from "./_fixtures";

// AirApp's Run panel is a real in-browser sandboxed Node.js runtime
// (@scelar/nodepod, see packages/busabase-core/src/domains/airapp/components/
// runners/nodepod-runner.ts) — opening an AirApp genuinely does `npm install` +
// `npm run dev` inside a virtual filesystem and serves a real preview over an
// iframe `src`. That's slow (a real npm install, real network fetches for
// package tarballs) and only works in a real browser, so this is a genuine
// Playwright e2e spec, not a mocked unit test. The CRUD/file-operations side
// of AirApp (create/list/get/readFile/change-requests) has no browser
// component and is covered instead by
// packages/busabase-core/tests/airapp-orpc.test.ts.
//
// Setup creates AirApps via the REST API (autoMerge: true) rather than
// through UI forms — same reasoning as review-experience.spec.ts /
// review-verdicts.spec.ts: the local single-connection PGLite dev DB can 500
// a browser write that overlaps the SPA's background refetches. The UI only
// drives the actual behavior under test: auto-run on open, restart, watermark
// absence, run-state persistence across client-side navigation, fullscreen,
// and the side panel.
//
// A real "npm install" + Hono server boot inside Nodepod takes real
// wall-clock seconds, so this file needs generous timeouts. Later runs are
// faster than the first: Nodepod snapshot-caches installed node_modules in
// IndexedDB keyed by the dependency manifest, so the restart step and app B
// (same default seed project) restore from cache instead of the network.

interface AirAppNodeVO {
  node: { id: string; slug: string; name: string; type: string };
  entryFile: string;
  files: Array<{ path: string; name: string }>;
}

const RUN_READY_TIMEOUT = 120_000;
test.setTimeout(300_000);

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Default seed project (no custom `files`) is a plain Hono + `@hono/node-server`
// app — a real, runnable project, no need to reach for demo-content.ts's fuller
// gallery for this.
const createAirApp = async (request: APIRequestContext, namePrefix: string) => {
  const name = unique(namePrefix);
  const slug = slugify(name);
  const created = await json<AirAppNodeVO>(
    await request.post("/api/v1/file-trees", {
      data: { type: "airapp", autoMerge: true, slug, name },
    }),
  );
  return { name, slug, nodeId: created.node.id };
};

const sidebarLink = (page: Page, name: string) =>
  page.locator('[data-sidebar="sidebar"]').getByRole("link", { name, exact: true });

// Check the selected node's state rather than its toolbar position or localized
// label. The same node can also be rendered in the side panel, hence `.first()`.
const expectRunning = (page: Page, nodeId: string) =>
  expect(
    page
      .locator(`[data-airapp-node-id="${nodeId}"][data-airapp-run-status="ready"]:visible`)
      .first(),
  ).toBeVisible({ timeout: RUN_READY_TIMEOUT });

const mainPreview = (page: Page) =>
  page.locator('[data-dashboard-active-view] iframe[title="AirApp preview"]:visible');

const mainPreviewFrame = (page: Page) =>
  page.frameLocator('[data-dashboard-active-view] iframe[title="AirApp preview"]:visible');

const sidePanel = (page: Page) => page.getByRole("region", { name: "Side panel" });

const sidePanelPreview = (page: Page) =>
  sidePanel(page).locator('iframe[title="AirApp preview"]:visible');

const sidePanelPreviewFrame = (page: Page) =>
  page.frameLocator('[aria-label="Side panel"] iframe[title="AirApp preview"]:visible');

// Fullscreen is the SAME preview container grown to fill the viewport — not a
// separate overlay with its own iframe. Selecting it by the fullscreen state
// attribute keeps that invariant honest: if a regression ever reintroduces a
// second iframe, the `toHaveCount(1)` assertions below fail.
const fullscreenPreview = (page: Page) => page.locator('[data-airapp-fullscreen="true"]');

// Only the VISIBLE previews: `AirAppKeepAliveHost` deliberately keeps every
// previously-visited AirApp's iframe mounted-but-display:none, so a global
// count would legitimately exceed 1. What must never happen is two visible
// previews of the same app — that is the duplicate-iframe bug.
const visiblePreviewIframes = (page: Page) =>
  page.locator('iframe[title="AirApp preview"]:visible');

test("AirApp run panel: auto-run, restart, watermark, nav persistence, fullscreen, side panel", async ({
  page,
  request,
}) => {
  const appA = await createAirApp(request, "Airapp Regression A");
  const appB = await createAirApp(request, "Airapp Regression B");

  let appASrc = "";

  await test.step("first client-side visit claims the page and auto-runs without a refresh", async () => {
    await page.goto("/dashboard/local");
    await expect(sidebarLink(page, appA.name)).toBeVisible();
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();

    // This is intentionally a sidebar click rather than page.goto(): the
    // dashboard document starts uncontrolled, then the AirApp's auto-run must
    // register/activate the worker and explicitly claim this existing page.
    await sidebarLink(page, appA.name).click();
    await expect(page.getByRole("heading", { name: appA.name })).toBeVisible();

    // No Run click — opening the detail view starts the app by itself.
    await expectRunning(page, appA.nodeId);
    await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).not.toBeNull();

    const iframe = mainPreview(page);
    await expect(iframe).toBeVisible();
    await expect(visiblePreviewIframes(page)).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp(`/dashboard/local/airapp/${appA.slug}$`));
    appASrc = (await iframe.getAttribute("src")) ?? "";
    expect(appASrc.length).toBeGreaterThan(0);
  });

  await test.step("shared fullscreen URL still auto-runs and reuses one preview iframe", async () => {
    await page.goto(`/dashboard/local/airapp/${appA.slug}?fullscreen=1`);
    await expect(page.getByRole("heading", { name: appA.name })).toBeVisible();
    await expectRunning(page, appA.nodeId);

    const fullscreen = fullscreenPreview(page);
    await expect(fullscreen).toBeVisible();
    await expect(fullscreen.locator('iframe[title="AirApp preview"]')).toBeVisible();
    await expect(visiblePreviewIframes(page)).toHaveCount(1);
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/local/airapp/${appA.slug}\\?fullscreen=1$`),
    );

    await fullscreen.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(fullscreen).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/dashboard/local/airapp/${appA.slug}$`));
    appASrc = (await mainPreview(page).getAttribute("src")) ?? "";
    expect(appASrc.length).toBeGreaterThan(0);
  });

  await test.step("watermark is gone (regression for watermark: false)", async () => {
    const frame = mainPreviewFrame(page);
    const nodepodWatermarkLinks = frame.locator(
      'a[href*="github.com/ScelarOrg/Nodepod"], a[href*="github.com/R1ck404/Nodepod"]',
    );
    await expect(nodepodWatermarkLinks).toHaveCount(0);
  });

  await test.step("restart: a second run on the same node reaches ready again (regression: proxy singleton dropped every post-first onServerReady)", async () => {
    await page.getByRole("button", { name: "Restart" }).click();
    // Restart disposes the old Nodepod and boots a fresh one; before the fix
    // the new boot's server-ready event was delivered to the disposed
    // runner's (cleared) callbacks, so the run hung at "Starting dev server…"
    // forever and this assertion times out.
    await expectRunning(page, appA.nodeId);
    const iframe = mainPreview(page);
    await expect(iframe).toBeVisible();
    appASrc = (await iframe.getAttribute("src")) ?? "";
    expect(appASrc.length).toBeGreaterThan(0);
  });

  await test.step("three hard refreshes auto-run without exposing a query cancellation error", async () => {
    for (const refreshAttempt of [1, 2, 3]) {
      await page.reload();
      await expect(page.getByRole("heading", { name: appA.name })).toBeVisible();

      // No Restart click after reload: every fresh page must recover to Running by itself.
      await expectRunning(page, appA.nodeId);
      await expect(page.getByText(/Cancell?edError/)).toHaveCount(0);
      const iframe = mainPreview(page);
      await expect(iframe).toBeVisible();
      appASrc = (await iframe.getAttribute("src")) ?? "";
      expect(appASrc.length, `refresh attempt ${refreshAttempt} preview URL`).toBeGreaterThan(0);
    }
  });

  await test.step("iframe memory survives switching away and back via client-side navigation", async () => {
    const counter = mainPreviewFrame(page).getByRole("button", { name: "Clicked 0 times" });
    await counter.click();
    await expect(
      mainPreviewFrame(page).getByRole("button", { name: "Clicked 1 times" }),
    ).toBeVisible();

    // Client-side nav (sidebar link click), NOT page.goto — a hard reload would
    // trivially "lose" the zustand run state and prove nothing about the fix.
    await sidebarLink(page, appB.name).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/local/airapp/${appB.slug}$`));
    await expect(page.getByRole("heading", { name: appB.name })).toBeVisible();
    // B auto-runs on first open too; it shares A's dependency manifest, so its
    // install restores from the IndexedDB snapshot cache. Both A and B running
    // at once also exercises the per-instance server-ready filtering — before
    // the proxy fix, one node's ready event landed on the other's callbacks.
    await expectRunning(page, appB.nodeId);
    const iframeB = mainPreview(page);
    await expect(iframeB).toBeVisible();
    const appBSrc = (await iframeB.getAttribute("src")) ?? "";
    expect(appBSrc.length).toBeGreaterThan(0);
    expect(appBSrc).not.toBe(appASrc);

    await sidebarLink(page, appA.name).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/local/airapp/${appA.slug}$`));
    await expect(page.getByRole("heading", { name: appA.name })).toBeVisible();

    // Still ready with ITS OWN preview — not reset to idle, not B's src.
    await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
    const iframe = mainPreview(page);
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute("src", appASrc);
    await expect(
      mainPreviewFrame(page).getByRole("button", { name: "Clicked 1 times" }),
    ).toBeVisible();
  });

  await test.step("fullscreen keeps the SAME running app: no reload, no lost state (regression: fullscreen used to mount a second iframe)", async () => {
    // Tag the live iframe element so we can prove the very same DOM node — not
    // a look-alike pointing at the same src — is what fills the viewport.
    await mainPreview(page).evaluate((iframe) => {
      iframe.setAttribute("data-e2e-iframe-identity", "main-airapp-a");
    });
    // The counter inside the app is at 1 from the navigation step above; bump
    // it to 2 so the expected value can't be confused with a fresh boot's 0.
    await mainPreviewFrame(page).getByRole("button", { name: "Clicked 1 times" }).click();
    await expect(
      mainPreviewFrame(page).getByRole("button", { name: "Clicked 2 times" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Enter fullscreen" }).click();
    const fullscreen = fullscreenPreview(page);
    await expect(fullscreen).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/local/airapp/${appA.slug}\\?fullscreen=1$`),
    );
    await expect(fullscreen).toHaveCSS("position", "fixed");

    const bounds = await fullscreen.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).toEqual({ x: 0, y: 0, width: viewport?.width, height: viewport?.height });

    // The heart of the fix: exactly one preview iframe exists, it is the very
    // element that was already running, and the app inside never rebooted (a
    // reload would reset the counter to "Clicked 0 times").
    await expect(visiblePreviewIframes(page)).toHaveCount(1);
    const fullscreenIframe = fullscreen.locator('iframe[title="AirApp preview"]');
    await expect(fullscreenIframe).toBeVisible();
    await expect(fullscreenIframe).toHaveAttribute("data-e2e-iframe-identity", "main-airapp-a");
    await expect(fullscreenIframe).toHaveAttribute("src", appASrc);
    await expect(
      mainPreviewFrame(page).getByRole("button", { name: "Clicked 2 times" }),
    ).toBeVisible();

    // Escape exits — checked here, while focus is still in the host document.
    // (Escape is a host-window listener, so it cannot fire once the user has
    // clicked into the app's own iframe; the floating Exit button below is the
    // exit path that always works. Same before and after this change.)
    await page.keyboard.press("Escape");
    await expect(fullscreen).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/dashboard/local/airapp/${appA.slug}$`));

    await page.getByRole("button", { name: "Enter fullscreen" }).click();
    await expect(fullscreen).toBeVisible();

    // The app stays interactive while fullscreen, and the Exit button still
    // works afterwards — i.e. with focus inside the guest document.
    await mainPreviewFrame(page).getByRole("button", { name: "Clicked 2 times" }).click();
    await expect(
      mainPreviewFrame(page).getByRole("button", { name: "Clicked 3 times" }),
    ).toBeVisible();

    await fullscreen.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(fullscreen).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/dashboard/local/airapp/${appA.slug}$`));

    // Back inline: still the same element, still the same in-page state.
    const restored = mainPreview(page);
    await expect(restored).toBeVisible();
    await expect(restored).toHaveAttribute("data-e2e-iframe-identity", "main-airapp-a");
    await expect(
      mainPreviewFrame(page).getByRole("button", { name: "Clicked 3 times" }),
    ).toBeVisible();
  });

  await test.step("pin AirApp A to the side panel", async () => {
    await page.getByRole("button", { name: "Pin to side panel" }).click();
    const tabA = page.locator('[role="tab"]', { hasText: appA.name });
    await expect(tabA).toBeVisible();

    const counter = sidePanelPreviewFrame(page).getByRole("button", { name: "Clicked 0 times" });
    await counter.click();
    await expect(
      sidePanelPreviewFrame(page).getByRole("button", { name: "Clicked 1 times" }),
    ).toBeVisible();
    await sidePanelPreview(page).evaluate((iframe) => {
      iframe.setAttribute("data-e2e-iframe-identity", "pinned-airapp-a");
    });
  });

  await test.step("side panel supports split, maximized, fullscreen, and restore modes", async () => {
    const panel = sidePanel(page);
    await expect(panel).toHaveAttribute("data-layout", "split");
    await expect(panel).toBeVisible();
    const splitBounds = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(splitBounds).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(splitBounds?.width).toBe(420);
    expect((splitBounds?.x ?? 0) + (splitBounds?.width ?? 0)).toBeLessThanOrEqual(
      viewport?.width ?? 0,
    );

    const resizeHandle = panel.getByRole("button", { name: "Resize side panel" });
    const resizeBounds = await resizeHandle.boundingBox();
    expect(resizeBounds).not.toBeNull();
    if (!resizeBounds) {
      throw new Error("Side panel resize handle has no bounds");
    }
    await page.mouse.move(
      resizeBounds.x + resizeBounds.width / 2,
      resizeBounds.y + resizeBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      resizeBounds.x + resizeBounds.width / 2 - 80,
      resizeBounds.y + resizeBounds.height / 2,
    );
    await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox())?.width).toBe(500);

    await panel.getByRole("button", { name: "Maximize side panel" }).click();
    await expect(panel).toHaveAttribute("data-layout", "maximized");
    await expect(panel).toHaveCSS("position", "fixed");

    await panel.getByRole("button", { name: "Enter fullscreen" }).click();
    const fullscreen = fullscreenPreview(page);
    await expect(fullscreen).toBeVisible();
    // Fullscreen is `position: fixed`, and this is the nastiest nesting for
    // that: the maximized side panel is itself fixed. Assert real viewport
    // bounds, because an ancestor with transform/filter/contain would silently
    // turn the fixed preview into a panel-sized box instead.
    await expect(fullscreen).toHaveCSS("position", "fixed");
    expect(await fullscreen.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: page.viewportSize()?.width,
      height: page.viewportSize()?.height,
    });
    // The pinned preview is the one that grew — it is still the same element,
    // so the counter clicked in the previous step is untouched.
    await expect(fullscreen.locator('iframe[title="AirApp preview"]')).toHaveAttribute(
      "data-e2e-iframe-identity",
      "pinned-airapp-a",
    );
    await expect(
      sidePanelPreviewFrame(page).getByRole("button", { name: "Clicked 1 times" }),
    ).toBeVisible();
    await fullscreen.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(fullscreen).toHaveCount(0);
    await expect(panel).toHaveAttribute("data-layout", "maximized");

    await panel.getByRole("button", { name: "Restore side panel" }).click();
    await expect(panel).toHaveAttribute("data-layout", "split");
    await expect.poll(async () => (await panel.boundingBox())?.width).toBe(500);
  });

  await test.step("pinned iframe memory survives main navigation and panel collapse", async () => {
    await sidebarLink(page, appB.name).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/local/airapp/${appB.slug}$`));
    await expect(mainPreviewFrame(page).getByRole("heading", { name: appB.name })).toBeVisible();
    await expectRunning(page, appB.nodeId);
    await expect(sidePanelPreview(page)).toHaveAttribute(
      "data-e2e-iframe-identity",
      "pinned-airapp-a",
    );
    await expect(
      sidePanelPreviewFrame(page).getByRole("button", { name: "Clicked 1 times" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Pin to side panel" }).click();
    const tabA = page.getByRole("tab", { name: appA.name });
    const tabB = page.getByRole("tab", { name: appB.name });
    await expect(tabB).toHaveAttribute("aria-selected", "true");
    await sidePanelPreviewFrame(page).getByRole("button", { name: "Clicked 0 times" }).click();
    await expect(
      sidePanelPreviewFrame(page).getByRole("button", { name: "Clicked 1 times" }),
    ).toBeVisible();

    await tabA.click();
    await expect(sidePanelPreview(page)).toHaveAttribute(
      "data-e2e-iframe-identity",
      "pinned-airapp-a",
    );
    await expect(
      sidePanelPreviewFrame(page).getByRole("button", { name: "Clicked 1 times" }),
    ).toBeVisible();
    await tabB.click();
    await expect(
      sidePanelPreviewFrame(page).getByRole("button", { name: "Clicked 1 times" }),
    ).toBeVisible();
    await tabA.click();

    // "Home" is the pinned top nav item every Busabase host has (see
    // dashboard-shell.tsx's pinnedNav) — a real client-side route transition
    // away from any AirApp view.
    await sidebarLink(page, "Home").click();
    await expect(page).toHaveURL(/\/dashboard\/local\/home$/);
    await expect(page.locator(`[data-dashboard-airapp-view="${appB.slug}"]`)).toBeHidden();

    await expect(tabA).toBeVisible();
    // Main canvas is now Home (no AirApp view of its own), so this resolves
    // unambiguously to the side panel's still-live preview.
    const iframe = sidePanelPreview(page);
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute("src", appASrc);
    await expect(iframe).toHaveAttribute("data-e2e-iframe-identity", "pinned-airapp-a");
    await expect(
      sidePanelPreviewFrame(page).getByRole("button", { name: "Clicked 1 times" }),
    ).toBeVisible();

    await sidePanel(page).getByRole("button", { name: "Collapse side panel" }).click();
    await expect(sidePanel(page)).toBeHidden();
    await page.getByRole("button", { name: "Open side panel" }).click();
    await expect(sidePanel(page)).toBeVisible();
    await expect(sidePanelPreview(page)).toHaveAttribute(
      "data-e2e-iframe-identity",
      "pinned-airapp-a",
    );
    await expect(
      sidePanelPreviewFrame(page).getByRole("button", { name: "Clicked 1 times" }),
    ).toBeVisible();

    await sidebarLink(page, appA.name).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/local/airapp/${appA.slug}$`));
    // 3, not 1: the fullscreen step above clicked the main preview's counter
    // twice more and — this being the whole point of the fix — nothing since
    // has rebooted that iframe.
    await expect(
      mainPreviewFrame(page).getByRole("button", { name: "Clicked 3 times" }),
    ).toBeVisible();
    await expect(
      sidePanelPreviewFrame(page).getByRole("button", { name: "Clicked 1 times" }),
    ).toBeVisible();
  });
});
