import type { Browser } from "@playwright/test";
import type { BaseVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

// A team spread across Beijing, London and San Francisco plans deliveries in one
// Base. Two promises are under test, each read in a real browser pinned to a
// real time zone:
//   1. A picked DAY is the same day for everyone. It used to be parsed as UTC
//      midnight and shown in local time, so everyone west of UTC saw the day
//      before — in the grid and on the calendar.
//   2. A date field can "Include time". The time is typed in the writer's zone,
//      each reader sees their own clock, and a reader whose day differs from
//      the writer's is told so.
//
// Screenshots are written next to the test output as a readable story.

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const baseSlug = `delivery-schedule-${suffix}`;

const openIn = async (
  browser: Browser,
  timezoneId: string,
  path: string,
  recordVideoDir?: string,
  mobile = false,
) => {
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 820 },
    ...(mobile ? { hasTouch: true, isMobile: true } : {}),
    ...(recordVideoDir ? { recordVideo: { dir: recordVideoDir } } : {}),
  });
  const page = await context.newPage();
  await page.goto(path, { waitUntil: "commit" });
  return page;
};

test.describe.configure({ mode: "serial" });

let base: BaseVO;

test.beforeAll(async ({ request }) => {
  base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        description: "Cross-timezone delivery dates",
        fields: [
          { name: "Title", required: true, slug: "title", type: "text" },
          { name: "Due Date", slug: "due", type: "date" },
          { name: "Deadline", slug: "deadline", type: "date" },
        ],
        name: `Delivery Schedule ${suffix}`,
        slug: baseSlug,
      },
    }),
  );
  await json(
    await request.post(`/api/v1/bases/${base.id}/records/bulk-change-request`, {
      data: {
        autoMerge: true,
        message: "Seed deliveries",
        records: [
          { due: "2026-10-02", title: "Launch landing page" },
          { due: "2026-10-01", title: "Ship mobile build" },
          { title: "Sign vendor contract" },
        ],
        submittedBy: "playwright",
      },
    }),
  );
  await json(
    await request.post("/api/v1/views/change-requests", {
      data: {
        autoMerge: true,
        baseId: base.id,
        config: { dateFieldSlug: "due", filters: [], sorts: [] },
        message: "Due calendar",
        name: "Due Calendar",
        operation: "create",
        slug: `due-calendar-${suffix}`,
        submittedBy: "playwright",
        type: "calendar",
      },
    }),
  );
});

test("a picked day is the same day in San Francisco, on the grid and the calendar", async ({
  browser,
}) => {
  const page = await openIn(browser, "America/Los_Angeles", `/dashboard/local/base/${baseSlug}`);
  const grid = page.getByTestId("base-records-grid");
  await expect(
    grid.locator("[data-record-id]").filter({ hasText: "Launch landing page" }),
  ).toContainText("Fri, Oct 2, 2026", { timeout: 60_000 });
  await expect(
    grid.locator("[data-record-id]").filter({ hasText: "Ship mobile build" }),
  ).toContainText("Thu, Oct 1, 2026");
  await page.screenshot({ path: test.info().outputPath("01-sf-grid.png") });

  await page.getByRole("link", { name: "Due Calendar" }).click();
  await page.getByRole("button", { name: /next/i }).first().waitFor();
  // Walk the calendar to October 2026 from wherever "today" is.
  const heading = page.getByText("October 2026").first();
  for (let step = 0; step < 24 && !(await heading.isVisible()); step += 1) {
    const now = new Date();
    const forward = now < new Date(2026, 9, 1);
    await page
      .getByRole("button", { name: forward ? /next/i : /prev/i })
      .first()
      .click();
  }
  await expect(heading).toBeVisible();
  const oct2 = page.locator('[data-calendar-day="2026-10-02"]');
  await expect(oct2).toContainText("Launch landing page");
  await expect(page.locator('[data-calendar-day="2026-10-01"]')).toContainText("Ship mobile build");
  await expect(page.locator('[data-calendar-day="2026-10-01"]')).not.toContainText(
    "Launch landing page",
  );
  await page.screenshot({ path: test.info().outputPath("02-sf-calendar.png") });
  await page.context().close();
});

test("Beijing turns on Include time and sets a Friday 18:00 deadline", async ({ browser }) => {
  const page = await openIn(browser, "Asia/Shanghai", `/dashboard/local/base/${baseSlug}/design`);
  await page
    .getByRole("button", { name: "Rename Deadline", exact: true })
    .click({ timeout: 60_000 });
  const dialog = page.getByRole("dialog", { name: /Edit field: Deadline/i });
  await dialog.getByTestId("date-field-include-time").check();
  await expect(dialog.getByTestId("date-field-timezone")).toHaveValue("");
  await page.screenshot({ path: test.info().outputPath("03-beijing-include-time.png") });
  await dialog.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  for (const [title, wallTime] of [
    ["Launch landing page", "2026-10-02T18:00"],
    ["Ship mobile build", "2026-10-03T01:00"],
  ] as const) {
    await page.goto(`/dashboard/local/base/${baseSlug}`, { waitUntil: "commit" });
    await page
      .getByTestId("base-records-grid")
      .locator("[data-record-id]")
      .filter({ hasText: title })
      .getByText(title)
      .click({ timeout: 60_000 });
    await page.getByText("Edit", { exact: true }).first().click();
    // The picker opens on the value's month (or today's), so steer it to the target day.
    const [day, time] = wallTime.split("T") as [string, string];
    const [year, month] = day.split("-").map(Number) as [number, number];
    const trigger = page.getByLabel("Deadline", { exact: true });
    await trigger.click();
    const picker = page.locator("[data-radix-popper-content-wrapper]");
    await picker.getByRole("combobox", { name: "Choose the Year" }).selectOption(String(year));
    await picker
      .getByRole("combobox", { name: "Choose the Month" })
      .selectOption(String(month - 1));
    await picker.locator(`[data-day="${day}"] button`).click();
    await picker.getByTestId("date-field-time").fill(time);
    await trigger.click();
    await expect(picker).toHaveCount(0);
    await expect(trigger).toHaveAttribute("data-value", wallTime);
    await expect(page.getByText(/Time zone: Asia\/Shanghai/)).toBeVisible();
    if (title === "Launch landing page") {
      await page.screenshot({ path: test.info().outputPath("04-beijing-enters-18-00.png") });
    }
    await page.getByRole("button", { name: "Update Now", exact: true }).click();
    await expect(page.getByRole("button", { name: "Update Now", exact: true })).toHaveCount(0);
  }
  await page.context().close();
});

test("London reads the same deadlines in its own time, and is told when the day differs", async ({
  browser,
  request,
}) => {
  const { records } = await json<{
    records: Array<{ baseId: string; headCommit: { payload: Record<string, unknown> } }>;
  }>(await request.get(`/api/v1/records?baseSlug=${baseSlug}&pageSize=100`));
  const stored = records
    .filter((record) => record.baseId === base.id)
    .map((record) => record.headCommit.payload.deadline);
  // Stored with the writer's offset, so a reader can be told what was typed.
  expect(stored).toContain("2026-10-02T18:00:00+08:00");
  expect(stored).toContain("2026-10-03T01:00:00+08:00");

  const page = await openIn(browser, "Europe/London", `/dashboard/local/base/${baseSlug}`);
  const grid = page.getByTestId("base-records-grid");
  const launch = grid.locator("[data-record-id]").filter({ hasText: "Launch landing page" });
  const ship = grid.locator("[data-record-id]").filter({ hasText: "Ship mobile build" });
  await expect(launch).toContainText("Fri, Oct 2, 2026, 11:00 AM GMT+1", { timeout: 60_000 });
  await expect(ship).toContainText("Fri, Oct 2, 2026, 6:00 PM GMT+1");
  await expect(ship).toContainText("-1");
  await expect(ship.locator('[title*="Entered as"]')).toHaveAttribute(
    "title",
    /Entered as Sat, Oct 3, 2026, 1:00 AM \(UTC\+08:00\)/,
  );
  // The day field is untouched by any of this.
  await expect(launch).toContainText("Fri, Oct 2, 2026");
  await page.screenshot({ path: test.info().outputPath("05-london-grid.png") });
  await page.context().close();
});

test("dragging a calendar card saves its new day without changing other fields", async ({
  browser,
  request,
}) => {
  const readLaunch = async () => {
    const { records } = await json<{
      records: Array<{ baseId: string; headCommit: { payload: Record<string, unknown> } }>;
    }>(await request.get(`/api/v1/records?baseSlug=${baseSlug}&pageSize=100`));
    return records.find(
      (record) =>
        record.baseId === base.id && record.headCommit.payload.title === "Launch landing page",
    )?.headCommit.payload;
  };
  const before = await readLaunch();
  expect(before?.due).toBe("2026-10-02");
  const page = await openIn(
    browser,
    "America/Los_Angeles",
    `/dashboard/local/base/${baseSlug}`,
    test.info().outputDir,
  );
  await page.getByRole("link", { name: "Due Calendar" }).click();
  const heading = page.getByText("October 2026").first();
  for (let step = 0; step < 24 && !(await heading.isVisible()); step += 1) {
    const now = new Date();
    await page
      .getByRole("button", { name: now < new Date(2026, 9, 1) ? /next/i : /prev/i })
      .first()
      .click();
  }
  await expect(heading).toBeVisible();
  const source = page.locator('[data-calendar-day="2026-10-02"]');
  const target = page.locator('[data-calendar-day="2026-10-05"]');
  await expect(source.getByRole("link", { name: "Launch landing page" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("06-sf-calendar-before-drag.png") });
  const handle = source.getByRole("button", { name: "Move Launch landing page to another day" });
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Calendar drag targets are not visible");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await expect(target).toHaveAttribute("data-calendar-drop-target", "true");
  await page.mouse.up();
  await expect(target.getByRole("link", { name: "Launch landing page" })).toBeVisible();
  await expect(source).not.toContainText("Launch landing page");
  await page.screenshot({ path: test.info().outputPath("06-sf-calendar-after-drag.png") });

  const after = await readLaunch();
  expect(after).toEqual({ ...before, due: "2026-10-05" });
  await page.context().close();
  await page.video()?.saveAs(test.info().outputPath("calendar-drag.webm"));
});

test("a touch user can long-press and reschedule without a tap moving the card", async ({
  browser,
  request,
}) => {
  const readShip = async () => {
    const { records } = await json<{
      records: Array<{ baseId: string; headCommit: { payload: Record<string, unknown> } }>;
    }>(await request.get(`/api/v1/records?baseSlug=${baseSlug}&pageSize=100`));
    return records.find(
      (record) =>
        record.baseId === base.id && record.headCommit.payload.title === "Ship mobile build",
    )?.headCommit.payload;
  };
  const before = await readShip();
  expect(before?.due).toBe("2026-10-01");
  const page = await openIn(
    browser,
    "America/Los_Angeles",
    `/dashboard/local/base/${baseSlug}`,
    test.info().outputDir,
    true,
  );
  await page.getByRole("link", { name: "Due Calendar" }).click();
  const heading = page.getByText("October 2026").first();
  for (let step = 0; step < 24 && !(await heading.isVisible()); step += 1) {
    const now = new Date();
    await page
      .getByRole("button", { name: now < new Date(2026, 9, 1) ? /next/i : /prev/i })
      .first()
      .click();
  }
  await expect(heading).toBeVisible();
  const source = page.locator('[data-calendar-day="2026-10-01"]');
  const target = page.locator('[data-calendar-day="2026-10-03"]');
  const handle = source.getByRole("button", { name: "Move Ship mobile build to another day" });
  await expect(handle).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("07-mobile-calendar-before-drag.png") });
  await handle.tap();
  expect(await readShip()).toEqual(before);

  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Mobile calendar drag targets are not visible");
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  await page.waitForTimeout(260);
  for (let step = 1; step <= 12; step += 1) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + ((end.x - start.x) * step) / 12,
          y: start.y + ((end.y - start.y) * step) / 12,
        },
      ],
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(target.getByRole("link", { name: "Ship mobile build" })).toBeVisible();
  expect(await readShip()).toEqual({ ...before, due: "2026-10-03" });
  await page.screenshot({ path: test.info().outputPath("08-mobile-calendar-after-drag.png") });
  await page.context().close();
  await page.video()?.saveAs(test.info().outputPath("calendar-touch-drag.webm"));
});

test("a keyboard user can move a calendar record to the next day", async ({ browser, request }) => {
  await json(
    await request.post(`/api/v1/bases/${base.id}/records/bulk-change-request`, {
      data: {
        autoMerge: true,
        message: "Seed keyboard rescheduling",
        records: [{ due: "2026-10-08", title: "Keyboard schedule" }],
        submittedBy: "playwright",
      },
    }),
  );
  const page = await openIn(
    browser,
    "America/Los_Angeles",
    `/dashboard/local/base/${baseSlug}`,
    test.info().outputDir,
  );
  await page.getByRole("link", { name: "Due Calendar" }).click();
  const heading = page.getByText("October 2026").first();
  for (let step = 0; step < 24 && !(await heading.isVisible()); step += 1) {
    const now = new Date();
    await page
      .getByRole("button", { name: now < new Date(2026, 9, 1) ? /next/i : /prev/i })
      .first()
      .click();
  }
  await expect(heading).toBeVisible();
  const source = page.locator('[data-calendar-day="2026-10-08"]');
  const target = page.locator('[data-calendar-day="2026-10-09"]');
  await page.screenshot({ path: test.info().outputPath("11-keyboard-calendar-before-drag.png") });
  await source.getByRole("button", { name: "Move Keyboard schedule to another day" }).focus();
  await page.keyboard.press("Space");
  await expect(page.locator('[data-calendar-dragging="true"]')).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(target).toHaveAttribute("data-calendar-drop-target", "true");
  await page.keyboard.press("Space");
  await expect(target.getByRole("link", { name: "Keyboard schedule" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("12-keyboard-calendar-after-drag.png") });
  await page.context().close();
  await page.video()?.saveAs(test.info().outputPath("calendar-keyboard-drag.webm"));
});

test("a review-first date change stays on its old day and opens the pending request", async ({
  browser,
  request,
}) => {
  await json(
    await request.post(`/api/v1/bases/${base.id}/records/bulk-change-request`, {
      data: {
        autoMerge: true,
        message: "Seed review-first rescheduling",
        records: [{ due: "2026-10-12", title: "Review schedule" }],
        submittedBy: "playwright",
      },
    }),
  );
  const page = await openIn(
    browser,
    "America/Los_Angeles",
    `/dashboard/local/base/${baseSlug}`,
    test.info().outputDir,
  );
  let intercepted = false;
  // The local OSS UI has no restricted login. Force review-first intent on this
  // one real RPC write so the backend returns a genuine pending ChangeRequest.
  await page.route("**/api/rpc/records/changeRequest**", async (route) => {
    const body = route.request().postDataJSON() as { json?: Record<string, unknown> } & Record<
      string,
      unknown
    >;
    const input = body.json ?? body;
    intercepted = true;
    await route.continue({
      postData: JSON.stringify(
        body.json
          ? { ...body, json: { ...input, autoMerge: false } }
          : { ...body, autoMerge: false },
      ),
    });
  });
  await page.getByRole("link", { name: "Due Calendar" }).click();
  const heading = page.getByText("October 2026").first();
  for (let step = 0; step < 24 && !(await heading.isVisible()); step += 1) {
    const now = new Date();
    await page
      .getByRole("button", { name: now < new Date(2026, 9, 1) ? /next/i : /prev/i })
      .first()
      .click();
  }
  await expect(heading).toBeVisible();
  const source = page.locator('[data-calendar-day="2026-10-12"]');
  const target = page.locator('[data-calendar-day="2026-10-13"]');
  await expect(source.getByRole("link", { name: "Review schedule" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("09-calendar-review-before-drag.png") });
  const handle = source.getByRole("button", { name: "Move Review schedule to another day" });
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Review-first calendar drag targets are not visible");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await expect(target).toHaveAttribute("data-calendar-drop-target", "true");
  await page.mouse.up();
  const notice = page.getByRole("status").filter({ hasText: "sent for review" });
  await expect(notice).toBeVisible();
  expect(intercepted).toBe(true);
  await expect(source.getByRole("link", { name: "Review schedule" })).toBeVisible();
  await expect(target).not.toContainText("Review schedule");
  const reviewLink = notice.getByRole("link", { name: "Reviews" });
  const reviewId = (await reviewLink.getAttribute("href"))?.split("/").pop();
  if (!reviewId) throw new Error("Review request link is missing its ID");
  const detail = await json<{ status: string }>(
    await request.get(`/api/v1/change-requests/${reviewId}`),
  );
  expect(detail.status).toBe("in_review");
  await page.screenshot({ path: test.info().outputPath("10-calendar-review-pending.png") });
  await reviewLink.click();
  await expect(page).toHaveURL(new RegExp(`/inbox/${reviewId}$`));
  await page.context().close();
  await page.video()?.saveAs(test.info().outputPath("calendar-review-pending.webm"));
});
