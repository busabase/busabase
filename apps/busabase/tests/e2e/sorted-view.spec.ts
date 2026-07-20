import { expect, test } from "./_fixtures";

const RENDER_TIMEOUT = 45_000;

// Pin the locale so the `date` field renders as a deterministic M/D/YYYY string
// (toLocaleDateString) we can parse out of each row.
test.use({ locale: "en-US" });

/**
 * A — server-side sort push-down, verified end-to-end in the browser.
 *
 * The seeded blog "All records" view has NO filter and a `publish_date` DESC sort
 * — exactly the case where the server pushes the sort to the DB (A) and the client
 * renders the server's order without re-sorting. This drives that view in a real
 * browser and asserts the rendered rows are actually in publish_date-descending
 * order, complementing the keyset-correctness integration test.
 */
test("a server-sorted view renders records in publish_date-descending order", async ({ page }) => {
  await page.goto("/dashboard/local/base/blog/all-records");

  const rows = page.locator("[data-record-id]");
  await expect(rows.first()).toBeVisible({ timeout: RENDER_TIMEOUT });
  const count = await rows.count();
  expect(count).toBeGreaterThan(3); // a real, multi-record base

  // Each cell exposes its CLEAN value in a `title` attribute (row textContent
  // glues adjacent columns together, so we read per-cell titles instead). The
  // publish_date cell's title is exactly an M/D/YYYY date; priority/text titles
  // aren't. Rows with no publish_date sort LAST (nulls last) and are skipped.
  const dates: number[] = [];
  for (let i = 0; i < count; i++) {
    const titles = await rows
      .nth(i)
      .locator("[title]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("title") ?? ""));
    const dateTitle = titles.find((t) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t));
    if (!dateTitle) continue;
    const time = new Date(dateTitle).getTime();
    if (!Number.isNaN(time)) dates.push(time);
  }
  expect(dates.length).toBeGreaterThan(3);

  // The rendered order is non-increasing by publish_date — the server sort is
  // reflected in the DOM, not re-derived or dropped by the client.
  for (let i = 1; i < dates.length; i++) {
    expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
  }
});
