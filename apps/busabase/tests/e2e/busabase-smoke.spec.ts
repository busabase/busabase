import { expect, test } from "@playwright/test";

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

test("dashboard routes render the review-first seeded experience", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Busabase.*Approval-first KB/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Activity" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "Content" })).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Toggle" }).click();
  await expect(page.getByRole("link", { exact: true, name: "Blog Posts" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "Social Content" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "Newsletter" })).toBeVisible();

  await expect(page.getByRole("link", { name: /For review \d+/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /destructive/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /HTML.*long text/ }).first()).toBeVisible();

  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByPlaceholder("Search records, change requests, bases").fill("agent");
  await expect(page.getByText("result").first()).toBeVisible();

  await page.goto("/dashboard/activity");
  await expect(page.getByText("Workspace activity")).toBeVisible();
  await expect(page.getByText(/change requests · \d+ operations · \d+ records/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Change request|operation|Record/i }).first(),
  ).toBeVisible();

  await page.goto("/dashboard/base/blog");
  await expect(page.getByRole("heading", { name: "Blog Posts" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "All" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "Ready to publish" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "Drafts" })).toBeVisible();
  await expect(
    page.getByText("AI agents are moving from demos into operator workflows"),
  ).toBeVisible();
  await expect(page.getByText("Related Social Posts")).toBeVisible();

  await page.getByRole("link", { exact: true, name: "Ready to publish" }).click();
  await expect(page).toHaveURL(/\/dashboard\/base\/blog\/ready-to-publish$/);
  await expect(page.getByText("1 record · 2 filters")).toBeVisible();
  await expect(
    page.getByText("AI agents are moving from demos into operator workflows"),
  ).toBeVisible();
  await expect(page.getByText("AI video tools are becoming distribution products")).toHaveCount(0);
  await expect(page.getByText("Source URL")).toBeVisible();

  await page.getByRole("link", { exact: true, name: "Drafts" }).click();
  await expect(page).toHaveURL(/\/dashboard\/base\/blog\/drafts$/);
  await expect(page.getByText("1 record · 1 filter")).toBeVisible();
  await expect(page.getByText("AI video tools are becoming distribution products")).toBeVisible();
  await expect(
    page.getByText("AI agents are moving from demos into operator workflows"),
  ).toHaveCount(0);

  await page.goto("/dashboard/base/blog/new");
  await expect(page.getByText("New Blog Posts record")).toBeVisible();
  await expect(
    page.getByText("Create & Merge approves and merges now, bypassing separate review."),
  ).toBeHidden();
  await page.getByRole("button", { name: "Create & Merge" }).hover();
  await expect(
    page.getByText("Create & Merge approves and merges now, bypassing separate review."),
  ).toBeVisible();
  await page.getByLabel("Title").fill("Smoke test AI market note");
  await page.getByLabel("Body").fill("A browser smoke test creates this change request note.");
  await page.getByRole("button", { name: "Create Change Request" }).click();
  await expect(page).toHaveURL(/\/dashboard\/inbox\/qdf/);
  await expect(
    page.getByRole("heading", { name: "Smoke test AI market note" }).first(),
  ).toBeVisible();
  await expect(page.getByText("Waiting for your review")).toBeVisible();

  await page.goto("/dashboard/base/blog/new");
  await expect(page.getByText("New Blog Posts record")).toBeVisible();
  await expect(
    page.getByText("Create & Merge approves and merges now, bypassing separate review."),
  ).toBeHidden();
  await page.getByRole("button", { name: "Create & Merge" }).hover();
  await expect(
    page.getByText("Create & Merge approves and merges now, bypassing separate review."),
  ).toBeVisible();
  await page.getByLabel("Title").fill("Smoke direct merge AI note");
  await page.getByLabel("Body").fill("A browser smoke test creates and merges this note.");
  await page.getByRole("button", { name: "Create & Merge" }).click();
  await expect(page).toHaveURL(/\/dashboard\/base\/blog\/qrc/);
  await expect(page.getByRole("heading", { name: "Smoke direct merge AI note" })).toBeVisible();
  await expect(page.getByText("Lineage", { exact: true })).toBeVisible();
  await page.getByRole("link", { exact: true, name: "Edit" }).click();
  await expect(
    page.getByText("Save & Merge approves and merges now, bypassing separate review."),
  ).toBeHidden();
  await page.getByRole("button", { name: "Save & Merge" }).hover();
  await expect(
    page.getByText("Save & Merge approves and merges now, bypassing separate review."),
  ).toBeVisible();
  await page.goBack();
  await page.locator("details").filter({ hasText: "Delete & Merge" }).first().click();
  await page.getByRole("button", { name: "Delete & Merge" }).click();
  await expect(page.getByText("Delete and merge now?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Smoke direct merge AI note" })).toBeVisible();

  await page.goto("/dashboard/inbox/qdf_seed_newsletter_html_brief");
  await expect(page.getByText("Watch HTML and long text changes.")).toBeVisible();
  await expect(page.getByText("What will change")).toBeVisible();
  await page
    .getByRole("button", {
      name: "1. Create Weekend briefing: open-source agents and local knowledge bases",
    })
    .click();
  await expect(page.getByRole("button", { name: "Show full" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Show full" }).first().click();
  await expect(page.getByRole("button", { name: "Show less" }).first()).toBeVisible();
  await expect(page.getByText("alert('unsafe')")).toHaveCount(0);

  await page.goto("/dashboard/inbox/qdf_seed_view_ready");
  await expect(page.getByRole("heading", { name: "Ready with sources" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Update view.*Ready with sources/ })).toBeVisible();
  await expect(page.getByText("Source URL is not empty")).toBeVisible();
  await expect(page.getByText("filter").first()).toBeVisible();
});
