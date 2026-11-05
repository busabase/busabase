import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./_fixtures";

const controlUrl = `http://127.0.0.1:${process.env.BUSABASE_ACP_PERMISSION_PORT ?? 15530}`;
interface FixtureSession {
  id: string;
  surface: "config" | "legacy" | "unsupported";
  mode: string;
  prompts: Array<{ text: string; mode: string; askedPermission: boolean }>;
  selections: Array<{ method: string; value: string; accepted: boolean }>;
  decisions: string[];
}
const state = async (): Promise<FixtureSession[]> => {
  const response = await fetch(`${controlUrl}/control/state`);
  expect(response.ok).toBe(true);
  return ((await response.json()) as { sessions: FixtureSession[] }).sessions;
};
const configure = async (options: {
  surface?: FixtureSession["surface"];
  rejectNextSelection?: boolean;
}) => {
  const response = await fetch(`${controlUrl}/control/configure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options),
  });
  expect(response.ok).toBe(true);
};
const detail = (page: Page) => page.locator('[data-testid="agent-detail-view"]:visible');
const selector = (page: Page, name = "Permission mode") =>
  detail(page).getByRole("button", { name, exact: true, includeHidden: true });
const composer = (page: Page) => detail(page).getByRole("textbox");
const capture = async (page: Page, info: TestInfo, name: string) => {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
};
const sendPrompt = async (page: Page, text: string) => {
  await expect(composer(page)).toBeEnabled();
  await composer(page).fill(text);
  await composer(page).locator("xpath=ancestor::form").locator('button[type="submit"]').click();
};
const choose = async (page: Page, trigger: Locator, value: string) => {
  await trigger.click();
  await page.getByRole("menuitemradio", { name: value, exact: true }).click();
};
const connect = async (page: Page, info: TestInfo) => {
  await page.goto("/dashboard/local/agents");
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(heading).toBeVisible();
  await capture(page, info, "01-enter-agents");
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  const card = page.getByTestId("agent-catalog-card").filter({ hasText: "Buda AI Agent" });
  await card.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/agents\/buda$/);
  await expect(composer(page)).toBeEnabled();
};
const newSession = async (page: Page) => {
  const rows = page.getByRole("navigation", { name: "Sessions" }).getByTestId("agent-session-item");
  const count = await rows.count();
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(rows).toHaveCount(count + 1);
  await expect(composer(page)).toBeEnabled();
};

test("connected sessions default full access and preserve explicit permission choices", async ({
  page,
}, info) => {
  await configure({ surface: "config" });
  await connect(page, info);
  const mode = selector(page);
  await expect(mode).toContainText("Full access");
  await capture(page, info, "02-full-access-before-first-prompt");
  await sendPrompt(page, "Use the initial full access default");
  await expect(detail(page).locator(".is-assistant").last()).toContainText(
    "Full access completed: Use the initial full access default",
  );
  await expect(detail(page).getByTestId("acp-permission")).toHaveCount(0);
  await choose(page, mode, "Default");
  await expect(mode).toContainText("Default");
  await page.reload();
  await expect(mode).toContainText("Default");

  await sendPrompt(page, "Create the report preview");
  const permission = detail(page).getByTestId("acp-permission").last();
  await expect(permission).toContainText("Allow writing preview: Create the report preview?");
  await expect(composer(page)).toBeDisabled();
  await expect(mode).toBeDisabled();
  await capture(page, info, "03-default-asks-before-writing");
  await permission.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(detail(page).locator(".is-assistant").last()).toContainText(
    "Approved: Create the report preview",
  );

  await sendPrompt(page, "Delete the preview");
  const rejection = detail(page).getByTestId("acp-permission").last();
  await expect(rejection.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
  await rejection.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(detail(page).locator(".is-assistant").last()).toContainText(
    "Rejected: Delete the preview",
  );
  await capture(page, info, "04-reject-stops-the-proposed-action");

  // A failed protocol request must never appear as a confirmed local choice.
  await configure({ rejectNextSelection: true });
  const failed = page.waitForResponse(
    (response) =>
      response.url().includes("/agents/sessions/setConfigOption") &&
      response.request().method() === "POST",
  );
  await choose(page, mode, "Full access");
  await expect(mode).toBeDisabled({ timeout: 500 });
  await expect(mode).toContainText("Default");
  await expect(composer(page)).toBeDisabled({ timeout: 500 });
  expect((await failed).ok()).toBe(false);
  await expect(mode).toBeEnabled();
  await expect(mode).toContainText("Default");
  await capture(page, info, "05-rejected-mode-keeps-confirmed-default");
  await sendPrompt(page, "Retry after rejected mode");
  await expect(detail(page).getByTestId("acp-permission").last()).toContainText(
    "Retry after rejected mode",
  );
  await detail(page)
    .getByTestId("acp-permission")
    .last()
    .getByRole("button", { name: "Reject", exact: true })
    .click();
  await expect(composer(page)).toBeEnabled();

  await choose(page, mode, "Full access");
  await expect(mode).toContainText("Full access");
  await expect(mode).toBeEnabled();
  await capture(page, info, "06-confirm-full-access-in-footer");
  const permissionCount = await detail(page).getByTestId("acp-permission").count();
  await sendPrompt(page, "Write the trusted report");
  await expect(detail(page).locator(".is-assistant").last()).toContainText(
    "Full access completed: Write the trusted report",
  );
  await expect(detail(page).getByTestId("acp-permission")).toHaveCount(permissionCount);
  const first = (await state()).find((session) =>
    session.prompts.some((prompt) => prompt.text === "Write the trusted report"),
  );
  expect(first).toBeDefined();
  expect(first?.prompts).toEqual([
    { text: "Use the initial full access default", mode: "full-access", askedPermission: false },
    { text: "Create the report preview", mode: "default", askedPermission: true },
    { text: "Delete the preview", mode: "default", askedPermission: true },
    { text: "Retry after rejected mode", mode: "default", askedPermission: true },
    { text: "Write the trusted report", mode: "full-access", askedPermission: false },
  ]);
  expect(first?.selections).toEqual([
    { method: "session/set_config_option", value: "full-access", accepted: true },
    { method: "session/set_config_option", value: "default", accepted: true },
    { method: "session/set_config_option", value: "full-access", accepted: false },
    { method: "session/set_config_option", value: "full-access", accepted: true },
  ]);
  expect(first?.decisions).toEqual(["allow-once", "reject-once", "reject-once"]);
  await capture(page, info, "07-trusted-prompt-completes-without-another-permission");

  await page.reload();
  await expect(mode).toContainText("Full access");
  await expect(mode).toBeEnabled();
  await detail(page).getByRole("button", { name: "View in side panel", exact: true }).click();
  await expect(page.getByRole("region", { name: "Side panel" })).toBeVisible();
  await expect(selector(page)).toContainText("Full access");
  await capture(page, info, "08-refresh-and-side-panel-keep-confirmed-policy");
  await page
    .getByRole("region", { name: "Side panel" })
    .getByRole("button", { name: "Close tab", exact: true })
    .click();
  await page.getByRole("button", { name: "Collapse side panel", exact: true }).click();
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await page.getByTestId("agent-connection-card").filter({ hasText: "Buda AI Agent" }).click();
  await expect(mode).toContainText("Full access");

  await newSession(page);
  await expect(mode).toContainText("Full access");
  await choose(page, mode, "Default");
  await expect(mode).toContainText("Default");
  await sendPrompt(page, "New session remains guarded");
  const isolated = detail(page).getByTestId("acp-permission").last();
  await expect(isolated).toContainText("New session remains guarded");
  await capture(page, info, "09-new-session-keeps-its-own-default-policy");
  await isolated.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(composer(page)).toBeEnabled();
  const rows = page.getByRole("navigation", { name: "Sessions" }).getByTestId("agent-session-item");
  await rows.nth(1).click();
  await expect(mode).toContainText("Full access");
  await capture(page, info, "10-return-to-original-session-with-full-access");
  const second = (await state()).find((session) =>
    session.prompts.some((prompt) => prompt.text === "New session remains guarded"),
  );
  expect(second?.id).not.toBe(first?.id);
  expect(second?.mode).toBe("default");
  expect((await state()).find((session) => session.id === first?.id)?.mode).toBe("full-access");
  await info.attach("modern-acp-wire-state", {
    body: JSON.stringify(await state(), null, 2),
    contentType: "application/json",
  });
});

test("legacy ACP modes use session/set_mode and unsupported agents hide the selector", async ({
  page,
}, info) => {
  await connect(page, info);
  await configure({ surface: "legacy" });
  await newSession(page);
  const mode = selector(page, "Mode");
  await expect(mode).toContainText("Full access");
  await expect(mode).toBeEnabled();
  await sendPrompt(page, "Legacy trusted action");
  await expect(detail(page).locator(".is-assistant").last()).toContainText(
    "Full access completed: Legacy trusted action",
  );
  await expect(detail(page).getByTestId("acp-permission")).toHaveCount(0);
  await capture(page, info, "11-legacy-mode-controls-the-prompt");
  await page.reload();
  await expect(mode).toContainText("Full access");
  const legacy = (await state()).find((session) =>
    session.prompts.some((prompt) => prompt.text === "Legacy trusted action"),
  );
  expect(legacy?.surface).toBe("legacy");
  expect(legacy?.selections).toEqual([
    { method: "session/set_mode", value: "full-access", accepted: true },
  ]);

  await configure({ surface: "unsupported" });
  await newSession(page);
  await expect(selector(page)).toHaveCount(0);
  await expect(selector(page, "Mode")).toHaveCount(0);
  await expect(composer(page)).toBeEnabled();
  await capture(page, info, "12-unsupported-agent-hides-mode-selector");
  await info.attach("legacy-and-unsupported-acp-wire-state", {
    body: JSON.stringify(await state(), null, 2),
    contentType: "application/json",
  });
});
