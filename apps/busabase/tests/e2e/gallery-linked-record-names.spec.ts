import type { BaseVO, RecordVO } from "busabase-contract/types";
import { expect, json, test } from "./_fixtures";

test("Gallery renders direct relations and relation Lookups as linked record titles", async ({
  page,
  request,
}, testInfo) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const companyTitle = "Northwind Studio";
  const projectTitle = "Website redesign";
  const taskTitle = "Prepare homepage";

  const companies = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        fields: [{ name: "Title", required: true, slug: "title", type: "text" }],
        name: `Gallery Companies ${suffix}`,
        slug: `gallery-companies-${suffix}`,
      },
    }),
  );
  const company = await json<RecordVO>(
    await request.post(`/api/v1/bases/${companies.id}/change-requests`, {
      data: { autoMerge: true, fields: { title: companyTitle } },
    }),
  );

  const projects = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        fields: [
          { name: "Title", required: true, slug: "title", type: "text" },
          { name: "Owner", slug: "owner", type: "member" },
          {
            name: "Company",
            slug: "company",
            type: "relation",
            options: { multiple: false, targetBaseId: companies.id },
          },
        ],
        name: `Gallery Projects ${suffix}`,
        slug: `gallery-projects-${suffix}`,
      },
    }),
  );
  const project = await json<RecordVO>(
    await request.post(`/api/v1/bases/${projects.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: { company: [company.id], owner: ["local-admin"], title: projectTitle },
      },
    }),
  );

  const tasks = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        fields: [
          { name: "Title", required: true, slug: "title", type: "text" },
          {
            name: "Project",
            slug: "project",
            type: "relation",
            options: { multiple: false, targetBaseId: projects.id },
          },
          {
            name: "Project company",
            slug: "project_company",
            type: "lookup",
            options: {
              lookup: { relationFieldSlug: "project", targetFieldSlug: "company" },
            },
          },
          {
            name: "Project owner",
            slug: "project_owner",
            type: "lookup",
            options: { lookup: { relationFieldSlug: "project", targetFieldSlug: "owner" } },
          },
          { name: "Owner", slug: "owner", type: "member" },
        ],
        name: `Gallery Tasks ${suffix}`,
        slug: `gallery-tasks-${suffix}`,
      },
    }),
  );
  const task = await json<RecordVO>(
    await request.post(`/api/v1/bases/${tasks.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: { project: [project.id], owner: ["local-admin"], title: taskTitle },
      },
    }),
  );

  const projectField = tasks.fields.find((field) => field.slug === "project");
  if (!projectField) throw new Error("Expected the project relation field");
  // Reproduce the multiply serialized value found in the existing A Base.
  const legacyTask = await json<RecordVO>(
    await request.post(`/api/v1/bases/${tasks.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: {
          title: "Legacy relation card",
          project: [JSON.stringify([JSON.stringify([project.id])])],
          owner: ["local-admin"],
        },
      },
    }),
  );
  await json<BaseVO>(
    await request.post(`/api/v1/bases/${projects.id}/fields`, {
      data: {
        name: "Tasks",
        slug: "tasks",
        type: "relation",
        options: { targetBaseId: tasks.id, reverseOfFieldId: projectField.id },
      },
    }),
  );

  const gallerySlug = `gallery-relations-${suffix}`;
  await page.goto(`/dashboard/local/base/${tasks.slug}`);
  await expect(page).toHaveURL(new RegExp(`/dashboard/local/base/${tasks.slug}/grid-view$`));
  await page.getByRole("button", { name: "New view" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(`Gallery relations ${suffix}`);
  await dialog.getByLabel("Slug").fill(gallerySlug);
  await dialog.getByRole("button", { name: "Gallery" }).click();
  await dialog.getByRole("button", { name: "Add View Now" }).click();

  await expect(page.getByTestId("base-gallery")).toBeVisible();
  const card = page.locator(`[data-record-id="${task.id}"]`);
  const legacyCard = page.locator(`[data-record-id="${legacyTask.id}"]`);
  await expect(
    legacyCard
      .locator('[data-field-slug="project"]')
      .getByRole("link", { name: projectTitle, exact: true }),
  ).toBeVisible();
  await expect(
    legacyCard
      .locator('[data-field-slug="project_company"]')
      .getByRole("link", { name: companyTitle, exact: true }),
  ).toBeVisible();
  await expect(legacyCard.locator('[data-member-id="local-admin"]')).toHaveCount(2);
  await expect(legacyCard).not.toContainText(project.id);
  await expect(
    card
      .locator('[data-field-slug="project"]')
      .getByRole("link", { name: projectTitle, exact: true }),
  ).toBeVisible();
  await expect(
    card
      .locator('[data-field-slug="project_company"]')
      .getByRole("link", { name: companyTitle, exact: true }),
  ).toBeVisible();
  await expect(legacyCard.getByRole("link", { name: companyTitle, exact: true })).toBeVisible();
  await expect(card).not.toContainText(project.id);
  await expect(card).not.toContainText(company.id);
  await expect(card.locator('[data-member-id="local-admin"]')).toHaveCount(2);
  const ownerName = task.fieldUsers?.["local-admin"]?.name;
  if (!ownerName) throw new Error("Expected the record response to resolve the member name");
  for (const member of await card.locator('[data-member-id="local-admin"]').all()) {
    await expect(member).toContainText(ownerName);
  }
  for (const slug of ["owner", "project_owner"]) {
    await expect(
      legacyCard.locator(`[data-field-slug="${slug}"] [data-member-id="local-admin"]`),
    ).toContainText(ownerName);
  }
  await expect(card).not.toContainText("local-admin");
  await page.screenshot({
    path: testInfo.outputPath("gallery-linked-record-names.png"),
    fullPage: true,
  });

  // Reload proves that names come from persisted records, not the create response.
  await page.reload();
  await expect(card.getByRole("link", { name: projectTitle, exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: companyTitle, exact: true })).toBeVisible();
  await expect(
    legacyCard
      .locator('[data-field-slug="project_company"]')
      .getByRole("link", { name: companyTitle, exact: true }),
  ).toBeVisible();
  await card.getByRole("link", { name: companyTitle, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(company.id));
  await page.goBack();
  await expect(card.getByRole("link", { name: projectTitle, exact: true })).toBeVisible();

  // On the other side of the two-way pair, show the task name in the project Gallery.
  await page.goto(`/dashboard/local/base/${projects.slug}`);
  await page.getByRole("button", { name: "New view" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Projects Gallery");
  await page.getByRole("dialog").getByLabel("Slug").fill("projects-gallery");
  await page.getByRole("dialog").getByRole("button", { name: "Gallery" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add View Now" }).click();
  const projectCard = page.getByTestId("base-gallery").locator(`[data-record-id="${project.id}"]`);
  await expect(
    projectCard
      .locator('[data-field-slug="tasks"]')
      .getByRole("link", { name: taskTitle, exact: true }),
  ).toBeVisible();
  await expect(
    projectCard
      .locator('[data-field-slug="tasks"]')
      .getByRole("link", { name: "Legacy relation card", exact: true }),
  ).toBeVisible();
  await expect(projectCard.getByRole("link", { name: companyTitle, exact: true })).toBeVisible();
  await expect(projectCard).not.toContainText(task.id);
  await expect(projectCard).not.toContainText(company.id);
  await expect(projectCard).not.toContainText("local-admin");
  await page.screenshot({
    path: testInfo.outputPath("gallery-reverse-record-names.png"),
    fullPage: true,
  });
});
