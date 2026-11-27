import type { BaseVO, RecordVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

// Below `lg` the record page grids had no column template, so their implicit
// `auto` column grew to the widest content and the page overflowed a phone
// screen on both sides (title and properties cut off). A Markdown code block
// with a long line is enough to trigger it; the title, URL, table and HTML page
// mirror the reported record.
test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });

test("record detail fits a phone screen with wide field content", async ({ page, request }) => {
  const slug = `record-mobile-${Date.now()}`;
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        name: slug,
        slug,
        fields: [
          { name: "Title", slug: "title", type: "text", required: true },
          { name: "Link", slug: "link", type: "url" },
          { name: "Notes", slug: "notes", type: "markdown" },
          { name: "Report", slug: "report", type: "html" },
        ],
      },
    }),
  );
  const title =
    "专题 · 2026-11-18 · 企业合作线索需求 | 朋友转介版（AI Rollup 标的画像）with-a-long-unbroken-token";
  const record = await json<RecordVO>(
    await request.post(`/api/v1/bases/${base.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: {
          title,
          link: `https://example.com/${"a-very-long-path-segment-".repeat(8)}`,
          notes: [
            "| Company | Revenue | Profit | Staff | Shareholders | Exit intent | Notes |",
            "|---|---|---|---|---|---|---|",
            "| A Company Limited | 120M | 15M | 500 | Founder 70% | Open to buyback | A long note |",
            "",
            // The unwrapped code line is what widens the page; the rest only
            // keeps the fixture close to the record that was reported.
            "```",
            "const veryLongLineOfCode = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree);",
            "```",
          ].join("\n"),
          report:
            '<!doctype html><html><body><div style="min-width:1100px;padding:60px">Wide page</div></body></html>',
        },
        message: "Create mobile record detail fixture",
        submittedBy: "playwright",
      },
    }),
  );

  await page.goto(`/dashboard/local/base/${slug}/${record.id}`);
  const heading = page.getByRole("heading", { level: 1, name: title });
  await expect(heading).toBeVisible();
  await expect(page.getByTestId("html-document-frame")).toBeVisible();

  const scroll = page.locator("[data-record-detail-scroll]");
  const overflow = await scroll.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // Table cells keep a readable width and the table scrolls inside its own
  // frame, instead of every column collapsing to one character per line.
  const table = page.locator('[data-record-field-slug="notes"] table');
  const cellWidths = await table
    .locator("th, td")
    .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));
  expect(Math.min(...cellWidths)).toBeGreaterThanOrEqual(79);
  const tableFrame = await table.evaluate((element) => {
    const frame = element.parentElement as HTMLElement;
    return { clientWidth: frame.clientWidth, scrollWidth: frame.scrollWidth };
  });
  expect(tableFrame.scrollWidth).toBeGreaterThan(tableFrame.clientWidth);

  const box = await heading.boundingBox();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(393);
});
