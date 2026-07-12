import { expect, test } from "./_fixtures";

// A new user's first-session WALKTHROUGH of the seeded (db:seed:all) workspace,
// recorded to video as one continuous tour of the approval-first knowledge base:
//   land on the dashboard → browse a content base and its saved views → tour the
//   Field Type Lab schema → search the seeded content → check the activity feed.
//
// This spec is read-only on purpose, so the recording is deterministic. The
// create → approve → merge WRITE flow (composing a record through the form and
// merging it) is covered — and recorded — by field-type-lab.spec.ts. Browser-driven
// writes are kept out of this multi-page tour because the local single-connection
// PGLite dev DB intermittently 500s a write that overlaps the SPA's background list
// refetches (the same reason review-experience.spec.ts performs its writes over the
// API); against a concurrency-capable DB the writes work inline here too.
//
// Recorded clip lands at apps/busabase/test-results/<slug>/video.webm.
// Run it (proxies off so Chromium can reach localhost):
//   cp .env.example .env && pnpm db:migrate && pnpm db:seed:all
//   PORT=15419 pnpm dev
//   env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
//     NO_PROXY=localhost,127.0.0.1,::1 \
//     pnpm exec playwright test tests/e2e/new-user-journey.spec.ts

test.use({
  viewport: { width: 1280, height: 800 },
  // Record the whole journey; slow the actions down so the clip is watchable.
  video: { mode: "on", size: { width: 1280, height: 800 } },
  launchOptions: { slowMo: 250 },
});

test("a new user tours the approval-first knowledge base", async ({ page }) => {
  await test.step("lands on the dashboard — focused review nav and title menu", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard\/inbox/);
    await expect(page.getByRole("link", { exact: true, name: "Inbox" })).toBeVisible();
    await expect(page.getByRole("link", { exact: true, name: "Activity" })).toBeVisible();
    await expect(page.getByRole("link", { exact: true, name: "Assets" })).toHaveCount(0);
    await expect(page.getByRole("link", { exact: true, name: "CMS" })).toBeVisible();
    await page.getByRole("button", { name: /Busabase/ }).click();
    await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Assets" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Graph View" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("browses the Blog Posts base and its saved views", async () => {
    await page.goto("/dashboard/base/blog");
    await expect(page.getByRole("heading", { name: "Blog Posts" })).toBeVisible();
    await expect(page.getByRole("link", { exact: true, name: "All" })).toBeVisible();
    await expect(page.getByRole("link", { exact: true, name: "Ready to publish" })).toBeVisible();
    await expect(page.getByRole("link", { exact: true, name: "Drafts" })).toBeVisible();
    // Approval-first: the base renders its records view (empty-state when nothing
    // has merged yet, or rows once it has). Assert the always-present "New record"
    // affordance rather than the empty-state text, so this stays order-independent
    // of the write specs that merge blog records into the shared seed.
    await expect(page.getByRole("link", { name: "New record" })).toBeVisible();
  });

  await test.step("switches between the base's saved views", async () => {
    await page.getByRole("link", { exact: true, name: "Ready to publish" }).click();
    await expect(page).toHaveURL(/\/dashboard\/base\/blog\/ready-to-publish$/);
    await page.getByRole("link", { exact: true, name: "Drafts" }).click();
    await expect(page).toHaveURL(/\/dashboard\/base\/blog\/drafts$/);
  });

  await test.step("tours the Field Type Lab — one column per field type", async () => {
    await page.goto("/dashboard/base/field-type-lab");
    await expect(page.getByRole("heading", { name: "Field Type Lab" })).toBeVisible();
    await expect(page.getByText("Number", { exact: true })).toBeVisible();
    await expect(page.getByText("Select", { exact: true })).toBeVisible();
    await expect(page.getByText("Relation").first()).toBeVisible();
  });

  await test.step("searches the seeded knowledge base", async () => {
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByPlaceholder(/Search records/).fill("busabase");
    // Verify search runs against the seed and reports results (content varies).
    await expect(page.getByText("result").first()).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("checks the workspace activity feed", async () => {
    await page.goto("/dashboard/activity");
    await expect(page.getByText("Workspace activity")).toBeVisible();
    // No "N change requests · M operations · K records" summary line is
    // rendered anymore (messages.activity.activityStats is defined in i18n
    // but unused by the component — dead copy from a past redesign); assert
    // the per-entry feed itself instead, which is what actually proves the
    // seed's activity shows up.
    await expect(
      page.getByRole("link", { name: /Change request|operation|Record/i }).first(),
    ).toBeVisible();
  });
});
