import { expect, json, test, unique } from "./_fixtures";

const prompt = "PUL-213 first prompt";
const fixtureControlUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_ACP_FIXTURE_PORT ?? "15430"}`;

const controlPrompt = async (
  action: "prepare" | "release-progress" | "release-reply",
  promptText: string,
  progress?: "thought" | "tool",
) => {
  const send = () =>
    fetch(`${fixtureControlUrl}/control/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: promptText, ...(progress ? { progress } : {}) }),
    });
  if (action === "prepare") {
    expect((await send()).ok).toBe(true);
    return;
  }
  await expect.poll(async () => (await send()).ok).toBe(true);
};

const fixtureSessionCount = async () => {
  const response = await fetch(`${fixtureControlUrl}/control/state`);
  expect(response.ok).toBe(true);
  return ((await response.json()) as { sessions: number }).sessions;
};

const capture = async (
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
  name: string,
) => {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
};

const expectComposerAtDetailBottom = async (
  detail: import("@playwright/test").Locator,
  composer: import("@playwright/test").Locator,
) => {
  const [detailBox, composerBox] = await Promise.all([
    detail.boundingBox(),
    composer.locator("xpath=ancestor::form").boundingBox(),
  ]);
  expect(detailBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(
    Math.abs(
      (detailBox?.y ?? 0) +
        (detailBox?.height ?? 0) -
        ((composerBox?.y ?? 0) + (composerBox?.height ?? 0)),
    ),
  ).toBeLessThanOrEqual(1);
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

  const agentCard = page.getByTestId("agent-catalog-card").filter({ hasText: "Buda AI Agent" });
  await expect(agentCard).toContainText("Remote");
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
  await expectComposerAtDetailBottom(page.getByTestId("agent-detail-view"), composer);
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

  await controlPrompt("prepare", prompt, "thought");
  const promptAccepted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/rpc/agents/sessions/prompt"),
  );
  await submit.click();
  // Acceptance is an HTTP acknowledgement, not the lifetime of the ACP turn.
  // This must resolve while the fixture is still holding every progress and
  // reply event, or a reverse proxy can turn a healthy long run into a 504.
  expect((await promptAccepted).ok()).toBe(true);

  await expect(page.locator(".is-user").getByText(prompt, { exact: true })).toBeVisible();
  const activity = page.getByTestId("agent-activity-indicator");
  await expect(activity).toBeVisible();
  await expect(activity).toContainText("replying…");
  await capture(page, testInfo, "03-reply-pending-inline");
  await controlPrompt("release-progress", prompt);
  await expect(page.getByText(`Planning a response for: ${prompt}`, { exact: true })).toBeVisible();
  await expect(activity).toBeHidden();
  await controlPrompt("release-reply", prompt);
  await expect(
    page
      .locator(".is-assistant")
      .getByText(`GPT-5.6 completed controlled prompt: ${prompt}`, { exact: true }),
  ).toBeVisible();
  await expect(activity).toBeHidden();
  await expect(model).toContainText("GPT-5.6");
  await expect(composer).toBeEnabled();
  await capture(page, testInfo, "03-first-prompt-reply-complete");
});

test("stops a streaming turn (PUL-244) and can prompt again in the same session", async ({
  page,
}, testInfo) => {
  await connectBudaAgent(page);

  const composer = page.getByPlaceholder("Message Buda AI Agent…");
  const composerForm = composer.locator("xpath=ancestor::form");
  const submit = composerForm.locator('button[type="submit"]');
  const activity = page.getByTestId("agent-activity-indicator");

  const stopPrompt = "PUL-244 stop this turn";
  await controlPrompt("prepare", stopPrompt, "thought");
  await composer.fill(stopPrompt);
  await submit.click();

  await expect(page.locator(".is-user").getByText(stopPrompt, { exact: true })).toBeVisible();
  await expect(activity).toBeVisible();
  await expect(activity).toContainText("replying…");

  // The agent has reached `session/prompt` and is streaming — the composer's
  // submit button becomes the stop button while a turn is in flight.
  await controlPrompt("release-progress", stopPrompt);
  await expect(
    page.getByText(`Planning a response for: ${stopPrompt}`, { exact: true }),
  ).toBeVisible();
  const stop = composerForm.getByRole("button", { name: "Stop response" });
  await expect(stop).toBeVisible();
  await capture(page, testInfo, "15-stop-turn-streaming");

  await stop.click();

  // The fixture answers the still-pending `session/prompt` with
  // `stopReason: "cancelled"` once it sees `session/cancel` — proving the
  // protocol notification actually reached it (this used to be silently
  // ignored) — and only that response settling is what the UI waits on to
  // leave the busy state, not the cancel call resolving on its own.
  await expect(activity).toBeHidden();
  await expect(submit).toBeVisible();
  await expect(composer).toBeEnabled();
  await capture(page, testInfo, "16-stop-turn-idle-again");

  // A stale release-reply for the cancelled turn must not resurrect it: the
  // fixture already deleted the prepared entry when it answered the cancel.
  const staleRelease = await fetch(`${fixtureControlUrl}/control/release-reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: stopPrompt }),
  });
  expect(staleRelease.status).toBe(425);
  await expect(
    page.getByText(`Auto completed controlled prompt: ${stopPrompt}`, { exact: true }),
  ).toHaveCount(0);

  // The session must still accept a follow-up prompt after the stop.
  const followUp = "PUL-244 follow-up after stop";
  await composer.fill(followUp);
  await submit.click();
  await expect(page.locator(".is-user").getByText(followUp, { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".is-assistant")
      .getByText(`Auto received the first prompt: ${followUp}`, { exact: true }),
  ).toBeVisible();
  await expect(activity).toBeHidden();
  await expect(composer).toBeEnabled();
  await capture(page, testInfo, "17-stop-turn-follow-up-prompt-succeeds");
});

test("node side-panel chat stops an active turn and reuses the same session", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectBudaAgent(page);
  const sessionsBeforeSplitAction = await fixtureSessionCount();

  const name = unique("PUL-226 agent chat node");
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  await json<{ node: { id: string } }>(
    await request.post("/api/v1/docs", {
      data: { autoMerge: true, slug, name, body: "# Agent chat regression fixture\n" },
    }),
  );

  await page.goto(`/dashboard/local/doc/${slug}`, { waitUntil: "commit" });
  await page.getByTestId("node-agent-actions-trigger").click();
  const agentMenu = page.getByRole("menu");
  await expect(agentMenu).toHaveCount(1);
  await expect(agentMenu.getByText("Ask Agent Directly", { exact: true })).toBeVisible();
  await capture(page, testInfo, "09-node-split-action-flat-agent-menu");
  await agentMenu.getByRole("menuitem", { name: "Buda AI Agent", exact: true }).click();

  const sidePanel = page.getByRole("region", { name: "Side panel" });
  await expect(sidePanel).toBeVisible();
  const detail = sidePanel.getByTestId("agent-detail-view");
  await expect(detail).toBeVisible();
  const composer = detail.getByPlaceholder("Message Buda AI Agent…");
  await expect(composer).toBeVisible();
  await expect(detail.getByText("Context", { exact: true })).toHaveCount(0);
  await expect(
    detail.getByRole("button", { name: "Don't send this as context", exact: true }),
  ).toBeVisible();
  await expect.poll(fixtureSessionCount).toBe(sessionsBeforeSplitAction);

  const firstTurn = "PUL-250 stop this side-panel turn";
  await controlPrompt("prepare", firstTurn, "thought");
  await composer.fill(firstTurn);
  const composerForm = composer.locator("xpath=ancestor::form");
  await composerForm.locator('button[type="submit"]').click();
  const activity = detail.getByTestId("agent-activity-indicator");
  await expect(detail.locator(".is-user").getByText(firstTurn, { exact: true })).toBeVisible();
  await expect(activity).toContainText("replying…");
  const stop = composerForm.getByRole("button", { name: "Stop response" });
  await expect(stop).toBeVisible();
  await capture(page, testInfo, "10-node-side-panel-stop-available");

  await stop.click();
  await expect(activity).toBeHidden();
  await expect(composer).toBeEnabled();
  const staleRelease = await fetch(`${fixtureControlUrl}/control/release-progress`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: firstTurn }),
  });
  expect(staleRelease.status).toBe(425);
  await capture(page, testInfo, "11-node-side-panel-turn-stopped");

  const secondTurn = "PUL-250 follow up in the same side-panel session";
  await controlPrompt("prepare", secondTurn, "tool");
  await composer.fill(secondTurn);
  await composerForm.locator('button[type="submit"]').click();
  await expect(detail.locator(".is-user").getByText(secondTurn, { exact: true })).toBeVisible();
  await expect(activity).toContainText("replying…");

  await controlPrompt("release-progress", secondTurn);
  await expect(
    detail.getByText(`Inspect context for: ${secondTurn}`, { exact: true }),
  ).toBeVisible();
  await controlPrompt("release-reply", secondTurn);
  await expect(
    detail.getByText(`Auto completed controlled prompt: ${secondTurn}`, { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByText(`Auto completed controlled prompt: ${firstTurn}`, { exact: true }),
  ).toHaveCount(0);
  await expect(activity).toBeHidden();
  const completedReply = detail.getByText(`Auto completed controlled prompt: ${secondTurn}`, {
    exact: true,
  });
  await completedReply.scrollIntoViewIfNeeded();
  await expect(completedReply).toBeVisible();
  await expect(composer).toBeEnabled();
  await capture(page, testInfo, "12-node-side-panel-follow-up-complete");
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

test("keeps active work scoped while switching sessions and can reply after returning", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectBudaAgent(page);

  const rail = page.getByRole("navigation", { name: "Sessions" });
  const rows = rail.getByTestId("agent-session-item");
  const composer = page.getByPlaceholder("Message Buda AI Agent…");
  const composerForm = composer.locator("xpath=ancestor::form");
  const submit = composerForm.locator('button[type="submit"]');
  const activity = page.getByTestId("agent-activity-indicator");
  await expect(rows.first()).toBeVisible();
  const initialCount = await rows.count();

  const researchPrompt = "PUL-256 investigate the interrupted session before proposing a fix";
  await controlPrompt("prepare", researchPrompt, "thought");
  await composer.fill(researchPrompt);
  await submit.click();
  await expect(page.locator(".is-user").getByText(researchPrompt, { exact: true })).toBeVisible();
  await expect(activity).toContainText("replying…");
  await capture(page, testInfo, "18-first-session-still-working");

  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(rows).toHaveCount(initialCount + 1);
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await expect(composer).toBeEnabled();
  await expect(page.locator(".is-user").getByText(researchPrompt, { exact: true })).toHaveCount(0);
  await capture(page, testInfo, "19-second-session-ready");

  const issuePrompt = "Draft a new issue for the multi-session interruption; do not submit it";
  await controlPrompt("prepare", issuePrompt, "tool");
  await composer.fill(issuePrompt);
  await submit.click();
  await expect(page.locator(".is-user").getByText(issuePrompt, { exact: true })).toBeVisible();
  await controlPrompt("release-progress", issuePrompt);
  await expect(
    page.getByText(`Inspect context for: ${issuePrompt}`, { exact: true }),
  ).toBeVisible();
  await controlPrompt("release-reply", issuePrompt);
  await expect(
    page.getByText(`Auto completed controlled prompt: ${issuePrompt}`, { exact: true }),
  ).toBeVisible();
  await expect(activity).toBeHidden();
  await capture(page, testInfo, "20-second-session-issue-draft-complete");

  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".is-user").getByText(researchPrompt, { exact: true })).toBeVisible();
  await expect(page.locator(".is-user").getByText(issuePrompt, { exact: true })).toHaveCount(0);
  await expect(activity).toContainText("replying…");
  await capture(page, testInfo, "21-returned-to-working-session");

  await controlPrompt("release-progress", researchPrompt);
  await expect(
    page.getByText(`Planning a response for: ${researchPrompt}`, { exact: true }),
  ).toBeVisible();
  await controlPrompt("release-reply", researchPrompt);
  await expect(
    page.getByText(`Auto completed controlled prompt: ${researchPrompt}`, { exact: true }),
  ).toBeVisible();
  await expect(activity).toBeHidden();
  await expect(composer).toBeEnabled();

  const followUp = "PUL-256 reply after returning to the first session";
  await composer.fill(followUp);
  await submit.click();
  await expect(page.locator(".is-user").getByText(followUp, { exact: true })).toBeVisible();
  await expect(
    page.getByText(`Auto received the first prompt: ${followUp}`, { exact: true }),
  ).toBeVisible();
  await expect(composer).toBeEnabled();
  await capture(page, testInfo, "22-first-session-follow-up-complete");
});

test("session history: fetches older sessions as a second page", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectBudaAgent(page);

  const rail = page.getByRole("navigation", { name: "Sessions" });
  const rows = rail.getByTestId("agent-session-item");
  const newSession = page.getByRole("button", { name: "New session", exact: true });

  while ((await rows.count()) < 20) {
    const count = await rows.count();
    await newSession.click();
    await expect.poll(() => rows.count()).toBeGreaterThan(count);
  }

  await expect(rows).toHaveCount(20);
  const loadMore = rail.getByRole("button", { name: "Load more", exact: true });
  if (!(await loadMore.isVisible())) {
    // If the loop landed on exactly 20 total sessions, one more keeps the first
    // response capped at 20 and makes the backend return its next cursor.
    await newSession.click();
  }
  await expect(loadMore).toBeVisible();
  await capture(page, testInfo, "07-session-page-one");

  await loadMore.click();
  await expect.poll(() => rows.count()).toBeGreaterThan(20);
  await rows.last().click();
  await expect(rows.last()).toHaveAttribute("aria-current", "true");
  await capture(page, testInfo, "08-session-page-two");
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

  const detailView = page.getByTestId("agent-detail-view");
  await expect(detailView.getByTestId("agent-activity-indicator")).toBeHidden();
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
  await expectComposerAtDetailBottom(
    detailView,
    detailView.getByPlaceholder("Message Buda AI Agent…"),
  );
  await capture(page, testInfo, "06-side-panel-conversation");

  const panel = page.getByRole("region", { name: "Side panel" });
  const resizeHandle = panel.getByRole("button", { name: "Resize side panel" });
  await resizeHandle.hover({ position: { x: 6, y: 400 } });
  const resizeBounds = await resizeHandle.boundingBox();
  expect(resizeBounds).not.toBeNull();
  if (!resizeBounds) {
    throw new Error("Side panel resize handle has no bounds");
  }
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => document.body.style.cursor)).toBe("col-resize");
  await page.mouse.move(
    resizeBounds.x + resizeBounds.width / 2 - 340,
    resizeBounds.y + resizeBounds.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())?.width).toBe(760);

  await expect(detailView.getByRole("navigation", { name: "Sessions" })).toBeHidden();
  await expect(detailView.getByRole("button", { name: "Agent menu", exact: true })).toBeVisible();
  expect(
    await detailView.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  await capture(page, testInfo, "07-wide-side-panel-without-session-rail");
});

test("side-panel Agents card selects a connected agent and opens its chat", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectBudaAgent(page);
  await page.goto("/dashboard/local/home", { waitUntil: "commit" });

  await page.getByRole("button", { name: "Open side panel" }).click();
  const panel = page.getByRole("region", { name: "Side panel" });
  const agentsCard = panel.getByRole("button", { name: /Agents/ });
  await expect(agentsCard.locator(".lucide-chevron-right")).toBeVisible();
  await capture(page, testInfo, "12-side-panel-agents-launcher");

  await agentsCard.click();
  await expect(panel.getByRole("heading", { name: "Choose an agent" })).toBeVisible();
  const connectedAgent = panel.getByRole("button", { name: "Buda AI Agent", exact: true });
  await expect(connectedAgent).toBeVisible();
  await capture(page, testInfo, "13-side-panel-connected-agent-picker");

  await connectedAgent.click();
  const detail = panel.getByTestId("agent-detail-view");
  await expect(detail).toBeVisible();
  await expect(detail.getByPlaceholder("Message Buda AI Agent…")).toBeVisible();
  await capture(page, testInfo, "14-side-panel-selected-agent-chat");

  await detail.getByRole("button", { name: "Agent menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Agents", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Choose an agent" })).toBeVisible();

  await panel.getByRole("button", { name: "Back", exact: true }).click();
  await expect(panel.getByText("Nothing pinned")).toBeVisible();
});

test("long transcript: the composer stays at the bottom of the page", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await connectBudaAgent(page);

  const composer = page.getByPlaceholder("Message Buda AI Agent…");
  await composer.fill("Show a long answer");
  await composer.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
  await expect(page.getByText("Paragraph 40:", { exact: false })).toBeVisible();

  const detail = page.getByTestId("agent-detail-view");
  await expectComposerAtDetailBottom(detail, composer);
  const detailBox = await detail.boundingBox();
  expect(detailBox).not.toBeNull();
  expect(Math.abs((detailBox?.y ?? 0) + (detailBox?.height ?? 0) - 720)).toBeLessThanOrEqual(1);
  await capture(page, testInfo, "09-long-transcript-composer-bottom");
});
