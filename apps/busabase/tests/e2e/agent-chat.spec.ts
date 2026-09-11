import { expect, test } from "./_fixtures";

const prompt = "PUL-213 first prompt";

const capture = async (
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
  name: string,
) => {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
};

/** Connects the fixture-backed Buda AI Agent and lands on its detail page. */
const connectBudaAgent = async (page: import("@playwright/test").Page) => {
  await page.goto("/dashboard/local/agents", { waitUntil: "commit" });
  const agentsHeading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(agentsHeading).toBeVisible();

  await agentsHeading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Add agent", exact: true })).toBeVisible();

  const agentName = page.getByText("Buda AI Agent", { exact: true });
  const agentCard = agentName.locator("..").locator("..");
  await expect(agentCard).toContainText("Runs in Buda's cloud");
  await agentCard.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/local\/agents\/buda$/);
};

test("selects an ACP model before the first prompt and renders the completed reply", async ({
  page,
}, testInfo) => {
  await connectBudaAgent(page);

  const model = page.getByRole("combobox", { name: "Model" });
  const composer = page.getByPlaceholder("Message Buda AI Agent…");
  const submit = composer.locator("xpath=ancestor::form").locator('button[type="submit"]');
  await expect(model).toBeVisible();
  await expect(model).toContainText("Auto");
  await capture(page, testInfo, "01-default-model-before-first-prompt");

  await composer.fill(prompt);
  await expect(submit).toBeEnabled();
  await model.click();
  await page.getByRole("option", { name: "GPT-5.6", exact: true }).click();
  await expect(composer).toBeDisabled({ timeout: 500 });
  await expect(submit).toBeDisabled({ timeout: 500 });
  await expect(model).toContainText("GPT-5.6");
  await expect(model).toBeEnabled();
  await expect(composer).toBeEnabled();
  await expect(submit).toBeEnabled();
  await capture(page, testInfo, "02-selected-model-before-first-prompt");

  await submit.click();

  await expect(page.locator(".is-user").getByText(prompt, { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".is-assistant")
      .getByText(`GPT-5.6 received the first prompt: ${prompt}`, { exact: true }),
  ).toBeVisible();
  await expect(page.locator("section header").getByText("idle", { exact: true })).toBeVisible();
  await expect(model).toContainText("GPT-5.6");
  await expect(composer).toBeEnabled();
  await capture(page, testInfo, "03-first-prompt-reply-complete");
});

test("wide layout: the session rail lists every session and marks the active one", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectBudaAgent(page);

  const rail = page.getByRole("navigation", { name: "Sessions" });
  await expect(rail).toBeVisible();

  const rows = rail.getByTestId("agent-session-item");
  const initialCount = await rows.count();
  expect(initialCount).toBeGreaterThan(0);
  await expect(rail.locator('[data-testid="agent-session-item"][aria-current="true"]')).toHaveCount(
    1,
  );

  // A second, independent ACP connection: the fixture mints a new session id
  // per socket, so this exercises the real list refresh and selection path.
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(rows).toHaveCount(initialCount + 1);

  await expect(rail.locator('[data-testid="agent-session-item"][aria-current="true"]')).toHaveCount(
    1,
  );
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await capture(page, testInfo, "04-wide-rail-two-sessions");

  // Switching back to the older session moves the active marker with it.
  await rows.last().click();
  await expect(rows.last()).toHaveAttribute("aria-current", "true");
  await expect(rows.first()).not.toHaveAttribute("aria-current", "true");
});

test("narrow layout: the agent menu replaces the rail and lists every session", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connectBudaAgent(page);

  // Below the container's @2xl breakpoint the rail never mounts — every
  // session-switching affordance folds into one labelled trigger instead.
  await expect(page.getByRole("navigation", { name: "Sessions" })).toBeHidden();
  const menuTrigger = page.getByRole("button", { name: "Agent menu", exact: true });
  await expect(menuTrigger).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("idle");

  const detailView = page.getByTestId("agent-detail-view");
  expect(
    await detailView.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);

  const triggerBox = await menuTrigger.boundingBox();
  expect(triggerBox?.width).toBeGreaterThanOrEqual(44);
  expect(triggerBox?.height).toBeGreaterThanOrEqual(44);

  const panelButton = page.getByRole("button", { name: "Continue in side panel", exact: true });
  const panelButtonBox = await panelButton.boundingBox();
  expect(panelButtonBox?.width).toBeGreaterThanOrEqual(44);
  expect(panelButtonBox?.height).toBeGreaterThanOrEqual(44);

  await menuTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "New session", exact: true })).toBeVisible();
  await capture(page, testInfo, "05-narrow-agent-menu-open");

  const menu = page.getByRole("menu", { name: "Agent menu" });
  const sessionItems = menu.getByTestId("agent-session-item");
  expect(await sessionItems.count()).toBeGreaterThan(0);
  const activeSession = menu.locator('[data-testid="agent-session-item"][aria-current="true"]');
  await expect(activeSession).toHaveCount(1);

  const newSessionBox = await page
    .getByRole("menuitem", { name: "New session", exact: true })
    .boundingBox();
  expect(newSessionBox?.height).toBeGreaterThanOrEqual(44);
  const activeSessionBox = await activeSession.boundingBox();
  expect(activeSessionBox?.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");

  // The composer placeholder names the connected agent, localized via `fmt`.
  await expect(page.getByPlaceholder("Message Buda AI Agent…")).toBeVisible();
});

test("side-panel layout: the same conversation stays compact and contained", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectBudaAgent(page);

  await page.getByRole("button", { name: "Continue in side panel", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/home$/);

  const detailView = page.getByTestId("agent-detail-view");
  await expect(detailView).toBeVisible();
  await expect(detailView.getByRole("navigation", { name: "Sessions" })).toBeHidden();
  await expect(detailView.getByRole("button", { name: "Agent menu", exact: true })).toBeVisible();

  const dimensions = await detailView.evaluate((element) => ({
    clientWidth: element.clientWidth,
    overflow: element.scrollWidth - element.clientWidth,
  }));
  expect(dimensions.clientWidth).toBeGreaterThan(0);
  expect(dimensions.clientWidth).toBeLessThan(672);
  expect(dimensions.overflow).toBeLessThanOrEqual(1);
  await capture(page, testInfo, "06-side-panel-conversation");
});
