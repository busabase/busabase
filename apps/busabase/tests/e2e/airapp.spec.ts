import { type APIRequestContext, expect, json, type Page, test, unique } from "./_fixtures";

// AirApp's Run panel is a real in-browser sandboxed Node.js runtime
// (@scelar/nodepod, see packages/busabase-core/src/domains/airapp/components/
// runners/nodepod-runner.ts) — clicking "Run" genuinely does `npm install` +
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
// drives the actual behavior under test: Run, watermark absence, run-state
// persistence across client-side navigation (the regression this session's
// fix targets), fullscreen, and the side panel.
//
// A real "npm install" + Hono server boot inside Nodepod takes real
// wall-clock seconds, so this file needs generous timeouts.

interface AirAppNodeVO {
  node: { id: string; slug: string; name: string; type: string };
  entryFile: string;
  files: Array<{ path: string; name: string }>;
}

const RUN_READY_TIMEOUT = 120_000;
test.setTimeout(240_000);

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
    await request.post("/api/v1/airapps", {
      data: { autoMerge: true, slug, name },
    }),
  );
  return { name, slug, nodeId: created.node.id };
};

const sidebarLink = (page: Page, name: string) =>
  page.locator('[data-sidebar="sidebar"]').getByRole("link", { name, exact: true });

test("AirApp run panel: run, watermark, nav persistence, fullscreen, side panel", async ({
  page,
  request,
}) => {
  const appA = await createAirApp(request, "Airapp Regression A");
  const appB = await createAirApp(request, "Airapp Regression B");

  let appASrc = "";

  await test.step("core run flow: Run -> ready -> preview iframe visible with a src", async () => {
    await page.goto(`/dashboard/airapp/${appA.slug}`);
    await expect(page.getByRole("heading", { name: appA.name })).toBeVisible();

    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("button", { name: "Run again" })).toBeVisible({
      timeout: RUN_READY_TIMEOUT,
    });

    const iframe = page.locator('iframe[title="AirApp preview"]');
    await expect(iframe).toBeVisible();
    appASrc = (await iframe.getAttribute("src")) ?? "";
    expect(appASrc.length).toBeGreaterThan(0);
  });

  await test.step("watermark is gone (regression for watermark: false)", async () => {
    const frame = page.frameLocator('iframe[title="AirApp preview"]');
    const nodepodWatermarkLinks = frame.locator(
      'a[href*="github.com/ScelarOrg/Nodepod"], a[href*="github.com/R1ck404/Nodepod"]',
    );
    await expect(nodepodWatermarkLinks).toHaveCount(0);
  });

  await test.step("run state survives switching away and back via client-side navigation", async () => {
    // Client-side nav (sidebar link click), NOT page.goto — a hard reload would
    // trivially "lose" the zustand run state and prove nothing about the fix.
    await sidebarLink(page, appB.name).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/airapp/${appB.slug}$`));
    await expect(page.getByRole("heading", { name: appB.name })).toBeVisible();
    // B has never been run — fresh idle state, not "Run again".
    await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();

    await sidebarLink(page, appA.name).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/airapp/${appA.slug}$`));
    await expect(page.getByRole("heading", { name: appA.name })).toBeVisible();

    // Still ready, not reset to a fresh "Run" idle state — the actual bug fix.
    await expect(page.getByRole("button", { name: "Run again" })).toBeVisible();
    const iframe = page.locator('iframe[title="AirApp preview"]');
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute("src", appASrc);
  });

  await test.step("fullscreen: opens a dialog with the preview, closes cleanly", async () => {
    await page.getByRole("button", { name: "Expand to fullscreen" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('iframe[title="AirApp preview"]')).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    // The underlying page is still interactive — the inline preview iframe survives.
    await expect(page.locator('iframe[title="AirApp preview"]')).toBeVisible();
  });

  await test.step("pin AirApp A to the side panel", async () => {
    await page.getByRole("button", { name: "Open in side panel" }).click();
    const tabA = page.locator('[role="tab"]', { hasText: appA.name });
    await expect(tabA).toBeVisible();
  });

  await test.step("side panel is dashboard-level-persistent across a route change to a non-AirApp view", async () => {
    // "Inbox" is the pinned top nav item every Busabase host has (see
    // dashboard-shell.tsx's pinnedNav) — a real client-side route transition
    // away from any AirApp view.
    await sidebarLink(page, "Inbox").click();
    await expect(page).toHaveURL(/\/dashboard\/inbox$/);

    const tabA = page.locator('[role="tab"]', { hasText: appA.name });
    await expect(tabA).toBeVisible();
    // Main canvas is now Inbox (no AirApp view of its own), so this resolves
    // unambiguously to the side panel's still-live preview.
    const iframe = page.locator('iframe[title="AirApp preview"]');
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute("src", appASrc);
  });

  await test.step("pin AirApp B too — both tabs coexist and show their own content", async () => {
    await sidebarLink(page, appB.name).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/airapp/${appB.slug}$`));
    // Scoped to the main canvas's "App" tabpanel: once A is pinned, its side
    // panel tab renders the same AirAppRunPreview component (including ITS
    // own "Open in side panel" button), so the bare role/name query is no
    // longer unique on the page.
    await page
      .getByRole("tabpanel", { name: "App" })
      .getByRole("button", { name: "Open in side panel" })
      .click();

    const tabA = page.locator('[role="tab"]', { hasText: appA.name });
    const tabB = page.locator('[role="tab"]', { hasText: appB.name });
    await expect(tabA).toBeVisible();
    await expect(tabB).toBeVisible();

    // Navigate the main canvas off of both AirApps so the side panel's iframe
    // is the only "AirApp preview" node that can be VISIBLE — same
    // disambiguation as the Inbox step above. (Every open side-panel tab's
    // content stays mounted, just CSS-hidden when inactive — see
    // side-panel.tsx — so A's iframe is still present in the DOM even while
    // B's tab is active; assert on visibility, not presence.)
    await sidebarLink(page, "Inbox").click();
    await expect(page).toHaveURL(/\/dashboard\/inbox$/);

    // B was pinned last, so its (idle — never run) tab is active by default.
    await expect(page.getByText("Click Run to start this AirApp")).toBeVisible();
    await expect(page.locator('iframe[title="AirApp preview"]')).not.toBeVisible();

    // Switching to A's tab shows A's live, still-running preview.
    await tabA.click();
    const iframe = page.locator('iframe[title="AirApp preview"]');
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute("src", appASrc);

    // And back to B's tab shows B's idle state again, not A's.
    await tabB.click();
    await expect(page.getByText("Click Run to start this AirApp")).toBeVisible();
    await expect(page.locator('iframe[title="AirApp preview"]')).not.toBeVisible();
  });
});
