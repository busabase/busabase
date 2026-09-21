import { expect, test } from "@playwright/test";

test("real ACP: node action opens chat and completes two turns", async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard/local/agents", { waitUntil: "commit" });
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(heading).toBeVisible();
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  const agentCard = page.getByTestId("agent-catalog-card").filter({ hasText: "Buda AI Agent" });
  await expect(agentCard).toContainText("Remote");
  await agentCard.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByPlaceholder("Message Buda AI Agent…")).toBeVisible();
  const slug = `pul-226-live-${Date.now()}`;
  const response = await request.post("/api/v1/docs", {
    data: {
      autoMerge: true,
      slug,
      name: "Live ACP acceptance",
      body: "# Harmless acceptance test",
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto(`/dashboard/local/doc/${slug}`, { waitUntil: "commit" });
  await page.getByTestId("node-agent-actions-trigger").click();
  await page.screenshot({ path: info.outputPath("01-node-agent-action.png") });
  const agentMenu = page.getByRole("menu");
  await expect(agentMenu).toHaveCount(1);
  await expect(agentMenu.getByText("Ask Agent Directly", { exact: true })).toBeVisible();
  await agentMenu.getByRole("menuitem", { name: "Buda AI Agent", exact: true }).click();
  const detail = page.getByRole("region", { name: "Side panel" }).getByTestId("agent-detail-view");
  const composer = detail.getByPlaceholder("Message Buda AI Agent…");
  for (const [index, word] of ["FIRST", "SECOND"].entries()) {
    const marker = `PUL226_${word}_ACK`;
    await composer.fill(
      `This is a harmless UI acceptance test. Do not use tools, edit files, or take external actions. Reply with exactly ${marker} and nothing else.`,
    );
    await composer.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
    await expect(detail.locator(".is-user").last()).toContainText(marker);
    await page.screenshot({ path: info.outputPath(`0${index * 2 + 2}-submitted.png`) });
    const reply = detail.locator(".is-assistant").filter({ hasText: marker }).last();
    await expect(reply).toBeVisible({ timeout: 120_000 });
    await expect(detail.getByTestId("agent-activity-indicator")).toBeHidden();
    await reply.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`0${index * 2 + 3}-real-reply.png`) });
  }
});

test("real ACP: expands a Buda tool result", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard/local/agents", { waitUntil: "commit" });
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(heading).toBeVisible();
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  const agentCard = page.getByTestId("agent-catalog-card").filter({ hasText: "Buda AI Agent" });
  await agentCard.getByRole("button", { name: "Connect", exact: true }).click();

  const detail = page.getByTestId("agent-detail-view");
  const composer = detail.getByPlaceholder("Message Buda AI Agent…");
  const marker = `PUL262_TOOL_RESULT_ACK_${Date.now()}`;
  await composer.fill(
    "This is a harmless UI acceptance test. Use only your read tool to inspect package.json in " +
      `the current workspace. Do not edit files, run commands, or make network requests. After the read completes, reply with exactly ${marker}.`,
  );
  await composer.locator("xpath=ancestor::form").locator('button[type="submit"]').click();

  await expect(detail.locator(".is-assistant").filter({ hasText: marker }).last()).toBeVisible({
    timeout: 120_000,
  });
  await expect(detail.getByTestId("agent-activity-indicator")).toBeHidden();

  const toolCall = detail.getByTestId("acp-tool-call").last();
  await expect(toolCall).toBeVisible();
  await toolCall.click();
  await expect(toolCall.getByTestId("acp-tool-output")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: info.outputPath("real-buda-tool-result-expanded.png") });
});

test("real ACP: stops a streaming turn and keeps the session usable", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard/local/agents", { waitUntil: "commit" });
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(heading).toBeVisible();
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  const agentCard = page.getByTestId("agent-catalog-card").filter({ hasText: "Buda AI Agent" });
  await agentCard.getByRole("button", { name: "Connect", exact: true }).click();

  const composer = page.getByPlaceholder("Message Buda AI Agent…");
  const composerForm = composer.locator("xpath=ancestor::form");
  await expect(composer).toBeVisible();
  await composer.fill(
    "This is a harmless cancellation test. Do not use tools or take external actions. " +
      "Start writing a long numbered list of short software reliability tips and continue until stopped.",
  );
  await composerForm.locator('button[type="submit"]').click();

  const stop = composerForm.getByRole("button", { name: "Stop response" });
  await expect(stop).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: info.outputPath("01-real-streaming-stop-available.png") });
  const cancelResponse = page.waitForResponse((response) =>
    response.url().includes("/api/rpc/agents/sessions/cancel"),
  );
  await stop.click();
  expect((await cancelResponse).ok()).toBe(true);

  await expect(stop).toBeHidden({ timeout: 120_000 });
  await expect(composer).toBeEnabled();
  await page.screenshot({ path: info.outputPath("02-real-turn-stopped.png") });

  const marker = `PUL244_FOLLOW_UP_${Date.now()}`;
  await composer.fill(
    `Do not use tools or take external actions. Reply with exactly ${marker} and nothing else.`,
  );
  await composerForm.locator('button[type="submit"]').click();
  await expect(page.locator(".is-assistant").filter({ hasText: marker }).last()).toBeVisible({
    timeout: 120_000,
  });
  await expect(composer).toBeEnabled();
  await page.screenshot({ path: info.outputPath("03-real-follow-up-after-stop.png") });
});

test("real ACP: switches sessions during active work and replies after returning", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard/local/agents", { waitUntil: "commit" });
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(heading).toBeVisible();
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  const agentCard = page.getByTestId("agent-catalog-card").filter({ hasText: "Buda AI Agent" });
  await agentCard.getByRole("button", { name: "Connect", exact: true }).click();

  const rail = page.getByRole("navigation", { name: "Sessions" });
  const rows = rail.getByTestId("agent-session-item");
  const composer = page.getByPlaceholder("Message Buda AI Agent…");
  const composerForm = composer.locator("xpath=ancestor::form");
  const submit = composerForm.locator('button[type="submit"]');
  await expect(rows.first()).toBeVisible();
  const initialCount = await rows.count();
  const runId = Date.now();
  const researchMarker = `MULTI_SESSION_RESEARCH_${runId}`;

  await composer.fill(
    "This is a harmless session-switching acceptance test. Do not edit files or take external " +
      "actions. Use a terminal sleep command to wait 12 seconds, then reply with exactly " +
      `${researchMarker} and nothing else.`,
  );
  await submit.click();
  const stop = composerForm.getByRole("button", { name: "Stop response" });
  await expect(stop).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: info.outputPath("01-first-session-active.png") });

  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(rows).toHaveCount(initialCount + 1);
  await expect(composer).toBeEnabled();
  await page.screenshot({ path: info.outputPath("02-second-session-ready.png") });

  const issueMarker = `MULTI_SESSION_ISSUE_DRAFT_${runId}`;
  await composer.fill(
    "Draft only; do not submit an issue and do not use tools or take external actions. Reply with " +
      `exactly ${issueMarker} and nothing else.`,
  );
  await submit.click();
  await expect(page.locator(".is-assistant").filter({ hasText: issueMarker }).last()).toBeVisible({
    timeout: 120_000,
  });
  await expect(composer).toBeEnabled();
  await page.screenshot({ path: info.outputPath("03-second-session-issue-draft-complete.png") });

  const previousSession = rail
    .locator('[data-testid="agent-session-item"]:not([aria-current="true"])')
    .first();
  await previousSession.click();
  await expect(page.locator(".is-user").filter({ hasText: researchMarker }).last()).toBeVisible();
  await expect(page.locator(".is-user").filter({ hasText: issueMarker })).toHaveCount(0);
  await expect(
    page.locator(".is-assistant").filter({ hasText: researchMarker }).last(),
  ).toBeVisible({
    timeout: 120_000,
  });
  await expect(composer).toBeEnabled();
  await page.screenshot({ path: info.outputPath("04-returned-session-complete.png") });

  const followUpMarker = `MULTI_SESSION_FOLLOW_UP_${runId}`;
  await composer.fill(
    `Do not use tools or take external actions. Reply with exactly ${followUpMarker} and nothing else.`,
  );
  await submit.click();
  await expect(
    page.locator(".is-assistant").filter({ hasText: followUpMarker }).last(),
  ).toBeVisible({
    timeout: 120_000,
  });
  await expect(composer).toBeEnabled();
  await page.screenshot({ path: info.outputPath("05-first-session-follow-up-complete.png") });
});
