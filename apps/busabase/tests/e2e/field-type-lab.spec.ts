import { expect, test } from "./_fixtures";

// The seeded "Field Type Lab" base (slug: field-type-lab) carries one column per
// Busabase field type. These specs drive the new-record form through the real
// dashboard UI: filling every editable input KIND (text / textarea / number /
// date / checkbox / select / url / email / tel), merging the change request, and
// confirming the canonical record renders. They also cover the two user-visible
// failure modes — a missing required field, and that server-managed fields are
// not askable on create.

const NEW_URL = "/dashboard/local/base/field-type-lab/new";
const TITLE = "E2E field coverage row";

test("creates a Field Type Lab record filling every editable input kind", async ({ page }) => {
  await page.goto(NEW_URL, { waitUntil: "commit" });
  await expect(page.getByText("New Field Type Lab record")).toBeVisible();

  // System + AI fields are hidden on create — there is nothing to enter yet.
  await expect(page.getByText("New Field Type Lab record")).toBeVisible();
  await expect(page.getByLabel("Created Time")).toHaveCount(0);
  await expect(page.getByLabel("Auto Number")).toHaveCount(0);

  // text (the primary field) + textareas
  await page.getByLabel("Text", { exact: true }).fill(TITLE);
  await page.getByLabel("Long Text").fill("A browser e2e fills the long text column.");
  await page.getByLabel("Markdown").fill("# heading\n\nbody");
  // number / date
  await page.getByLabel("Number", { exact: true }).fill("42");
  await page.getByLabel("Date", { exact: true }).fill("2026-06-24");
  // checkbox (the lab has exactly one)
  await page.getByRole("checkbox").check();
  // single select — choose by its visible option label
  await page.getByLabel("Select", { exact: true }).selectOption({ label: "In review" });
  // url / email / tel
  await page.getByLabel("URL", { exact: true }).fill("https://example.com");
  await page.getByLabel("Email", { exact: true }).fill("qa@example.com");
  await page.getByLabel("Phone", { exact: true }).fill("+1 555-123-4567");

  // "Submit Now" lives behind the split-button dropdown (direct merge, no review).
  await page.getByRole("button", { name: "More submit options" }).click();
  await page.getByRole("button", { name: "Submit Now" }).click();

  // Lands on the canonical record view; the primary (first) field is the title.
  await expect(page).toHaveURL(/\/dashboard\/local\/base\/field-type-lab\/[\w-]+$/);
  await expect(page.getByRole("heading", { name: TITLE }).first()).toBeVisible();
  // A couple of the entered values are rendered on the record detail.
  await expect(page.getByText("qa@example.com")).toBeVisible();
  await expect(page.getByText("In review").first()).toBeVisible();
});

test("blocks creation when the required Text field is empty", async ({ page }) => {
  await page.goto(NEW_URL, { waitUntil: "commit" });
  await expect(page.getByText("New Field Type Lab record")).toBeVisible();

  // Leave the required "Text" field empty; fill an optional one so the form is not blank.
  await page.getByLabel("Number", { exact: true }).fill("7");
  await page.getByRole("button", { name: "Submit Request" }).click();

  // Server-side validation surfaces in the error banner; we stay on the form.
  await expect(page.getByText(/required/i)).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/local\/base\/field-type-lab\/new$/);
});

test("submitting for review routes the new record to the inbox", async ({ page }) => {
  await page.goto(NEW_URL, { waitUntil: "commit" });
  await page.getByLabel("Text", { exact: true }).fill("Review-first lab row");

  // The primary action queues a change request for review rather than merging.
  await page.getByRole("button", { name: "Submit Request" }).click();

  await expect(page).toHaveURL(/\/dashboard\/local\/inbox\/[\w-]+$/);
  await expect(page.getByText("Review-first lab row").first()).toBeVisible();
});
