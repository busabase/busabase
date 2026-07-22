import type { BaseVO, ChangeRequestVO, RecordVO } from "busabase-contract/types";
import { cmsPostFields, expect, json, test, unique } from "./_fixtures";

test("Record Detail scrolls through long field content", async ({ page, request }) => {
  const bases = await json<BaseVO[]>(await request.get("/api/v1/bases"));
  const blog = bases.find((base) => base.slug === "blog");
  if (!blog) {
    throw new Error("The seeded blog base is required for the Record Detail scroll test");
  }

  const title = unique("E2E long record detail");
  const endMarker = unique("E2E record detail end");
  const body = [
    ...Array.from(
      { length: 40 },
      (_, index) =>
        `## Section ${index + 1}\n\nThis paragraph makes the record detail taller than the dashboard viewport.`,
    ),
    `## ${endMarker}`,
  ].join("\n\n");
  const changeRequest = await json<ChangeRequestVO>(
    await request.post(`/api/v1/bases/${blog.id}/change-requests`, {
      data: {
        fields: cmsPostFields({ body, title }),
        message: "Create a long record for the Record Detail scroll regression test",
        submittedBy: "playwright",
      },
    }),
  );
  await json(
    await request.post(`/api/v1/change-requests/${changeRequest.id}/reviews`, {
      data: { verdict: "approved" },
    }),
  );
  const merged = await json<{ record: RecordVO }>(
    await request.post(`/api/v1/change-requests/${changeRequest.id}/merge`, { data: {} }),
  );

  await page.goto(`/dashboard/base/blog/${merged.record.id}`);
  const scrollViewport = page.locator("[data-record-detail-scroll]");
  const endMarkerHeading = page.getByRole("heading", { name: endMarker });
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 45_000 });
  await expect(scrollViewport).toBeVisible();
  await page.getByRole("button", { name: "Show full" }).click();
  await expect
    .poll(() => scrollViewport.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);

  const endMarkerIsInsideViewport = async () => {
    const [markerBox, viewportBox] = await Promise.all([
      endMarkerHeading.boundingBox(),
      scrollViewport.boundingBox(),
    ]);
    if (!markerBox || !viewportBox) {
      return false;
    }
    return (
      markerBox.y >= viewportBox.y &&
      markerBox.y + markerBox.height <= viewportBox.y + viewportBox.height
    );
  };
  await expect.poll(endMarkerIsInsideViewport).toBe(false);

  await endMarkerHeading.scrollIntoViewIfNeeded();
  await expect
    .poll(() => scrollViewport.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect.poll(endMarkerIsInsideViewport).toBe(true);

  await scrollViewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(() =>
      scrollViewport.evaluate(
        (element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 1,
      ),
    )
    .toBe(true);
});
