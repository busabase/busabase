import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./_fixtures";

const sourceOrigin = process.env.BUDA_ACP_QA_ORIGIN;
const modelOrigin = process.env.BUNNY_ACP_QA_MODEL_ORIGIN;
const detail = (page: Page) => page.locator('[data-testid="agent-detail-view"]:visible');
const composer = (page: Page) => detail(page).getByRole("textbox");
const mode = (page: Page) =>
  detail(page).getByRole("button", { name: "Permissions", exact: true, includeHidden: true });
const capture = async (page: Page, info: TestInfo, name: string) => {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
};
const scenario = async (value: "write" | "reject" | "full", marker: string, path: string) => {
  const response = await fetch(`${modelOrigin}/control/scenario`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario: value, marker, path, clearRequests: true }),
  });
  expect(response.ok).toBe(true);
};
const sourceState = async (): Promise<{
  sessions: Array<{ id: string; status: string }>;
  files: string[];
  rpcRequests: Array<{ method: string; sessionId?: string }>;
}> => {
  const response = await fetch(`${sourceOrigin}/control/state`);
  expect(response.ok).toBe(true);
  return response.json();
};
const fileText = async (path: string) => {
  const response = await fetch(`${sourceOrigin}/control/file?path=${encodeURIComponent(path)}`);
  if (!response.ok) return null;
  return ((await response.json()) as { text: string }).text;
};
const sendPrompt = async (page: Page, text: string) => {
  await expect(composer(page)).toBeEnabled();
  await composer(page).fill(text);
  await composer(page).locator("xpath=ancestor::form").locator('button[type="submit"]').click();
};
const choose = async (page: Page, name: "Default permissions" | "Full access", info?: TestInfo) => {
  await mode(page).click();
  if (info) {
    await expect(
      page.getByRole("menuitemradio", { name: "Default permissions", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitemradio", { name: "Full access", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Ask for approval before running tools that need permission.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Run tools without approval. Questions still require your answer.", {
        exact: true,
      }),
    ).toBeVisible();
    await capture(page, info, "07a-open-real-permission-options-and-descriptions");
  }
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await expect(mode(page)).toContainText(name);
  await expect(mode(page)).toBeEnabled();
};

test("Busabase permission policy controls actual Buda ACP and Pi writes", async ({
  page,
}, info) => {
  test.skip(
    !sourceOrigin || !modelOrigin,
    "Requires the isolated Buda source QA host and model gateway",
  );
  const run = `browser-permission-${Date.now()}`;
  const rejectedPath = `${run}-rejected.txt`;
  const approvedPath = `${run}-approved.txt`;
  const trustedPath = `${run}-trusted.txt`;
  await page.goto("/dashboard/local/agents");
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(heading).toBeVisible();
  await capture(page, info, "01-open-agents-to-connect-real-buda");
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  await page
    .getByTestId("agent-catalog-card")
    .filter({ hasText: "Buda AI Agent" })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/local\/agents\/buda$/);
  await expect(mode(page)).toContainText("Default permissions");
  await capture(page, info, "02-real-buda-default-policy-before-prompt");

  await scenario("reject", `${run}-REJECT`, rejectedPath);
  await sendPrompt(page, `Try writing ${rejectedPath}; wait for my decision.`);
  const rejected = detail(page).getByTestId("acp-permission").last();
  await expect(rejected.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
  expect(await fileText(rejectedPath)).toBeNull();
  await capture(page, info, "03-real-pi-write-waits-before-file-exists");
  await rejected.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(detail(page).locator(".is-assistant").last()).toContainText(
    `Completed reject: ${run}-REJECT`,
  );
  await expect(composer(page)).toBeEnabled();
  expect(await fileText(rejectedPath)).toBeNull();
  expect((await sourceState()).files).not.toContain(rejectedPath);
  await capture(page, info, "04-reject-finishes-without-writing-file");

  await scenario("write", `${run}-APPROVE`, approvedPath);
  await sendPrompt(page, `Write ${approvedPath} after I approve.`);
  const approved = detail(page).getByTestId("acp-permission").last();
  await expect(approved.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
  expect(await fileText(approvedPath)).toBeNull();
  await capture(page, info, "05-second-real-write-also-needs-approval");
  await approved.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(detail(page).locator(".is-assistant").last()).toContainText(
    `Completed write: ${run}-APPROVE`,
  );
  await expect.poll(() => fileText(approvedPath)).toBe(`${run}-APPROVE`);
  await expect(composer(page)).toBeEnabled();
  await capture(page, info, "06-approval-creates-file-with-exact-content");

  await choose(page, "Full access", info);
  await capture(page, info, "07-change-real-buda-session-to-full-access");
  const count = await detail(page).getByTestId("acp-permission").count();
  await scenario("full", `${run}-TRUSTED`, trustedPath);
  await sendPrompt(page, `Write ${trustedPath} with the selected policy.`);
  await expect(detail(page).locator(".is-assistant").last()).toContainText(
    `Completed full: ${run}-TRUSTED`,
  );
  await expect.poll(() => fileText(trustedPath)).toBe(`${run}-TRUSTED`);
  await expect(detail(page).getByTestId("acp-permission")).toHaveCount(count);
  await expect(composer(page)).toBeEnabled();
  await capture(page, info, "08-full-access-writes-without-permission-request");

  await page.reload();
  await expect(mode(page)).toContainText("Full access");
  await expect(composer(page)).toBeEnabled();
  await detail(page).getByRole("button", { name: "View in side panel", exact: true }).click();
  await expect(page.getByRole("region", { name: "Side panel" })).toBeVisible();
  await expect(mode(page)).toContainText("Full access");
  await capture(page, info, "09-reopen-real-session-in-side-panel-keeps-policy");
  await choose(page, "Default permissions");
  const guardedPath = `${run}-guarded-again.txt`;
  await scenario("reject", `${run}-GUARDED`, guardedPath);
  await sendPrompt(page, `Try writing ${guardedPath} after returning to default.`);
  const guarded = detail(page).getByTestId("acp-permission").last();
  await expect(guarded.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
  expect(await fileText(guardedPath)).toBeNull();
  await capture(page, info, "10-returning-to-default-restores-real-approval-gate");
  await guarded.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(detail(page).locator(".is-assistant").last()).toContainText(
    `Completed reject: ${run}-GUARDED`,
  );
  await expect(composer(page)).toBeEnabled();
  const final = await sourceState();
  expect(final.files).not.toContain(rejectedPath);
  expect(final.files).not.toContain(guardedPath);
  expect(final.files).toContain(approvedPath);
  expect(final.files).toContain(trustedPath);
  expect(
    final.rpcRequests.filter((request) => request.method === "session/set_config_option").length,
  ).toBeGreaterThanOrEqual(2);
  const evidence = {
    run,
    files: {
      rejected: await fileText(rejectedPath),
      approved: await fileText(approvedPath),
      trusted: await fileText(trustedPath),
      guarded: await fileText(guardedPath),
    },
    source: final,
  };
  await info.attach("actual-buda-pi-drive-proof", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
  await capture(page, info, "11-return-to-usable-chat-with-confirmed-default");
});
