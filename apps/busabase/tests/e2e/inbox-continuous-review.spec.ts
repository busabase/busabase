import { type APIRequestContext, expect, json, test, unique } from "./_fixtures";

interface BaseVO {
  id: string;
  slug: string;
}

interface ChangeRequestVO {
  id: string;
}

test.describe.configure({ mode: "serial" });

const createReviewBase = async (request: APIRequestContext) =>
  json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        fields: [{ name: "Name", required: true, slug: "name", type: "text" }],
        name: unique("Continuous review"),
        slug: `continuous-review-${Date.now()}`,
      },
    }),
  );

test("reviewer moves through the current inbox queue and returns to the same page", async ({
  page,
  request,
}, testInfo) => {
  const base = await createReviewBase(request);

  const created: ChangeRequestVO[] = [];
  for (let index = 0; index < 3; index++) {
    created.push(
      await json<ChangeRequestVO>(
        await request.post(`/api/v1/bases/${base.id}/change-requests`, {
          data: {
            fields: { name: unique(`Continuous review ${index}`) },
            message: "Continuous review browser test",
            submittedBy: "e2e-agent",
            autoMerge: false,
          },
        }),
      ),
    );
  }

  await page.goto("/dashboard/local/inbox?view=review&inboxPage=1&inboxPageSize=25");
  const rows = page.getByTestId("inbox-change-request-row");
  await expect(rows.first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("01-review-queue.png"), fullPage: true });
  const ids = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")?.match(/\/inbox\/([^?]+)/)?.[1]),
  );
  expect(ids.slice(0, 3).every((id) => created.some((item) => item.id === id))).toBe(true);
  const [first, second, third] = ids;
  if (!first || !second || !third) throw new Error("Review queue did not contain three items");

  await rows.nth(1).click();
  await expect(page).toHaveURL(new RegExp(`/inbox/${second}\\?`));
  await expect(page.getByRole("button", { name: "Previous change request" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Next change request" })).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("02-review-detail-navigation.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Previous change request" }).click();
  await expect(page).toHaveURL(new RegExp(`/inbox/${first}\\?`));
  await page.getByRole("button", { name: "Next change request" }).click();
  await expect(page).toHaveURL(new RegExp(`/inbox/${second}\\?`));

  const summary = page.getByLabel("Review summary");
  await summary.focus();
  await page.keyboard.press("j");
  await expect(page).toHaveURL(new RegExp(`/inbox/${second}\\?`));
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("j");
  await expect(page).toHaveURL(new RegExp(`/inbox/${third}\\?`));
  await expect(page.getByRole("button", { name: "Previous change request" })).toBeEnabled();
  await page.keyboard.press("k");
  await expect(page).toHaveURL(new RegExp(`/inbox/${second}\\?`));

  await page.getByRole("button", { name: "Inbox" }).click();
  await expect(page).toHaveURL(/inbox\?view=review&inboxPage=1&inboxPageSize=25$/);
  await rows.nth(1).click();
  await page.getByRole("button", { exact: true, name: "Approve" }).click();
  await expect(page).toHaveURL(new RegExp(`/inbox/${third}\\?`));
  await page.screenshot({
    path: testInfo.outputPath("03-after-approval-next-item.png"),
    fullPage: true,
  });

  await page.getByRole("radio", { name: "Request changes" }).check();
  await page.getByLabel("Review summary").fill("Please cite the source before resubmitting.");
  await page.getByRole("button", { exact: true, name: "Request changes" }).click();
  await expect(page).toHaveURL(/\/inbox\/[^?]+\?view=review&inboxPage=1&inboxPageSize=25/);
  await expect(page).not.toHaveURL(new RegExp(`/inbox/${third}\\?`));
  await page.screenshot({
    path: testInfo.outputPath("04-after-request-changes.png"),
    fullPage: true,
  });
});

test("the last item on one page advances into the next page after approval", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const base = await createReviewBase(request);

  for (let index = 0; index < 26; index++) {
    await json<ChangeRequestVO>(
      await request.post(`/api/v1/bases/${base.id}/change-requests`, {
        data: {
          fields: { name: unique(`Review boundary ${index}`) },
          submittedBy: "e2e-agent",
          autoMerge: false,
        },
      }),
    );
  }

  await page.goto("/dashboard/local/inbox?view=review&inboxPage=1&inboxPageSize=25");
  const rows = page.getByTestId("inbox-change-request-row");
  await expect(rows).toHaveCount(25);
  const lastHref = await rows.last().getAttribute("href");
  const lastId = lastHref?.match(/\/inbox\/([^?]+)/)?.[1];
  if (!lastId) throw new Error("Page 1 had no last item");
  await rows.last().click();
  await expect(page).toHaveURL(new RegExp(`/inbox/${lastId}\\?`));
  await page.getByRole("button", { name: "Next change request" }).click();
  await expect(page).toHaveURL(/inboxPage=2&inboxPageSize=25/);
  const page2Id = page.url().match(/\/inbox\/([^?]+)/)?.[1];
  if (!page2Id) throw new Error("No change request opened on page 2");

  await page.getByRole("button", { name: "Previous change request" }).click();
  await expect(page).toHaveURL(new RegExp(`/inbox/${lastId}\\?`));
  await page.getByRole("button", { exact: true, name: "Approve" }).click();
  await expect(page).toHaveURL(new RegExp(`/inbox/${page2Id}\\?`));
  await expect(page).toHaveURL(/inboxPage=1&inboxPageSize=25/);

  await page.getByRole("button", { name: "Inbox" }).click();
  await page.getByRole("link", { name: "Go to next page" }).click();
  await expect(page).toHaveURL(/\/inbox\?view=review&inboxPage=2&inboxPageSize=25$/);
  await rows.first().click();
  await expect(page).toHaveURL(/inboxPage=2&inboxPageSize=25&inboxItem=/);
  await page.getByRole("button", { name: "Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox\?view=review&inboxPage=2&inboxPageSize=25$/);
});
