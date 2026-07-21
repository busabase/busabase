import { expect, test } from "./_fixtures";

test("REST OPTIONS advertises node change-request methods", async ({ request }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL ?? "http://localhost:15419");
  const response = await request.fetch(
    new URL("/api/v1/nodes/change-requests", baseURL).toString(),
    {
      method: "OPTIONS",
    },
  );

  expect(response.status()).toBe(204);
  expect(response.headers()["access-control-allow-methods"]).toContain("POST");
  expect(response.headers()["access-control-allow-methods"]).toContain("OPTIONS");
});

test("Install from GitHub lives in the workspace menu", async ({ page }) => {
  await page.goto("/dashboard/local");
  await expect(page.getByRole("link", { name: "Install from GitHub" })).toHaveCount(0);

  await page.getByRole("button", { name: /Busabase.*Trusted Intelligent Database/ }).click();
  await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Assets" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Install from GitHub" })).toBeVisible();

  await page.getByRole("menuitem", { name: "Install from GitHub" }).click();
  await expect(page.getByRole("dialog", { name: "Install from GitHub" })).toBeVisible();
});

test("dashboard routes render the review-first seeded experience", async ({ page }) => {
  await page.goto("/dashboard/local");
  await expect(
    page.getByRole("button", { name: /Busabase.*Trusted Intelligent Database/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Activity" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "Assets" })).toHaveCount(0);
  await page.getByRole("button", { name: /Busabase.*Trusted Intelligent Database/ }).click();
  await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Assets" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Graph View" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Assets" }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/assets$/);
  await page.goto("/dashboard/local");
  // Seeded tree: CMS holds Blog Posts; Marketing holds Social Content + Newsletter.
  // Folders collapse by default, each with its own "Toggle" — expand per folder.
  await expect(page.getByRole("link", { exact: true, name: "CMS" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "Marketing" })).toBeVisible();
  const cmsFolder = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { exact: true, name: "CMS" }) });
  await cmsFolder.getByRole("button", { name: "Toggle" }).click();
  await expect(page.getByRole("link", { exact: true, name: "Blog Posts" })).toBeVisible();
  const marketingFolder = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { exact: true, name: "Marketing" }) });
  await marketingFolder.getByRole("button", { name: "Toggle" }).click();
  await expect(page.getByRole("link", { exact: true, name: "Social Content" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "Newsletter" })).toBeVisible();

  // The inbox lists review items (count is client-rendered). Assert the structural
  // "For review N" tab rather than specific CR risk-badge previews, whose copy churns
  // with the seed.
  await expect(page.getByRole("link", { name: /For review \d+/ })).toBeVisible();

  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByPlaceholder(/Search records/).fill("agent");
  await expect(page.getByRole("tab", { name: /Recent/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: /^Agent Integrations/ })).toBeVisible();

  await page.goto("/dashboard/local/activity");
  await expect(page.getByText("Workspace activity")).toBeVisible();
  // The activity feed no longer renders a "N change requests · M operations ·
  // K records" summary line (messages.activity.activityStats is defined in
  // i18n but unused by the component — dead copy from a past redesign); the
  // per-entry feed itself is what actually proves the seed's activity shows
  // up, same as the assertion right below.
  await expect(
    page.getByRole("link", { name: /Change request|operation|Record/i }).first(),
  ).toBeVisible();

  await page.goto("/dashboard/local/base/blog");
  await expect(page.getByRole("heading", { name: "Blog Posts" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "All" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "Ready to publish" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "Drafts" })).toBeVisible();
  // The seeded blog base renders canonical records; switching saved views changes
  // the URL and re-filters. Assert structure/behaviour, not volatile seed content.
  await expect(page.getByRole("link", { name: "New record" })).toBeVisible();

  await page.getByRole("link", { exact: true, name: "Ready to publish" }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/base\/blog\/ready-to-publish$/);
  await expect(page.getByRole("heading", { name: "Blog Posts" })).toBeVisible();

  await page.getByRole("link", { exact: true, name: "Drafts" }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/base\/blog\/drafts$/);
  await expect(page.getByRole("heading", { name: "Blog Posts" })).toBeVisible();

  // Create a record as a Change Request (the primary "Submit Request" action).
  await page.goto("/dashboard/local/base/blog/new");
  await expect(page.getByText("New Blog Posts record")).toBeVisible();
  await page.getByLabel("Title").fill("Smoke test AI market note");
  await page.getByLabel("Body").fill("A browser smoke test creates this change request note.");
  await page.getByRole("button", { name: "Submit Request" }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/inbox\/crq/);
  await expect(
    page.getByRole("heading", { name: "Smoke test AI market note" }).first(),
  ).toBeVisible();
  await expect(page.getByText("Waiting for your review")).toBeVisible();

  // Create + merge in one step via the "More submit options → Submit Now" split button.
  await page.goto("/dashboard/local/base/blog/new");
  await expect(page.getByText("New Blog Posts record")).toBeVisible();
  await page.getByLabel("Title").fill("Smoke direct merge AI note");
  await page.getByLabel("Body").fill("A browser smoke test creates and merges this note.");
  await page.getByRole("button", { name: "More submit options" }).click();
  await page.getByRole("button", { name: "Submit Now" }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/base\/blog\/rec/);
  await expect(page.getByRole("heading", { name: "Smoke direct merge AI note" })).toBeVisible();
  await expect(page.getByText("Lineage", { exact: true })).toBeVisible();

  // Edit opens the record form; delete lives behind the record "⋯" (<details>) menu.
  await page.getByRole("link", { exact: true, name: "Edit" }).click();
  await expect(page.getByLabel("Title")).toBeVisible();
  await page.goBack();
  await page.locator("details").filter({ hasText: "Delete change request" }).first().click();
  await page.getByRole("button", { name: "Delete & Merge" }).click();
  await expect(page.getByText("Delete and merge now?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Smoke direct merge AI note" })).toBeVisible();

  await page.goto("/dashboard/local/inbox/crq_seed_newsletter_html_brief");
  await expect(page.getByText("What will change")).toBeVisible();
  // Expand the long-text operation; its title varies with the seed.
  await page
    .getByRole("button", { name: /Weekend briefing/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Show full" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Show full" }).first().click();
  await expect(page.getByRole("button", { name: "Show less" }).first()).toBeVisible();
  // HTML is rendered safely — no raw script leaks through.
  await expect(page.getByText("alert('unsafe')")).toHaveCount(0);

  await page.goto("/dashboard/local/inbox/crq_seed_view_ready");
  await expect(page.getByRole("heading", { name: "Ready with sources" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Update view.*Ready with sources/ })).toBeVisible();
  await expect(page.getByText("Source URL is not empty")).toBeVisible();
  await expect(page.getByText("filter").first()).toBeVisible();
});
