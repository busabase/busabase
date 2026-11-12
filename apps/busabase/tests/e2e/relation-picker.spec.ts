import { readFile } from "node:fs/promises";
import type { BaseVO, RecordVO, UserRefVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

test("selected relations survive searching, saving, list navigation and reload", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(20_000);
  const suffix = `${Date.now()}`;
  const offices = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        slug: `relation-offices-${suffix}`,
        name: "Offices",
        fields: [{ slug: "title", name: "Title", type: "text" }],
      },
    }),
  );
  const office = await json<RecordVO>(
    await request.post(`/api/v1/bases/${offices.id}/change-requests`, {
      data: { autoMerge: true, fields: { title: "Science building" } },
    }),
  );
  const teachers = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        slug: `relation-teachers-${suffix}`,
        name: "Teachers",
        fields: [
          { slug: "title", name: "Title", type: "text" },
          {
            slug: "office",
            name: "Office",
            type: "relation",
            options: { targetBaseId: offices.id },
          },
        ],
      },
    }),
  );
  const teacher = await json<RecordVO>(
    await request.post(`/api/v1/bases/${teachers.id}/change-requests`, {
      data: { autoMerge: true, fields: { title: "Professor Wang", office: [office.id] } },
    }),
  );
  const subjects = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        slug: `relation-subjects-${suffix}`,
        name: "Subjects",
        fields: [
          { slug: "title", name: "Title", type: "text" },
          {
            slug: "teacher",
            name: "Teacher",
            type: "relation",
            options: { targetBaseId: teachers.id },
          },
          {
            slug: "teacher_name",
            name: "Teacher name",
            type: "lookup",
            options: { lookup: { relationFieldSlug: "teacher", targetFieldSlug: "title" } },
          },
          {
            slug: "office",
            name: "Office",
            type: "lookup",
            options: { lookup: { relationFieldSlug: "teacher", targetFieldSlug: "office" } },
          },
          { slug: "credits", name: "Credits", type: "number" },
          { slug: "extra", name: "Sixth field", type: "text" },
        ],
      },
    }),
  );
  const targets: RecordVO[] = [];
  for (const title of ["Mathematics", "Biology"]) {
    targets.push(
      await json<RecordVO>(
        await request.post(`/api/v1/bases/${subjects.id}/change-requests`, {
          data: {
            autoMerge: true,
            fields: { title, teacher: [teacher.id], credits: 3, extra: "Hidden preview value" },
          },
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
  const relationCell = row.locator(`[data-cell-field="${relationField.slug}"]`);
  await relationCell.click();
  await expect(page.getByRole("searchbox", { name: /Subjects/ })).toBeHidden();
  await relationCell.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(page.getByRole("heading", { name: 'Link records from "Subjects"' })).toBeVisible();
  const cellSearch = page.getByRole("searchbox", { name: /Subjects/ });
  await cellSearch.fill("Mathematics");
  await page.getByRole("checkbox", { name: /Mathematics/ }).check();
  await cellSearch.fill("Biology");
  await page.getByRole("checkbox", { name: /Biology/ }).check();
  const candidate = page
    .getByRole("checkbox", { name: "Biology", exact: true })
    .locator("..")
    .locator("..");
  await expect(candidate.locator('[data-relation-preview-field="teacher"]')).toHaveText(
    /TeacherProfessor Wang/,
  );
  await expect(candidate.locator('[data-relation-preview-field="teacher_name"]')).toHaveText(
    /Teacher nameProfessor Wang/,
  );
  await expect(candidate.locator('[data-relation-preview-field="office"]')).toHaveText(
    /OfficeScience building/,
  );
  await expect(candidate.locator('[data-relation-preview-field="credits"]')).toHaveText(/Credits3/);
  await expect(candidate).not.toContainText(teacher.id);
  await expect(candidate).not.toContainText(office.id);
  await expect(candidate.locator('[data-relation-preview-field="extra"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Remove.*Mathematics/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Remove.*Biology/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("cell-relation-picker.png"), fullPage: true });
  await page.getByRole("button", { name: "Save Now", exact: true }).click();
  await expect(row.getByRole("link", { name: "Mathematics", exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: "Biology", exact: true })).toBeVisible();
  await row.getByRole("link", { name: "Zhang San", exact: true }).click();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.locator(`#record-field-${relationField.id}`).click();
  const search = page.getByRole("searchbox", { name: /Subjects/ });
  await page.getByRole("button", { name: "Go to next page", exact: true }).click();
  await page.getByRole("checkbox", { name: new RegExp(secondPageTitle) }).check();
  await expect(search).toBeVisible();
  await page.getByRole("button", { name: "Go to previous page", exact: true }).click();
  await expect(search).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Remove link to ${secondPageTitle}`, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Remove link to ${secondPageTitle}`, exact: true })
    .click();
  await expect(search).toBeVisible();
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
  await page.getByRole("checkbox", { name: /Mathematics/ }).click();
  await expect(singleSearch).toBeHidden();
  await singleTrigger.click();
  await singleSearch.fill("Biology");
  await page.getByRole("checkbox", { name: /Biology/ }).click();
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

  // Exercise the bounded selection UI against real records and persist an edit
  // without dropping any of the selected links hidden behind Show more.
  const allTargets = await json<{ records: RecordVO[] }>(
    await request.get(`/api/v1/records/page?baseId=${subjects.id}&page=1&pageSize=100`),
  );
  const allIds = allTargets.records.map((record) => record.id);
  expect(allIds).toHaveLength(52);
  const batchStudent = await json<RecordVO>(
    await request.post(`/api/v1/bases/${students.id}/change-requests`, {
      data: { autoMerge: true, fields: { title: "Batch student", subjects: allIds } },
    }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(basePath);
  const batchCell = page.locator(
    `[data-cell-record="${batchStudent.id}"][data-cell-field="subjects"]`,
  );
  await batchCell.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(batchCell.getByRole("button", { name: /Remove link to/ })).toHaveCount(20);
  await expect(page.getByRole("searchbox", { name: /Subjects/ })).toBeVisible();
  await batchCell.getByRole("button", { name: "Show more (+32)", exact: true }).click();
  await expect(batchCell.getByRole("button", { name: /Remove link to/ })).toHaveCount(40);
  const batchPicker = page.getByRole("dialog", { name: 'Link records from "Subjects"' });
  await expect(batchPicker.getByRole("heading")).toBeVisible();
  await expect
    .poll(async () => (await batchPicker.boundingBox())?.y ?? -1)
    .toBeGreaterThanOrEqual(16);
  await page.screenshot({
    path: testInfo.outputPath("batch-relations-bounded.png"),
    fullPage: true,
  });
  await batchCell
    .getByRole("button", { name: /Remove link to/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Save Now", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: /Subjects/ })).toBeHidden();
  await expect
    .poll(async () => {
      const updated = await json<RecordVO>(
        await request.get(`/api/v1/records/get?recordId=${batchStudent.id}`),
      );
      return updated.headCommit.payload.subjects;
    })
    .toEqual(allIds.slice(1));
});

test("recognize members and attachments in a compact target-table picker", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const { user } = await json<{ user: UserRefVO }>(await request.get("/api/v1/auth"));
  const bytes = await readFile("public/assets/readme/scenarios/blog-cms-base.png");
  const input = { fileName: "Cover.png", mimeType: "image/png", sizeBytes: bytes.length };
  const upload = await json<{ storageKey: string; uploadUrl: string }>(
    await request.post("/api/v1/assets/upload-urls", { data: input }),
  );
  expect(
    (
      await request.put(upload.uploadUrl, {
        data: bytes,
        headers: { "content-type": input.mimeType },
      })
    ).ok(),
  ).toBe(true);
  const asset = await json<{ attachmentId: string; publicUrl: string }>(
    await request.post("/api/v1/assets/confirmations", {
      data: { ...input, storageKey: upload.storageKey },
    }),
  );
  const teamBase = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        slug: `relation-teams-${suffix}`,
        name: "Teams",
        fields: [
          { slug: "title", name: "Title", type: "text" },
          { slug: "owner", name: "Owner", type: "member" },
        ],
      },
    }),
  );
  const team = await json<RecordVO>(
    await request.post(`/api/v1/bases/${teamBase.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: { title: "Design team", owner: [user.id] },
      },
    }),
  );
  const target = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        slug: `relation-projects-${suffix}`,
        name: "Projects",
        fields: [
          { slug: "title", name: "Title", type: "text" },
          { slug: "files", name: "Files", type: "attachment" },
          { slug: "owner", name: "Owner", type: "member" },
          { slug: "team", name: "Team", type: "relation", options: { targetBaseId: teamBase.id } },
          {
            slug: "team_owner",
            name: "Team owner",
            type: "lookup",
            options: { lookup: { relationFieldSlug: "team", targetFieldSlug: "owner" } },
          },
        ],
      },
    }),
  );
  const project = await json<RecordVO>(
    await request.post(`/api/v1/bases/${target.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: {
          title: "Website launch",
          owner: [user.id],
          team: [team.id],
          files: [
            {
              attachmentId: asset.attachmentId,
              fileName: input.fileName,
              mimeType: input.mimeType,
              size: bytes.length,
              url: asset.publicUrl,
            },
            {
              attachmentId: asset.attachmentId,
              fileName: "Second cover.png",
              mimeType: input.mimeType,
              size: bytes.length,
              url: asset.publicUrl,
            },
          ],
        },
      },
    }),
  );
  const memberName = project.fieldUsers?.[user.id]?.name;
  if (!memberName) throw new Error("Fixture member must have a resolved name");
  const source = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        slug: `relation-tasks-${suffix}`,
        name: "Tasks",
        fields: [
          { slug: "title", name: "Title", type: "text" },
          {
            slug: "project",
            name: "Linked project",
            type: "relation",
            required: true,
            options: { targetBaseId: target.id, multiple: false },
          },
        ],
      },
    }),
  );
  const task = await json<RecordVO>(
    await request.post(`/api/v1/bases/${source.id}/change-requests`, {
      data: { autoMerge: true, fields: { title: "Design homepage", project: [project.id] } },
    }),
  );
  await page.goto(`/dashboard/local/base/${source.slug}`);
  const cell = page.locator(`[data-record-id="${task.id}"] [data-cell-field="project"]`);
  await cell.getByRole("button", { name: "Add link", exact: true }).click();
  const picker = page.getByRole("dialog", { name: 'Link records from "Projects"' });
  await cell.getByRole("button", { name: "Remove link to Website launch" }).click();
  await expect(picker.getByRole("heading", { name: 'Link records from "Projects"' })).toBeVisible();
  await expect(picker.locator('[data-relation-preview-field="owner"]')).toContainText(memberName);
  await expect(picker.locator('[data-relation-preview-field="team_owner"]')).toContainText(
    memberName,
  );
  await expect(picker.locator('[data-relation-preview-field="team"]')).toContainText("Design team");
  await expect(picker).not.toContainText(user.id);
  await expect(picker).not.toContainText(team.id);
  expect(
    await picker
      .locator("[data-relation-preview-field]")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-relation-preview-field")),
      ),
  ).toEqual(["owner", "team", "team_owner", "files"]);
  const thumbnail = picker.getByRole("img", { name: "Cover.png" });
  await expect(thumbnail).toBeVisible();
  await expect(picker.locator("[data-attachment-preview] img")).toHaveCount(1);
  await expect(picker.getByRole("img", { name: "Second cover.png" })).toHaveCount(0);
  await expect
    .poll(() => thumbnail.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect((await picker.boundingBox())?.width).toBeLessThanOrEqual(640);
  await page.screenshot({
    path: info.outputPath("compact-relation-member-attachment.png"),
    fullPage: true,
  });
  await picker.getByRole("button", { name: "Expand: File preview", exact: true }).click();
  const expanded = page.getByTestId("attachment-cell-expanded");
  await expect(expanded.locator("[data-attachment-cell-item]")).toHaveCount(2);
  await expect(expanded.getByRole("button", { name: "Second cover.png" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("all-relation-attachments.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(expanded).toBeHidden();
  await expect(picker).toBeVisible();
  await picker.getByRole("link", { name: "Cover.png" }).click();
  const preview = page.getByRole("dialog", { name: "Cover.png", exact: true });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Close", exact: true }).click();
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("checkbox", { name: "Website launch" })).not.toBeChecked();
  await picker.getByRole("checkbox", { name: "Website launch" }).check();
  await picker.getByRole("button", { name: "Save Now", exact: true }).click();
  await expect(cell.getByRole("link", { name: "Website launch" })).toBeVisible();
  await cell.getByRole("button", { name: "Add link", exact: true }).click();
  await cell.getByRole("button", { name: "Remove link to Website launch" }).click();
  await picker.getByRole("button", { name: "Save Now", exact: true }).click();
  await expect(picker.getByRole("alert")).toContainText("Linked project is required");
  await page.getByRole("columnheader").first().click();
  await expect(picker).toBeVisible();
  await page.screenshot({
    path: info.outputPath("required-relation-validation.png"),
    fullPage: true,
  });
  await picker.getByRole("checkbox", { name: "Website launch" }).check();
  await picker.getByRole("button", { name: "Save Now", exact: true }).click();
  await expect(picker).toBeHidden();
  const savedTask = await json<RecordVO>(
    await request.get(`/api/v1/records/get?recordId=${task.id}`),
  );
  expect(savedTask.headCommit.payload.project).toEqual([project.id]);
});
