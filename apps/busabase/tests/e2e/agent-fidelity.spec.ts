import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./_fixtures";

const controlUrl = `http://127.0.0.1:${process.env.BUSABASE_ACP_FIDELITY_PORT ?? 15442}`;
interface FixtureSession {
  id: string;
  seq: number;
  phase: string;
  prompts: string[];
  answers: Array<{ action: string; content?: Record<string, unknown> }>;
  decisions: string[];
  loads: number[];
  resourceReads: string[];
  snapshotReads: number;
}
const state = async (): Promise<FixtureSession[]> => {
  const response = await fetch(`${controlUrl}/control/state`);
  expect(response.ok).toBe(true);
  return ((await response.json()) as { sessions: FixtureSession[] }).sessions;
};
const control = async (action: string, sessionId: string) => {
  const response = await fetch(`${controlUrl}/control/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  const body = await response.text();
  expect(response.ok, body).toBe(true);
  return JSON.parse(body) as { seq: number; phase: string };
};
const capture = async (page: Page, info: TestInfo, name: string) => {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
};
const visibleDetail = (page: Page) => page.locator('[data-testid="agent-detail-view"]:visible');
const sendPrompt = async (page: Page, text: string) => {
  const composer = visibleDetail(page).getByPlaceholder("Message Buda AI Agent…");
  await expect(composer).toBeEnabled();
  await composer.fill(text);
  await composer.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
};

test("a user follows work, answers, reviews outputs, reconnects, and stops a later turn", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dashboard/local/agents");
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(heading).toBeVisible();
  await capture(page, info, "01-enter-from-agents");
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  const card = page.getByTestId("agent-catalog-card").filter({ hasText: "Buda AI Agent" });
  await card.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/local\/agents\/buda$/);
  await sendPrompt(page, "FULL_FIDELITY: inspect sources and prepare a report.");
  await expect(visibleDetail(page).getByTestId("acp-process")).toHaveAttribute(
    "data-status",
    "running",
  );
  await expect(visibleDetail(page).getByTestId("acp-plan")).toContainText("Inspect sources");
  await expect(visibleDetail(page).getByTestId("acp-step").first()).toHaveText("Inspect sources");
  await capture(page, info, "02-real-time-steps-and-plan");
  const session = (await state())[0];
  expect(session).toBeDefined();

  // Move the same active task into the compact panel, then return and refresh.
  await visibleDetail(page)
    .getByRole("button", { name: "View in side panel", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Side panel" })).toBeVisible();
  await expect(visibleDetail(page).getByTestId("acp-process")).toHaveAttribute(
    "data-turn-id",
    `${session.id}:turn:1`,
  );
  await capture(page, info, "03-same-work-in-compact-panel");
  await page.getByRole("button", { name: "Collapse side panel", exact: true }).click();
  await page.goBack();
  await page.reload();
  await expect(visibleDetail(page).getByTestId("acp-process")).toHaveAttribute(
    "data-status",
    "running",
  );
  await expect(visibleDetail(page).locator(".is-user")).toHaveCount(1);
  await capture(page, info, "04-refresh-keeps-current-process");

  await control("ask", session.id);
  const question = visibleDetail(page).getByTestId("acp-input-request");
  await expect(question).toHaveCount(1);
  await expect(question).toContainText("Choose the report scope");
  await question.getByLabel("Approach *").selectOption("Complete");
  await question.getByLabel("Recovery").check();
  await question.getByLabel("Notes *").fill("Keep steps and artifacts after reconnect.");
  await capture(page, info, "05-answer-in-the-panel");
  await question.getByRole("button", { name: "Send answer", exact: true }).click();
  await expect
    .poll(async () => (await state())[0]?.answers)
    .toEqual([
      {
        action: "accept",
        content: {
          approach: "Complete",
          topics: ["Recovery"],
          notes: "Keep steps and artifacts after reconnect.",
        },
      },
    ]);

  const permissions = visibleDetail(page).getByTestId("acp-permission");
  await expect(permissions.filter({ hasText: "Allow creating the report preview?" })).toHaveCount(
    1,
  );
  await capture(page, info, "06-real-permission-request");
  await permissions
    .filter({ hasText: "Allow creating the report preview?" })
    .getByRole("button", { name: "Allow once", exact: true })
    .click();
  const denied = permissions.filter({ hasText: "Allow deleting the source draft?" });
  await expect(denied).toBeVisible();
  await denied.getByRole("button", { name: "Reject", exact: true }).click();
  await expect
    .poll(async () => (await state())[0]?.decisions)
    .toEqual(["allow-once", "reject-once"]);
  await capture(page, info, "07-distinct-allow-and-reject-decisions");
  await control("finish", session.id);
  await expect(
    visibleDetail(page).getByText("Fidelity report ready", { exact: false }),
  ).toBeVisible();
  await expect(visibleDetail(page).getByTestId("acp-process")).toHaveAttribute(
    "data-status",
    "completed",
  );
  await expect(visibleDetail(page).getByTestId("acp-process-summary")).toHaveAttribute(
    "data-state",
    "closed",
  );
  const resource = visibleDetail(page).locator(
    '[data-testid="acp-resource"][data-resource-id="result-image"]',
  );
  await expect(resource).toHaveCount(1);
  await resource.getByRole("button", { name: "Open", exact: true }).click();
  await expect(resource.getByRole("img", { name: "acceptance-result.png" })).toBeVisible();
  await expect
    .poll(() =>
      resource
        .getByRole("img", { name: "acceptance-result.png" })
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect.poll(async () => (await state())[0]?.resourceReads).toEqual(["result-image"]);
  await expect(visibleDetail(page).getByTestId("acp-citations")).toContainText(
    "Acceptance reference",
  );
  await capture(page, info, "08-answer-and-authorized-resource-preview");

  const promptsBeforeSnapshot = (await state())[0].prompts.length;
  await visibleDetail(page).getByTestId("agent-session-information-trigger").click();
  const information = page.getByTestId("agent-session-information");
  await expect(information).toContainText("fixture-runner");
  await expect(information).toContainText("fixture-model");
  await expect(
    information
      .getByTestId("agent-browser-snapshot")
      .getByRole("img", { name: "Observed browser frame" }),
  ).toBeVisible();
  await expect(information.getByTestId("agent-terminal-snapshot")).toContainText(
    "Source inspection finished.",
  );
  await capture(page, info, "08b-read-existing-browser-and-terminal-observations");
  await control("snapshot-unavailable", session.id);
  await information.getByRole("button", { name: "Refresh snapshot", exact: true }).click();
  await expect(information.getByTestId("agent-browser-snapshot")).toContainText(
    "No browser activity has been observed.",
  );
  await expect(information.getByTestId("agent-terminal-snapshot")).toContainText(
    "No terminal output has been observed.",
  );
  expect((await state())[0].prompts.length).toBe(promptsBeforeSnapshot);
  await capture(page, info, "08c-missing-observations-are-explicit");
  await page.keyboard.press("Escape");

  await visibleDetail(page).getByTestId("acp-process-summary").click();
  const run = visibleDetail(page).getByTestId("acp-tool-run").first();
  await run.click();
  await visibleDetail(page)
    .getByTestId("acp-subtasks")
    .getByRole("button", { name: /subtask tools/ })
    .click();
  await expect(
    visibleDetail(page).getByText("Read acceptance source", { exact: true }),
  ).toHaveCount(1);
  await visibleDetail(page).getByText("Update report draft", { exact: true }).click();
  const diff = visibleDetail(page).getByTestId("acp-tool-diff");
  await diff.locator("summary").click();
  await expect(diff.getByLabel("Updated content")).toHaveText("Draft after acceptance");
  await capture(page, info, "09-inspect-subtask-and-file-diff");
  await control("duplicate", session.id);
  await expect(resource).toHaveCount(1);

  const beforeDisconnect = (await state())[0].seq;
  await control("offline-update", session.id);
  await page.reload();
  await sendPrompt(page, "Continue after the transport reconnected.");
  await expect(
    visibleDetail(page).getByText("Follow-up completed in the same session."),
  ).toBeVisible();
  await expect(
    visibleDetail(page).locator('[data-testid="acp-resource"][data-resource-id="recovered-note"]'),
  ).toHaveCount(1);
  await expect.poll(async () => (await state())[0]?.loads).toContain(beforeDisconnect);
  expect((await state()).length).toBe(1);
  await capture(page, info, "10-cursor-replay-recovers-offline-output");

  await sendPrompt(page, "FULL_FIDELITY: stop while waiting for my answer.");
  await expect(visibleDetail(page).getByTestId("acp-process").last()).toHaveAttribute(
    "data-status",
    "running",
  );
  await control("ask", session.id);
  await expect(
    visibleDetail(page)
      .getByTestId("acp-input-request")
      .last()
      .getByRole("button", { name: "Send answer", exact: true }),
  ).toBeVisible();
  await visibleDetail(page).getByRole("button", { name: "Stop response", exact: true }).click();
  const stoppedQuestion = visibleDetail(page).getByTestId("acp-process").last();
  await expect(stoppedQuestion).toHaveAttribute("data-status", "cancelled");
  await stoppedQuestion.getByTestId("acp-process-summary").click();
  await expect(stoppedQuestion.getByTestId("acp-input-request")).toContainText("Cancelled");
  await expect(
    stoppedQuestion.getByRole("button", { name: "Send answer", exact: true }),
  ).toHaveCount(0);
  await capture(page, info, "11-stop-cancels-pending-question");

  await sendPrompt(page, "FULL_FIDELITY: stop while waiting for permission.");
  await expect(visibleDetail(page).getByTestId("acp-process").last()).toHaveAttribute(
    "data-status",
    "running",
  );
  await control("ask", session.id);
  const lastQuestion = visibleDetail(page).getByTestId("acp-input-request").last();
  await lastQuestion.getByLabel("Approach *").selectOption("Complete");
  await lastQuestion.getByLabel("UI").check();
  await lastQuestion.getByLabel("Notes *").fill("Stop before authorization.");
  await lastQuestion.getByRole("button", { name: "Send answer", exact: true }).click();
  await expect(
    visibleDetail(page)
      .getByTestId("acp-permission")
      .last()
      .getByRole("button", { name: "Allow once", exact: true }),
  ).toBeVisible();
  await visibleDetail(page).getByRole("button", { name: "Stop response", exact: true }).click();
  const stoppedPermission = visibleDetail(page).getByTestId("acp-process").last();
  await expect(stoppedPermission).toHaveAttribute("data-status", "cancelled");
  await stoppedPermission.getByTestId("acp-process-summary").click();
  await expect(stoppedPermission.getByTestId("acp-permission-cancelled")).toContainText(
    "Cancelled",
  );
  await expect(
    stoppedPermission.getByRole("button", { name: "Allow once", exact: true }),
  ).toHaveCount(0);
  await stoppedPermission.getByTestId("acp-permission-cancelled").scrollIntoViewIfNeeded();
  await capture(page, info, "12-stop-cancels-pending-permission");

  await sendPrompt(page, "CANCEL_FIDELITY: wait until I stop this turn.");
  const latestProcess = visibleDetail(page).getByTestId("acp-process").last();
  await expect(latestProcess).toHaveAttribute("data-status", "running");
  await visibleDetail(page).getByRole("button", { name: "Stop response", exact: true }).click();
  await expect(latestProcess).toHaveAttribute("data-status", "cancelled");
  await capture(page, info, "13-stop-keeps-partial-process");
  await sendPrompt(page, "A final follow-up after stopping.");
  await expect(
    visibleDetail(page).getByText("Follow-up completed in the same session."),
  ).toHaveCount(2);
  await expect(visibleDetail(page).getByPlaceholder("Message Buda AI Agent…")).toBeEnabled();
  expect((await state()).length).toBe(1);
  await capture(page, info, "14-same-session-can-continue-after-stop");
  await info.attach("fixture-protocol-evidence.json", {
    body: Buffer.from(JSON.stringify(await state(), null, 2)),
    contentType: "application/json",
  });
});
