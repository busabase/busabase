import type { BaseVO, RecordVO } from "busabase-contract/types";
import { expect, json, test, unique } from "./_fixtures";

test("Record Detail pins a read-only record that survives main-canvas navigation", async ({
  page,
  request,
}, testInfo) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const title = unique("Pinned customer");
  const email = `pinned-${suffix}@example.com`;
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        description: "Playwright coverage for pinned Record Detail previews.",
        fields: [
          { name: "Name", required: true, slug: "name", type: "text" },
          { name: "Email", slug: "email", type: "email" },
        ],
        name: unique("Pinned Records"),
        slug: `record-detail-pin-${suffix}`,
      },
    }),
  );
  const record = await json<RecordVO>(
    await request.post(`/api/v1/bases/${base.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: { email, name: title },
        message: "Create Record Detail pin fixture",
        submittedBy: "playwright",
      },
    }),
  );

  await test.step("open the record and pin it from the topbar", async () => {
    await page.goto(`/dashboard/base/${base.slug}/${record.id}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible({
      timeout: 45_000,
    });
    await page
      .locator("[data-dashboard-topbar]")
      .getByRole("button", { name: "Pin to side panel" })
      .click();

    const panel = page.getByRole("region", { name: "Side panel" });
    const preview = panel.locator(`[data-record-side-panel-preview="${record.id}"]`);
    await expect(panel).toBeVisible();
    await expect(preview.getByRole("heading", { name: title })).toBeVisible();
    await expect(preview.getByText(email, { exact: true })).toBeVisible();
    await expect(preview.getByRole("button", { name: /edit|delete/i })).toHaveCount(0);

    const pinnedScreenshot = testInfo.outputPath("record-detail-pinned.png");
    await page.screenshot({ path: pinnedScreenshot });
    await testInfo.attach("Record Detail pinned to the side panel", {
      path: pinnedScreenshot,
      contentType: "image/png",
    });
  });

  await test.step("navigate the main canvas while the pinned record remains visible", async () => {
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/local\/home/);

    const panel = page.getByRole("region", { name: "Side panel" });
    const preview = panel.locator(`[data-record-side-panel-preview="${record.id}"]`);
    await expect(preview.getByRole("heading", { name: title })).toBeVisible();
    await expect(preview.getByText(email, { exact: true })).toBeVisible();

    const screenshot = testInfo.outputPath("record-pinned-after-navigation.png");
    await page.screenshot({ path: screenshot });
    await testInfo.attach("Pinned record after main-canvas navigation", {
      path: screenshot,
      contentType: "image/png",
    });
  });

  await test.step("close the pinned record tab", async () => {
    const panel = page.getByRole("region", { name: "Side panel" });
    await panel.getByRole("button", { name: "Close tab" }).click();
    await expect(panel.locator(`[data-record-side-panel-preview="${record.id}"]`)).toHaveCount(0);
    await expect(panel.getByText("Nothing pinned", { exact: true })).toBeVisible();

    const closedScreenshot = testInfo.outputPath("record-pin-closed.png");
    await page.screenshot({ path: closedScreenshot });
    await testInfo.attach("Record pin closed to the empty side panel", {
      path: closedScreenshot,
      contentType: "image/png",
    });
  });
});
