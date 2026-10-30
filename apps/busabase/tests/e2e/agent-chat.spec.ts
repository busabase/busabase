import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, json, test, unique } from "./_fixtures";
import { AcpFixtureStateSchema } from "./fixtures/acp-fixture-protocol";

const prompt = "first prompt";
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

const fixtureState = async () => {
  const response = await fetch(`${fixtureControlUrl}/control/state`);
  expect(response.ok).toBe(true);
  return AcpFixtureStateSchema.parse(await response.json());
};

const fixtureSessionCount = async () => (await fixtureState()).sessions;
const lastReceivedPrompt = async () => (await fixtureState()).prompts.at(-1);

const capture = async (
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
  name: string,
) => {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
};

const expectLatestProcess = async (
  detail: import("@playwright/test").Locator,
  status: "running" | "completed" | "cancelled",
) => {
  const process = detail.getByTestId("acp-process").last();
  await expect(process).toHaveAttribute("data-status", status);
  await expect(process.getByTestId("acp-process-summary")).toBeVisible();
  await expect(process.getByTestId("acp-process-summary")).toHaveAttribute(
    "aria-expanded",
    status === "running" ? "true" : "false",
  );
  const turnId = await process.getAttribute("data-turn-id");
  expect(turnId).toBeTruthy();
  return detail.locator(`[data-testid="acp-process"][data-turn-id=${JSON.stringify(turnId)}]`);
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

test("sends a PDF to a remote agent and restores its transcript after reload", async ({
  page,
}, testInfo) => {
  const capabilities = await fetch(`${fixtureControlUrl}/control/capabilities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embeddedContext: true }),
  });
  expect(capabilities.ok).toBe(true);
  try {
    await connectBudaAgent(page);
    const detail = page.getByTestId("agent-detail-view");
    const composer = page.getByPlaceholder("Message Buda AI Agent…");
    await expect(composer).toBeEnabled();
    await composer.fill("hi");
    await composer.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
    await expect(detail.locator(".is-assistant")).toContainText("first prompt: hi");
    await expect(composer).toBeEnabled();
    await capture(page, testInfo, "pdf-01-agent-ready");
    const pdfPath = process.env.BUSABASE_PDF_E2E_FILE;
    const filename = pdfPath ? path.basename(pdfPath) : "sample-document.pdf";
    const pdf = pdfPath
      ? await readFile(pdfPath)
      : Buffer.from(
          "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
            "2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\n" +
            "trailer<</Root 1 0 R>>\n%%EOF\n",
        );
    await detail.getByLabel("Upload files", { exact: true }).setInputFiles({
      name: filename,
      mimeType: "application/pdf",
      buffer: pdf,
    });
    await composer.fill("Tell me about this PDF");
    await capture(page, testInfo, "pdf-02-file-staged");
    await composer.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
    await expect(detail.locator(".is-user").last()).toContainText(filename);
    await expect(detail.locator(".is-assistant").last()).toContainText("Tell me about this PDF");
    await expect(composer).toBeEnabled();
    const received = await lastReceivedPrompt();
    expect(received?.prompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "resource",
          resource: expect.objectContaining({
            mimeType: "application/pdf",
            blob: pdf.toString("base64"),
          }),
        }),
      ]),
    );
    await capture(page, testInfo, "pdf-03-agent-replied");
    await page.reload();
    await expect(page.getByTestId("agent-detail-view").locator(".is-user").last()).toContainText(
      filename,
    );
    await expect(
      page.getByTestId("agent-detail-view").locator(".is-assistant").last(),
    ).toContainText("Tell me about this PDF");
    await expect(page.getByText("Could not persist the remote agent transcript.")).toBeHidden();
    await capture(page, testInfo, "pdf-04-transcript-restored");
  } finally {
    await fetch(`${fixtureControlUrl}/control/capabilities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ embeddedContext: false }),
    });
  }
});

test("previews staged attachments in the agent side panel without sending or removing them", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectBudaAgent(page);
  const slug = `attachment-preview-${Date.now()}`;
  await json(
    await request.post("/api/v1/docs", {
      data: { autoMerge: true, slug, name: "Review attachments", body: "# Review attachments\n" },
    }),
  );
  await page.goto(`/dashboard/local/doc/${slug}`);
  await page.getByTestId("node-agent-actions-trigger").click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Buda AI Agent", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Side panel" });
  await expect(panel).toBeVisible();
  const detail = panel.getByTestId("agent-detail-view");
  const composer = detail.getByPlaceholder("Message Buda AI Agent…");
  await expect(composer).toBeEnabled();
  const form = composer.locator("xpath=ancestor::form");
  await composer.fill("Check this picture before I send it.");
  const fileName = "review-attachments.png";
  const picture = await page.screenshot({ clip: { x: 256, y: 48, width: 600, height: 400 } });
  await detail.getByLabel("Upload files", { exact: true }).setInputFiles({
    name: fileName,
    mimeType: "image/png",
    buffer: picture,
  });
  const chip = form.getByRole("group", { name: fileName, exact: true });
  const preview = chip.getByRole("button", { name: `File preview: ${fileName}`, exact: true });
  await expect(preview).toBeVisible();
  const promptsBefore = (await fixtureState()).prompts.length;
  await capture(page, testInfo, "pul-370-01-image-staged-in-side-panel");

  await preview.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: fileName, exact: true })).toBeVisible();
  const image = dialog.getByRole("img", { name: fileName, exact: true });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  await expect(image).toHaveAttribute("src", /^blob:/);
  await capture(page, testInfo, "pul-370-02-click-opens-full-image-preview");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(preview).toBeFocused();
  await expect(composer).toHaveValue("Check this picture before I send it.");
  await expect(chip).toBeVisible();

  await preview.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(preview).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await preview.press("Space");
  await expect(dialog).toBeVisible();
  await expect(image).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await capture(page, testInfo, "pul-370-03-keyboard-preview-on-mobile");
  await page.keyboard.press("Escape");
  await expect(preview).toBeFocused();
  await chip.getByRole("button", { name: "Remove attachment", exact: true }).click();
  await expect(chip).toBeHidden();
  await expect(dialog).toBeHidden();
  expect((await fixtureState()).prompts).toHaveLength(promptsBefore);
  await capture(page, testInfo, "pul-370-04-back-to-draft-and-remove-without-sending");
});

test("shows explicit page resource cards while preserving user text, actual ACP contents and replay", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240_000);
  const capabilityResponse = await fetch(`${fixtureControlUrl}/control/capabilities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embeddedContext: false }),
  });
  expect(capabilityResponse.ok).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectBudaAgent(page);
  const name = unique("CEO instructions");
  const slug = `message-presentation-${Date.now()}`;
  const snapshotBody = "# Message presentation regression\n";
  const created = await json<{ node: { id: string } }>(
    await request.post("/api/v1/docs", {
      data: { autoMerge: true, slug, name, body: snapshotBody },
    }),
  );
  const openPanel = async () => {
    await page.getByTestId("node-agent-actions-trigger").click();
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Buda AI Agent", exact: true })
      .click();
    await expect(page.getByRole("region", { name: "Side panel" })).toBeVisible();
  };
  await page.goto(`/dashboard/local/doc/${slug}`, { waitUntil: "commit" });
  await openPanel();
  const panel = page.getByRole("region", { name: "Side panel" });
  const detail = panel.getByTestId("agent-detail-view");
  const composer = detail.getByPlaceholder("Message Buda AI Agent…");
  const send = async (text: string) => {
    await expect(composer).toBeEnabled();
    await composer.fill(text);
    await composer.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
  };
  const expectReferencedPrompt = async (userText: string) => {
    await expect
      .poll(async () => (await lastReceivedPrompt())?.prompt[0])
      .toEqual({ type: "text", text: userText });
    const wire = await lastReceivedPrompt();
    expect(wire?.prompt).toHaveLength(2);
    const reference = wire?.prompt[1];
    if (reference?.type !== "text") throw new Error("Expected separate page snapshot text");
    expect(reference.text).toContain(created.node.id);
    expect(reference.text).toContain(name);
    expect(reference.text).toContain(snapshotBody);
    expect(reference.annotations?.audience).toEqual(["user", "assistant"]);
    return wire;
  };
  const expectCard = async (message: import("@playwright/test").Locator) => {
    const card = message.getByTestId("agent-context-resource");
    await expect(card).toBeVisible();
    await expect(card.getByRole("link", { name, exact: true })).toHaveAttribute(
      "href",
      new RegExp(`/doc/${created.node.id}$`),
    );
    return card;
  };
  await expect(composer.locator("xpath=ancestor::form")).toContainText(name);
  const body = "这个不做。";
  await controlPrompt("prepare", body, "thought");
  await send(body);
  const firstMessage = detail.locator(".is-user").last();
  await expect(firstMessage.getByText(body, { exact: true })).toBeVisible();
  await expectCard(firstMessage);
  const wire = await expectReferencedPrompt(body);
  await testInfo.attach("actual-acp-prompt.json", {
    body: Buffer.from(JSON.stringify(wire, null, 2)),
    contentType: "application/json",
  });
  await capture(page, testInfo, "presentation-01-user-text-and-explicit-resource-card");
  await controlPrompt("release-progress", body);
  await controlPrompt("release-reply", body);
  await expect(detail.getByText(`Auto completed controlled prompt: ${body}`)).toBeVisible();

  // Literal user text is preserved even when it starts with the old prefix.
  const literal = "Target: this is my own text, keep it.";
  await controlPrompt("prepare", literal, "thought");
  await send(literal);
  await expect(detail.locator(".is-user").last().getByText(literal, { exact: true })).toBeVisible();
  await expectCard(detail.locator(".is-user").last());
  await expectReferencedPrompt(literal);
  await controlPrompt("release-progress", literal);
  await controlPrompt("release-reply", literal);
  await expect(detail.getByText(`Auto completed controlled prompt: ${literal}`)).toBeVisible();

  // A fresh mount reconstructs cards and their original snapshot from saved events.
  await page.reload();
  await openPanel();
  await expect(detail.locator(".is-user")).toHaveCount(2);
  await expect(detail.locator(".is-user").nth(0).getByText(body, { exact: true })).toBeVisible();
  await expect(detail.locator(".is-user").nth(1).getByText(literal, { exact: true })).toBeVisible();
  for (const index of [0, 1]) {
    const card = await expectCard(detail.locator(".is-user").nth(index));
    await card.locator("summary").click();
    await expect(card.locator("pre")).toContainText(snapshotBody);
    await card.locator("summary").click();
  }
  await capture(page, testInfo, "presentation-02-user-text-and-resource-cards-after-reload");

  // Removing the visible reference removes the snapshot from both wire and message.
  await detail.getByRole("button", { name: "Don't send this as context", exact: true }).click();
  const withoutContext = "Please answer without the page context.";
  await controlPrompt("prepare", withoutContext, "thought");
  await send(withoutContext);
  await expect(detail.locator(".is-user").last()).toHaveText(withoutContext);
  await expect
    .poll(async () => (await lastReceivedPrompt())?.prompt)
    .toEqual([{ type: "text", text: withoutContext }]);
  await expect(detail.locator(".is-user").last().getByTestId("agent-context-resource")).toHaveCount(
    0,
  );
  await controlPrompt("release-progress", withoutContext);
  await controlPrompt("release-reply", withoutContext);
  await expect(
    detail.getByText(`Auto completed controlled prompt: ${withoutContext}`),
  ).toBeVisible();
  await page.setViewportSize({ width: 430, height: 932 });
  await expect(detail.locator(".is-user").last()).toHaveText(withoutContext);
  await expect(
    detail.getByRole("button", { name: "Reference current page", exact: true }),
  ).toBeVisible();
  await capture(page, testInfo, "presentation-03-mobile-without-context");

  // Restore explicitly; neither sending nor rerendering may silently restore a removed reference.
  await page.setViewportSize({ width: 1280, height: 800 });
  await detail.getByRole("button", { name: "Reference current page", exact: true }).click();
  await expect(
    detail.getByRole("button", { name: "Don't send this as context", exact: true }),
  ).toBeVisible();
  const attachmentPrompt =
    "--- Attached file: review-notes.txt ---\nPlease review these notes.\n--- End of attached file: review-notes.txt ---";
  await controlPrompt("prepare", attachmentPrompt, "thought");
  const attachmentForm = composer.locator("xpath=ancestor::form");
  await detail.getByLabel("Upload files", { exact: true }).setInputFiles({
    name: "review-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Please review these notes."),
  });
  await expect(composer).toHaveValue("");
  await attachmentForm.locator('button[type="submit"]').click();
  await expect(detail.locator(".is-user")).toHaveCount(4);
  const attachmentMessage = detail.locator(".is-user").last();
  await expect(attachmentMessage).toContainText("review-notes.txt");
  await expectCard(attachmentMessage);
  await expect(attachmentMessage).not.toContainText("Target:");
  await expectReferencedPrompt(attachmentPrompt);
  await controlPrompt("release-progress", attachmentPrompt);
  await controlPrompt("release-reply", attachmentPrompt);
  await expect(composer).toBeEnabled();
  await page.setViewportSize({ width: 430, height: 932 });
  await expectCard(attachmentMessage);
  await capture(page, testInfo, "presentation-04-mobile-attachment-and-explicit-resource-card");
});

test("selects an ACP model before the first prompt and renders the completed reply", async ({
  page,
}, testInfo) => {
  await connectBudaAgent(page);

  const model = page.getByRole("button", { name: "Model", exact: true, includeHidden: true });
  const composer = page.getByPlaceholder("Message Buda AI Agent…");
  const submit = composer.locator("xpath=ancestor::form").locator('button[type="submit"]');
  await expect(model).toBeVisible();
  await expect(model).toContainText("Auto");
  await expectComposerAtDetailBottom(page.getByTestId("agent-detail-view"), composer);
  await capture(page, testInfo, "01-default-model-before-first-prompt");

  await composer.fill(prompt);
  await expect(submit).toBeEnabled();
  await model.click();
  await page.getByRole("menuitemradio", { name: "GPT-5.6", exact: true }).click();
  await expect(composer).toBeDisabled({ timeout: 500 });
  await expect(submit).toBeDisabled({ timeout: 500 });
  await expect(model).toContainText("GPT-5.6");
  await expect(model).toBeEnabled();
  await expect(page.getByRole("menuitemradio", { name: "High", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue(prompt);
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
  const detail = page.getByTestId("agent-detail-view");
  const process = await expectLatestProcess(detail, "running");
  const activity = page.getByTestId("agent-activity-indicator");
  await expect(activity).toBeHidden();
  await expect(process.getByTestId("acp-tool-call")).toHaveCount(0);
  await expect(process.getByTestId("acp-step")).toHaveCount(0);
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
  await expectLatestProcess(detail, "completed");
  await expect(
    process.getByText(`GPT-5.6 completed controlled prompt: ${prompt}`, { exact: true }),
  ).toHaveCount(0);
  await expect(activity).toBeHidden();
  await expect(model).toContainText("GPT-5.6");
  await expect(composer).toBeEnabled();
  await capture(page, testInfo, "03-first-prompt-reply-complete");
});

test("selects ACP Thinking Level and keeps the confirmed configuration after reload", async ({
  page,
}, testInfo) => {
  await page.goto("/dashboard/local/agents", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  await capture(page, testInfo, "thinking-01-enter-agents-panel");
  await connectBudaAgent(page);

  // Radix's modal menu hides the surrounding application from assistive
  // technology while open; retain the actual trigger for pending/value checks.
  const model = page.getByRole("button", { name: "Model", exact: true, includeHidden: true });
  const composer = page.getByPlaceholder("Message Buda AI Agent…");
  const submit = composer.locator("xpath=ancestor::form").locator('button[type="submit"]');
  await expect(model).toBeEnabled();
  if (!(await model.textContent())?.includes("Auto")) {
    await model.click();
    await page.getByRole("menuitemradio", { name: "Auto", exact: true }).click();
    await expect(model).toBeEnabled();
  }
  await expect(model).not.toContainText(/Low|Medium|High/);

  await model.click();
  await page.getByRole("menuitemradio", { name: "GPT-5.6", exact: true }).click();
  await expect(model).toContainText("Medium");
  await expect(model).toBeEnabled();
  await expect(page.getByRole("menuitemradio", { name: "Low", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "High", exact: true })).toBeVisible();
  await capture(page, testInfo, "thinking-02-choose-supported-level");

  const change = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/rpc/agents/sessions/setConfigOption"),
  );
  await page.getByRole("menuitemradio", { name: "High", exact: true }).click();
  await expect(composer).toBeDisabled({ timeout: 500 });
  await expect(model).toBeDisabled({ timeout: 500 });
  const changeResponse = await change;
  expect(changeResponse.ok()).toBe(true);
  const changed = (await changeResponse.json()) as {
    json: {
      id: string;
      thinkingOption: { id: string; currentValue: string };
    };
  };
  expect(changed.json.thinkingOption).toMatchObject({
    id: "reasoning_effort",
    currentValue: "high",
  });
  await expect(model).toContainText("High");
  await expect(composer).toBeEnabled();

  const configurationResponse = await fetch(`${fixtureControlUrl}/control/state`);
  expect(configurationResponse.ok).toBe(true);
  const state = (await configurationResponse.json()) as {
    configurations: Array<{ model: string; thinkingLevel: string | null }>;
  };
  expect(state.configurations).toContainEqual(
    expect.objectContaining({ model: "gpt-5.6", thinkingLevel: "high" }),
  );

  await composer.fill("Confirm thinking configuration");
  await submit.click();
  await expect(
    page.locator(".is-assistant").getByText("GPT-5.6 used Thinking Level: high", { exact: true }),
  ).toBeVisible();
  await expect(model).toContainText("High");
  await capture(page, testInfo, "thinking-03-agent-used-selected-level");

  await page.reload();
  await expect(model).toContainText("GPT-5.6");
  await expect(model).toContainText("High");
  await expect(model).toBeEnabled();
  await capture(page, testInfo, "thinking-04-confirmed-level-after-reload");

  await page.getByRole("button", { name: "View in side panel", exact: true }).click();
  const panel = page.getByRole("region", { name: "Side panel" });
  await expect(
    panel.getByRole("button", { name: "Model", exact: true, includeHidden: true }),
  ).toContainText("High");
  await model.click();
  await page.getByRole("menuitem", { name: /GPT-5.6/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "Low", exact: true })).toBeVisible();
  await capture(page, testInfo, "thinking-05-select-in-agents-side-panel");
  await page.getByRole("menuitemradio", { name: "Low", exact: true }).click();
  await expect(model).toContainText("Low");
  await expect(composer).toBeEnabled();
  await composer.fill("Confirm thinking configuration");
  await submit.click();
  await expect(
    panel.locator(".is-assistant").getByText("GPT-5.6 used Thinking Level: low", { exact: true }),
  ).toBeVisible();
  await capture(page, testInfo, "thinking-06-agent-used-level-from-side-panel");

  await model.click();
  await page.getByRole("menuitemradio", { name: "Auto", exact: true }).click();
  await expect(model).toContainText("Auto");
  await expect(model).not.toContainText(/Low|Medium|High/);
  await expect(model).toBeEnabled();
  await model.click();
  await page.getByRole("menuitemradio", { name: "GPT-5.6", exact: true }).click();
  await expect(model).toContainText("Medium");
  await expect(model).toBeEnabled();

  await page.setViewportSize({ width: 430, height: 932 });
  await expect(model).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "High", exact: true })).toBeVisible();
  await capture(page, testInfo, "thinking-07-mobile-selector");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await model.click();
  await page.getByRole("menuitemradio", { name: "Auto", exact: true }).click();
  await expect(model).not.toContainText(/Low|Medium|High/);
  await expect(model).toBeEnabled();
});

test("shows how to restore an archived Buda Agent", async ({ page }, testInfo) => {
  await connectBudaAgent(page);
  await page.evaluate(() => window.localStorage.setItem("busabaseLocale", "zh-CN"));
  await page.reload();

  const archivedMessage = "This agent is archived. Restore it from Space Settings to use it again.";
  await page.route("**/api/rpc/**/agents/sessions/prompt", async (route) => {
    const request = route.request().postDataJSON() as { json?: { sessionId?: string } };
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        json: {
          accepted: false,
          sessionId: request.json?.sessionId ?? "ags_archived",
          status: "failed",
          promptRecorded: false,
          message: archivedMessage,
        },
      }),
    });
  });

  const composer = page.getByPlaceholder("给 Buda AI Agent 发消息…");
  await composer.fill("你好");
  await composer.locator("xpath=ancestor::form").locator('button[type="submit"]').click();

  const alert = page.getByText(archivedMessage, { exact: true });
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(page.getByText("无法继续此会话。", { exact: true })).toHaveCount(0);
  await capture(page, testInfo, "archived-agent-recovery-guidance");
});

test("stops a streaming turn and keeps the follow-up separate", async ({ page }, testInfo) => {
  await connectBudaAgent(page);

  const composer = page.getByPlaceholder("Message Buda AI Agent…");
  const composerForm = composer.locator("xpath=ancestor::form");
  const submit = composerForm.locator('button[type="submit"]');
  const activity = page.getByTestId("agent-activity-indicator");

  const stopPrompt = "stop this turn";
  await controlPrompt("prepare", stopPrompt, "thought");
  await composer.fill(stopPrompt);
  await submit.click();

  await expect(page.locator(".is-user").getByText(stopPrompt, { exact: true })).toBeVisible();
  const detail = page.getByTestId("agent-detail-view");
  const stoppedProcess = await expectLatestProcess(detail, "running");
  await expect(activity).toBeHidden();

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
  await expectLatestProcess(detail, "cancelled");
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
  const followUp = "follow-up after stop";
  await composer.fill(followUp);
  await submit.click();
  await expect(page.locator(".is-user").getByText(followUp, { exact: true })).toBeVisible();
  const userMessages = page.locator(".is-user");
  await expect(userMessages).toHaveCount(2);
  await expect(userMessages.nth(0)).toContainText(stopPrompt);
  await expect(userMessages.nth(0)).not.toContainText(followUp);
  await expect(userMessages.nth(1)).toContainText(followUp);
  await expect(userMessages.nth(1)).not.toContainText(stopPrompt);
  await expect(
    page
      .locator(".is-assistant")
      .getByText(`Auto received the first prompt: ${followUp}`, { exact: true }),
  ).toBeVisible();
  await expectLatestProcess(detail, "completed");
  await expect(stoppedProcess).toHaveAttribute("data-status", "cancelled");
  await expect(activity).toBeHidden();
  await expect(composer).toBeEnabled();
  await capture(page, testInfo, "17-stop-turn-follow-up-stays-separate");
});

test("node side-panel chat keeps a post-cancel follow-up separate", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectBudaAgent(page);
  const sessionsBeforeSplitAction = await fixtureSessionCount();

  const name = unique("agent chat node");
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

  const firstTurn = "stop this side-panel turn";
  await controlPrompt("prepare", firstTurn, "thought");
  await composer.fill(firstTurn);
  const composerForm = composer.locator("xpath=ancestor::form");
  await composerForm.locator('button[type="submit"]').click();
  const activity = detail.getByTestId("agent-activity-indicator");
  await expect(detail.locator(".is-user").getByText(firstTurn, { exact: true })).toBeVisible();
  const stoppedProcess = await expectLatestProcess(detail, "running");
  await expect(activity).toBeHidden();
  const stop = composerForm.getByRole("button", { name: "Stop response" });
  await expect(stop).toBeVisible();
  await capture(page, testInfo, "10-node-side-panel-stop-available");

  await stop.click();
  await expect(activity).toBeHidden();
  await expectLatestProcess(detail, "cancelled");
  await expect(composer).toBeEnabled();
  const staleRelease = await fetch(`${fixtureControlUrl}/control/release-progress`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: firstTurn }),
  });
  expect(staleRelease.status).toBe(425);
  await capture(page, testInfo, "11-node-side-panel-turn-stopped");

  const secondTurn = "follow up in the same side-panel session";
  await controlPrompt("prepare", secondTurn, "tool");
  await composer.fill(secondTurn);
  await composerForm.locator('button[type="submit"]').click();
  await expect(detail.locator(".is-user").getByText(secondTurn, { exact: true })).toBeVisible();
  const userMessages = detail.locator(".is-user");
  await expect(userMessages).toHaveCount(2);
  await expect(userMessages.nth(0)).toContainText(firstTurn);
  await expect(userMessages.nth(0)).not.toContainText(secondTurn);
  await expect(userMessages.nth(1)).toContainText(secondTurn);
  await expect(userMessages.nth(1)).not.toContainText(firstTurn);
  await expectLatestProcess(detail, "running");
  await expect(stoppedProcess).toHaveAttribute("data-status", "cancelled");

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
  const completedProcess = await expectLatestProcess(detail, "completed");
  const completedReply = detail.getByText(`Auto completed controlled prompt: ${secondTurn}`, {
    exact: true,
  });
  await completedReply.scrollIntoViewIfNeeded();
  await expect(completedReply).toBeVisible();
  await expect(composer).toBeEnabled();
  await capture(page, testInfo, "12-node-side-panel-follow-up-complete");

  // Completed work folds away while its final answer remains visible. Opening
  // that process must reveal the original tool parameters and falsy result.
  await completedProcess.getByTestId("acp-process-summary").click();
  const toolCall = completedProcess.getByTestId("acp-tool-call").filter({
    hasText: `Inspect context for: ${secondTurn}`,
  });
  await toolCall.getByRole("button").first().click();
  await expect(toolCall.getByTestId("acp-tool-input")).toContainText(secondTurn);
  await expect(toolCall.getByTestId("acp-tool-output")).toContainText("false");
  await capture(page, testInfo, "13-node-side-panel-tool-result-expanded");
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
  const detail = page.getByTestId("agent-detail-view");
  await expect(rows.first()).toBeVisible();
  const initialCount = await rows.count();

  const researchPrompt = "investigate the interrupted session before proposing a fix";
  await controlPrompt("prepare", researchPrompt, "thought");
  await composer.fill(researchPrompt);
  await submit.click();
  await expect(page.locator(".is-user").getByText(researchPrompt, { exact: true })).toBeVisible();
  const researchProcess = await expectLatestProcess(detail, "running");
  const researchTurnId = await researchProcess.getAttribute("data-turn-id");
  expect(researchTurnId).toBeTruthy();
  await expect(activity).toBeHidden();
  await capture(page, testInfo, "18-first-session-still-working");

  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(rows).toHaveCount(initialCount + 1);
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await expect(composer).toBeEnabled();
  await expect(page.locator(".is-user").getByText(researchPrompt, { exact: true })).toHaveCount(0);
  await expect(detail.getByTestId("acp-process")).toHaveCount(0);
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
  await expectLatestProcess(detail, "completed");
  await capture(page, testInfo, "20-second-session-issue-draft-complete");

  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".is-user").getByText(researchPrompt, { exact: true })).toBeVisible();
  await expect(page.locator(".is-user").getByText(issuePrompt, { exact: true })).toHaveCount(0);
  const restoredProcess = await expectLatestProcess(detail, "running");
  await expect(restoredProcess).toHaveAttribute("data-turn-id", researchTurnId ?? "");
  await expect(activity).toBeHidden();
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
  await expectLatestProcess(detail, "completed");
  await expect(composer).toBeEnabled();

  const followUp = "reply after returning to the first session";
  await composer.fill(followUp);
  await submit.click();
  await expect(page.locator(".is-user").getByText(followUp, { exact: true })).toBeVisible();
  await expect(
    page.getByText(`Auto received the first prompt: ${followUp}`, { exact: true }),
  ).toBeVisible();
  await expectLatestProcess(detail, "completed");
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

  const panelButton = page.getByRole("button", { name: "View in side panel", exact: true });
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
  // Leave room for navigation, the main page and the full 760px panel.
  await page.setViewportSize({ width: 1440, height: 800 });
  await connectBudaAgent(page);

  await page.getByRole("button", { name: "View in side panel", exact: true }).click();
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

  // A 1280px viewport leaves only 664px after the navigation and minimum
  // main-content column. Widen the workspace before exercising a 760px panel.
  await page.setViewportSize({ width: 1440, height: 800 });
  const panel = page.getByRole("region", { name: "Side panel" });
  const resizeHandle = panel.getByRole("button", { name: "Resize side panel" });
  await resizeHandle.hover({ position: { x: 6, y: 400 } });
  const [resizeBounds, panelBounds] = await Promise.all([
    resizeHandle.boundingBox(),
    panel.boundingBox(),
  ]);
  expect(resizeBounds).not.toBeNull();
  expect(panelBounds).not.toBeNull();
  if (!resizeBounds || !panelBounds) {
    throw new Error("Side panel or its resize handle has no bounds");
  }
  const targetWidth = 760;
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => document.body.style.cursor)).toBe("col-resize");
  await page.mouse.move(
    resizeBounds.x + resizeBounds.width / 2 - (targetWidth - panelBounds.width),
    resizeBounds.y + resizeBounds.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())?.width).toBe(targetWidth);

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
  const connectedAgent = panel.locator(
    '[data-testid="agent-connection-card"][data-agent-slug="buda"]',
  );
  await expect(connectedAgent.getByText("Buda AI Agent", { exact: true })).toBeVisible();
  await expect(connectedAgent).toHaveAttribute("data-connection-state", "saved");
  await capture(page, testInfo, "13-side-panel-connected-agent-picker");

  await connectedAgent.locator(":scope > button").click();
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
