import type { BaseVO, RecordVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

// The two-way relation is only reachable through the field dialog and the record
// editor, so this drives both for real: switch it on from the forward field's
// settings, then edit from the OTHER side and read both sides back over the API.
test.setTimeout(180_000);

test("a relation switched to two-way can be edited from either side", async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const companies = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        fields: [{ name: "Name", required: true, slug: "name", type: "text" }],
        name: `Companies ${suffix}`,
        slug: `companies-${suffix}`,
      },
    }),
  );
  const deals = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        fields: [
          { name: "Name", required: true, slug: "name", type: "text" },
          {
            name: "Company",
            slug: "company",
            type: "relation",
            options: { targetBaseId: companies.id, multiple: false },
          },
        ],
        name: `Deals ${suffix}`,
        slug: `deals-${suffix}`,
      },
    }),
  );
  const createRecord = async (baseId: string, fields: Record<string, unknown>) =>
    json<RecordVO>(
      await request.post(`/api/v1/bases/${baseId}/change-requests`, {
        data: { autoMerge: true, fields, message: "two-way fixture", submittedBy: "playwright" },
      }),
    );
  const acme = await createRecord(companies.id, { name: "Acme" });
  const globex = await createRecord(companies.id, { name: "Globex" });
  const pilot = await createRecord(deals.id, { name: "Pilot", company: [globex.id] });
  const rollout = await createRecord(deals.id, { name: "Rollout", company: [acme.id] });
  const payload = async (recordId: string) =>
    (await json<RecordVO>(await request.get(`/api/v1/records/get?recordId=${recordId}`))).headCommit
      .payload;
  const companyField = deals.fields.find((field) => field.slug === "company");
  if (!companyField) throw new Error("Expected the Company field");

  // 1. Switch it on from the forward field's settings.
  await page.goto(`/dashboard/base/${deals.slug}/design`);
  await page.getByRole("button", { name: "Rename Company" }).click();
  const dialog = page.getByRole("dialog");
  const toggle = dialog.getByRole("checkbox", {
    name: `Create a corresponding two-way relation field in ${companies.name}`,
  });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(dialog.getByLabel(`Column name in ${companies.name}`)).toHaveValue(deals.name);
  await dialog.getByRole("button", { name: "Save now" }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => {
      const base = await json<BaseVO>(await request.get(`/api/v1/bases/${companies.id}`));
      return base.fields.find((field) => field.options.reverseOfFieldId === companyField.id)?.slug;
    })
    .toBeTruthy();
  const reverseSlug = (
    await json<BaseVO>(await request.get(`/api/v1/bases/${companies.id}`))
  ).fields.find((field) => field.options.reverseOfFieldId === companyField.id)?.slug as string;
  // The existing links show up on the other side without anyone retyping them.
  expect((await payload(acme.id))[reverseSlug]).toEqual([rollout.id]);
  expect((await payload(globex.id))[reverseSlug]).toEqual([pilot.id]);

  // Reopening the settings now says so instead of offering the switch again.
  await page.reload();
  await page.getByRole("button", { name: "Rename Company" }).click();
  await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toContainText(`Shown in ${companies.name} as`);
  await page.keyboard.press("Escape");

  // 2. Edit from the other side: add Pilot to Acme.
  await page.goto(`/dashboard/base/${companies.slug}/${acme.id}`);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByText("Both sides can be edited and always stay in sync.")).toBeVisible();
  await page.getByRole("button", { name: deals.name, exact: true }).click();
  await page
    .getByRole("group", { name: deals.name, exact: true })
    .getByText("Pilot", { exact: true })
    .click();
  // The open picker covers the submit button: collapse it first.
  await page.getByRole("button", { name: deals.name, exact: true }).click();
  await expect(page.getByRole("group", { name: deals.name, exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Update Now" }).click();

  // Single-value Company: Pilot MOVED from Globex to Acme; both sides agree.
  await expect.poll(async () => (await payload(pilot.id)).company).toEqual([acme.id]);
  expect((await payload(rollout.id)).company).toEqual([acme.id]);
  expect((await payload(acme.id))[reverseSlug]).toEqual([rollout.id, pilot.id]);
  expect((await payload(globex.id))[reverseSlug] ?? []).toEqual([]);
});
