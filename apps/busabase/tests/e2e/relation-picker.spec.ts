import type { BaseVO, RecordVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

test("selected relations survive searching, saving, list navigation and reload", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(20_000);
  const suffix = `${Date.now()}`;
  const subjects = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        slug: `relation-subjects-${suffix}`,
        name: "Subjects",
        fields: [{ slug: "title", name: "Title", type: "text" }],
      },
    }),
  );
  const targets: RecordVO[] = [];
  for (const title of ["Mathematics", "Biology"]) {
    targets.push(
      await json<RecordVO>(
        await request.post(`/api/v1/bases/${subjects.id}/change-requests`, {
          data: { autoMerge: true, fields: { title } },
        }),
      ),
    );
  }
  await json(
    await request.post(`/api/v1/bases/${subjects.id}/records/bulk-change-request`, {
      data: {
        autoMerge: true,
        records: Array.from({ length: 50 }, (_, index) => ({ title: `Other subject ${index}` })),
      },
    }),
  );
  const secondPage = await json<{ records: RecordVO[] }>(
    await request.get(`/api/v1/records/page?baseId=${subjects.id}&page=2&pageSize=50`),
  );
  const secondPageTitle = String(secondPage.records[0]!.headCommit.payload.title);
  const students = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        slug: `relation-students-${suffix}`,
        name: "Students",
        fields: [
          { slug: "title", name: "Name", type: "text" },
          {
            slug: "subjects",
            name: "Subjects",
            type: "relation",
            options: { targetBaseId: subjects.id, multiple: true },
          },
          {
            slug: "primary_subject",
            name: "Primary subject",
            type: "relation",
            options: { targetBaseId: subjects.id, multiple: false },
          },
        ],
      },
    }),
  );
  const student = await json<RecordVO>(
    await request.post(`/api/v1/bases/${students.id}/change-requests`, {
      data: { autoMerge: true, fields: { title: "Zhang San", subjects: [] } },
    }),
  );
  const basePath = `/dashboard/local/base/${students.slug}`;
  const relationField = students.fields.find((field) => field.slug === "subjects")!;
  await page.goto(basePath);
  const row = page.locator(`[data-record-id="${student.id}"]`);
  await expect(row).toContainText("Zhang San");
  await row.getByRole("link", { name: "Zhang San", exact: true }).click();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.locator(`#record-field-${relationField.id}`).click();
  const search = page.getByRole("searchbox", { name: /Subjects/ });
  await page.getByRole("button", { name: "Go to next page", exact: true }).click();
  await page.getByRole("checkbox", { name: new RegExp(secondPageTitle) }).check();
  await page.getByRole("button", { name: "Go to previous page", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Remove link to ${secondPageTitle}`, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Remove link to ${secondPageTitle}`, exact: true })
    .click();
  await search.fill("Mathematics");
  await page.getByRole("checkbox", { name: /Mathematics/ }).check();
  await search.fill("Biology");
  await page.getByRole("checkbox", { name: /Biology/ }).check();
  await expect(page.getByRole("button", { name: /Remove.*Mathematics/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Remove.*Biology/ })).toBeVisible();
  await search.press("Escape");
  const singleField = students.fields.find((field) => field.slug === "primary_subject")!;
  const singleTrigger = page.locator(`#record-field-${singleField.id}`);
  await singleTrigger.click();
  const singleSearch = page.getByRole("searchbox", { name: /Primary subject/ });
  await singleSearch.fill("Mathematics");
  await page.getByRole("radio", { name: /Mathematics/ }).click();
  await expect(singleSearch).toBeHidden();
  await singleTrigger.click();
  await singleSearch.fill("Biology");
  await page.getByRole("radio", { name: /Biology/ }).click();
  await expect(
    singleTrigger.locator("..").getByRole("button", { name: /Remove.*Mathematics/ }),
  ).toHaveCount(0);
  await expect(
    singleTrigger.locator("..").getByRole("button", { name: /Remove.*Biology/ }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("selected-relations.png"), fullPage: true });
  await page.getByRole("button", { name: "Update Now", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${basePath}/${student.id}$`));
  await expect(page.getByRole("link", { name: "Mathematics", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Biology", exact: true }).first()).toBeVisible();
  const saved = await json<RecordVO>(
    await request.get(`/api/v1/records/get?recordId=${student.id}`),
  );
  expect(saved.headCommit.payload.subjects).toEqual(targets.map((record) => record.id));
  expect(saved.headCommit.payload.primary_subject).toEqual([targets[1]!.id]);
  await page.locator(`a[href="${basePath}"]`).first().click();
  await expect(row.getByRole("link", { name: "Mathematics", exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: "Biology", exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("saved-relations-list.png"), fullPage: true });
  await page.reload();
  await expect(row.getByRole("link", { name: "Mathematics", exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: "Biology", exact: true }).first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${basePath}/${student.id}/edit`);
  await page.locator(`#record-field-${relationField.id}`).click();
  await expect(page.getByRole("searchbox", { name: /Subjects/ })).toBeVisible();
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile-relation-picker.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Remove.*Mathematics/ }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${basePath}/${student.id}/edit$`));
  await expect(page.getByRole("button", { name: /Remove.*Mathematics/ })).toHaveCount(0);
  await page.route("**/api/rpc/records/changeRequest", (route) => route.abort(), { times: 1 });
  await page.getByRole("button", { name: "Update Now", exact: true }).click();
  await expect(page.getByRole("button", { name: "Update Now", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(new RegExp(`${basePath}/${student.id}/edit$`));
  await expect(page.getByRole("button", { name: /Remove.*Mathematics/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Remove.*Biology/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Update Now", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${basePath}/${student.id}$`));
  const retried = await json<RecordVO>(
    await request.get(`/api/v1/records/get?recordId=${student.id}`),
  );
  expect(retried.headCommit.payload.subjects).toEqual([targets[1]!.id]);
  await page.goto(`${basePath}/${student.id}/edit`);
  await page.locator(`#record-field-${relationField.id}`).click();
  await page.getByRole("searchbox", { name: /Subjects/ }).fill("Mathematics");
  await page.getByRole("checkbox", { name: /Mathematics/ }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More submit options" }).click();
  await page.getByRole("menuitem", { name: "Update Request", exact: true }).click();
  await expect(page).toHaveURL(/\/inbox\/[^/]+$/);
  const pending = await json<RecordVO>(
    await request.get(`/api/v1/records/get?recordId=${student.id}`),
  );
  expect(pending.headCommit.payload.subjects).toEqual([targets[1]!.id]);
  await page.screenshot({
    path: testInfo.outputPath("pending-relations-review.png"),
    fullPage: true,
  });
});
