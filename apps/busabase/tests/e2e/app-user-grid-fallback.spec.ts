import { expect, test } from "@playwright/test";

test.skip(process.env.APP_USER_GRID_E2E !== "1", "Requires an isolated local database");
test.setTimeout(180_000);
test("the self-hosted table edits app user IDs without a Cloud picker", async ({ page }, info) => {
  const rpc = async (path: string, input: unknown) => {
    const result = await page.request.post(`/api/rpc/${path}`, { data: { json: input } });
    expect(result.ok(), await result.text()).toBe(true);
    return (await result.json()).json;
  };
  const suffix = Date.now();
  const base = await rpc("bases/create", {
    name: `Self-hosted customer ${suffix}`,
    slug: `app-user-fallback-${suffix}`,
    autoMerge: true,
    fields: [
      { slug: "title", name: "Title", type: "text" },
      { slug: "customer", name: "Customer", type: "appUser" },
    ],
  });
  const record = await rpc("bases/createChangeRequest", {
    baseId: base.id,
    autoMerge: true,
    fields: { title: "Link a local customer", customer: null },
  });
  const saved = async () =>
    (await rpc("records/get", { recordId: record.id })).headCommit.payload.customer;
  await page.goto("/dashboard/local/home", { waitUntil: "commit" });
  await page.getByRole("link", { name: base.name, exact: true }).first().click();
  const cell = page.locator(`[data-grid-cell="${record.id}::customer"]`);
  await cell.click();
  const input = page.getByRole("textbox", { name: "Customer", exact: true });
  await expect(input).toBeFocused();
  await input.fill("external_customer_one");
  await page.screenshot({ path: info.outputPath("01-local-id-editor.png"), fullPage: true });
  await input.press("Tab");
  await expect.poll(saved).toBe("external_customer_one");
  await page.reload({ waitUntil: "commit" });
  await expect(cell).toContainText("external_customer_one");
  await cell.focus();
  await page.keyboard.press("Enter");
  await input.fill("external_customer_two");
  await input.press("Escape");
  expect(await saved()).toBe("external_customer_one");
  await cell.focus();
  await page.keyboard.press("F2");
  await input.fill("");
  await input.press("Enter");
  await expect.poll(saved).toBeNull();
  await page.reload({ waitUntil: "commit" });
  await expect(cell).toHaveText("-");
  await page.screenshot({ path: info.outputPath("02-local-id-cleared.png"), fullPage: true });
});
