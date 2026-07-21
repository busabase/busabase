import type { BaseVO, RecordVO } from "busabase-contract/types";
import { expect, json, test, unique } from "./_fixtures";

test("Record Detail renders schema fields once and in order after the primary field", async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const baseSlug = `record-detail-fields-${suffix}`;
  const primaryValue = unique("/records/non-title-primary");
  const descriptionValue = unique("Description rendered as a regular field");
  const longTextValue = unique("L".repeat(220));
  const base = await json<BaseVO>(
    await request.post("/api/v1/bases", {
      data: {
        autoMerge: true,
        description: "Playwright coverage for schema-driven Record Detail fields.",
        fields: [
          { name: "Path", required: true, slug: "path", type: "text" },
          { name: "Description", slug: "description", type: "text" },
          { name: "Category", slug: "category", type: "text" },
          { name: "Body", slug: "body", type: "markdown" },
          { name: "Status", slug: "status", type: "text" },
          { name: "Notes", slug: "notes", type: "longtext" },
          { name: "Subject", slug: "subject", type: "text" },
        ],
        name: unique("Record Detail Fields"),
        slug: baseSlug,
      },
    }),
  );
  const record = await json<RecordVO>(
    await request.post(`/api/v1/bases/${base.id}/change-requests`, {
      data: {
        autoMerge: true,
        fields: {
          body: "## Markdown body",
          category: "Schema order",
          description: descriptionValue,
          notes: "Long-text notes",
          path: primaryValue,
          status: longTextValue,
          subject: "A field named subject is still a regular field",
        },
        message: "Create schema-order Record Detail fixture",
        submittedBy: "playwright",
      },
    }),
  );

  await page.goto(`/dashboard/base/${base.slug}/${record.id}`);
  await expect(page.getByRole("heading", { level: 1, name: primaryValue })).toBeVisible({
    timeout: 45_000,
  });

  const renderedFields = page.locator("[data-record-field-slug]");
  await expect(renderedFields).toHaveCount(base.fields.length - 1);
  await expect
    .poll(() =>
      renderedFields.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-record-field-slug")),
      ),
    )
    .toEqual(["description", "category", "body", "status", "notes", "subject"]);

  await expect(page.locator('[data-record-field-slug="path"]')).toHaveCount(0);
  await expect(page.getByText(descriptionValue, { exact: true })).toHaveCount(1);
  await expect(page.locator('[data-record-field-slug="status"]')).toContainText(longTextValue);
  await expect(page.locator('[data-record-field-slug="subject"]')).toContainText(
    "A field named subject is still a regular field",
  );
});
