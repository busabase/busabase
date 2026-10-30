import { randomUUID } from "node:crypto";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./_fixtures";

const qaOrigin = process.env.BUDA_ACP_QA_ORIGIN ?? "http://127.0.0.1:33919";
const modelOrigin = process.env.BUNNY_ACP_QA_MODEL_ORIGIN ?? "http://127.0.0.1:33918";
interface SourceEvent {
  sessionId: string;
  seq: number;
  turnId?: string;
  method: string;
  payload: { update?: Record<string, unknown>; event?: Record<string, unknown> };
}
interface SourceState {
  sessions: Array<{ id: string; status: string; sandagentSessionId?: string | null }>;
  events: SourceEvent[];
  files: string[];
  rpcRequests: Array<{ method: string; sessionId?: string; afterSeq?: number }>;
}
interface ModelRequest {
  tools?: Array<{ function?: { name?: string } }>;
  messages?: Array<{
    role?: string;
    content?: unknown;
    tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
  }>;
}
async function sourceState(): Promise<SourceState> {
  const response = await fetch(`${qaOrigin}/control/state`);
  expect(response.ok).toBe(true);
  return response.json();
}
async function modelState(): Promise<{ requests: ModelRequest[] }> {
  const response = await fetch(`${modelOrigin}/requests`);
  expect(response.ok).toBe(true);
  return response.json();
}
async function scenario(name: "full" | "plain" | "reject" | "question" | "cancel", marker: string) {
  const response = await fetch(`${modelOrigin}/control/scenario`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario: name, marker, clearRequests: true }),
  });
  expect(response.ok).toBe(true);
}
const detail = (page: Page) => page.locator('[data-testid="agent-detail-view"]:visible').last();
async function sendPrompt(page: Page, text: string) {
  const composer = detail(page).getByPlaceholder("Message Buda AI Agent…");
  await expect(composer).toBeEnabled();
  await composer.fill(text);
  await composer.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
}
async function shot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
}
async function allowUntil(page: Page, ready: () => Promise<boolean>, timeout = 120_000) {
  let allowed = 0;
  await expect
    .poll(
      async () => {
        if (await ready()) return true;
        const button = detail(page)
          .locator('[data-testid="acp-permission"] button:enabled:visible')
          .filter({ hasText: /^Allow once$/ })
          .first();
        if (await button.count()) {
          await button.click();
          allowed += 1;
        }
        return false;
      },
      { timeout, intervals: [100, 250, 500] },
    )
    .toBe(true);
  return allowed;
}
async function expandProcess(process: Locator) {
  const summary = process.getByTestId("acp-process-summary");
  if ((await summary.getAttribute("aria-expanded")) === "false") await summary.click();
  for (const group of await process.getByTestId("acp-tool-run").all()) {
    if ((await group.getAttribute("aria-expanded")) === "false") await group.click();
  }
}

// The sole substituted boundary is the LLM's HTTP SSE response. ACP, Buda auth,
// handlers, DB, Drive, compiled Bunny, Pi, tool approval and tools stay real.
test("source chain: inspect real tool work, answer, read a signed artifact, reconnect and cancel", async ({
  page,
}, info) => {
  const healthResponse = await fetch(`${qaOrigin}/health`);
  expect(healthResponse.ok).toBe(true);
  const health = (await healthResponse.json()) as {
    isolated: boolean;
    agentId: string;
    model: string;
    daemon: string;
  };
  expect(health.isolated).toBe(true);
  expect(health.agentId).toBe(process.env.BUDA_ACP_QA_AGENT_ID ?? "agt_acp_source_qa");
  expect(new URL(health.model).hostname).toBe("127.0.0.1");
  expect(new URL(health.daemon).hostname).toBe("127.0.0.1");
  const existing = new Set((await sourceState()).sessions.map((session) => session.id));
  const marker = `SOURCE_UI_${randomUUID().replaceAll("-", "")}`;
  await scenario("full", marker);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dashboard/local/agents");
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(heading).toBeVisible();
  await shot(page, info, "01-agents-entry-for-source-chain");
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  await page
    .getByTestId("agent-catalog-card")
    .filter({ hasText: "Buda AI Agent" })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await sendPrompt(
    page,
    "Create, inspect and edit report.md using your real tools, ask me for its format, then run the real shell check and send the report.",
  );
  await expect(detail(page).getByTestId("acp-process").last()).toHaveAttribute(
    "data-status",
    "running",
  );
  await expect(detail(page).getByTestId("acp-permission").first()).toBeVisible();
  await shot(page, info, "02-real-proposed-tool-awaits-authorization");
  const sourceId = (await sourceState()).sessions.find((session) => !existing.has(session.id))?.id;
  expect(sourceId).toBeTruthy();
  if (!sourceId) throw new Error("The real Buda source session was not created.");
  const question = detail(page).getByTestId("acp-input-request").last();
  const approvalsBeforeQuestion = await allowUntil(page, () =>
    question
      .getByRole("button", { name: "Send answer", exact: true })
      .isVisible()
      .catch(() => false),
  );
  expect(approvalsBeforeQuestion).toBeGreaterThan(0);
  await expect(question).toBeVisible();
  await question.getByLabel("Format *").selectOption("Markdown");
  await question.getByLabel("Summary", { exact: true }).check();
  await question.getByLabel("Details", { exact: true }).check();
  await question.getByLabel("Title *").fill("A verified source-chain report");
  await shot(page, info, "03-single-multiple-and-free-text-input");
  await question.getByRole("button", { name: "Send answer", exact: true }).click();
  const reply = detail(page).getByTestId("acp-message-agent").filter({ hasText: marker }).last();
  const approvalsAfterQuestion = await allowUntil(page, () => reply.isVisible().catch(() => false));
  await expect(reply).toBeVisible();
  const fullProcess = detail(page).getByTestId("acp-process").first();
  await expect(fullProcess).toHaveAttribute("data-status", "completed");
  await expect(fullProcess.getByTestId("acp-process-summary")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await shot(page, info, "04-completed-answer-outside-collapsed-process");

  const fileResponse = await fetch(`${qaOrigin}/control/file?path=report.md`);
  expect(fileResponse.ok).toBe(true);
  const file = (await fileResponse.json()) as { text: string; bytes: number };
  expect(file.text).toBe(`# Verified\n\n${marker}\n`);
  expect(file.bytes).toBeGreaterThan(0);
  const modelProof = await modelState();
  const invoked = new Set(
    modelProof.requests.flatMap(
      (request) =>
        request.messages?.flatMap(
          (message) => message.tool_calls?.map((call) => call.function?.name ?? "") ?? [],
        ) ?? [],
    ),
  );
  for (const tool of [
    /^(write|Write|write_file)$/,
    /^(read|Read|read_file)$/,
    /^(edit|Edit|edit_file)$/,
    /^(ask_user_question|AskUserQuestion)$/,
    /^(bash|Bash|shell)$/,
  ])
    expect([...invoked].some((name) => tool.test(name))).toBe(true);
  const sourceProof = await sourceState();
  expect(
    sourceProof.sessions.find((session) => session.id === sourceId)?.sandagentSessionId,
  ).toBeTruthy();
  expect(
    sourceProof.events.filter((entry) => entry.payload.event?.type === "step_started").length,
  ).toBeGreaterThan(1);
  const planningAdvertised = modelProof.requests.some((request) =>
    request.tools?.some((tool) =>
      /^(update_plan|TodoWrite|todo_write)$/.test(tool.function?.name ?? ""),
    ),
  );
  if (planningAdvertised) await expect(detail(page).getByTestId("acp-plan")).toBeVisible();
  await expandProcess(fullProcess);
  for (const tool of await fullProcess.getByTestId("acp-tool-call").all()) {
    const trigger = tool.getByRole("button").first();
    if ((await trigger.getAttribute("aria-expanded")) === "false") await trigger.click();
  }
  const diff = fullProcess.getByTestId("acp-tool-diff").last();
  await expect(diff).toBeVisible();
  await diff.locator("summary").click();
  await expect(diff.getByLabel("Updated content")).toContainText("# Verified");
  await expect(
    fullProcess.getByTestId("acp-tool-output").filter({ hasText: "SOURCE_CHAIN_TOOL_DONE" }).last(),
  ).toBeVisible();
  await shot(page, info, "05-real-file-diff-and-shell-output");

  const report = detail(page).getByTestId("acp-resource").filter({ hasText: "report.md" }).last();
  await expect(report).toBeVisible();
  const previewResponse = page.waitForResponse(
    (response) =>
      response.url().startsWith(qaOrigin) &&
      new URL(response.url()).pathname === "/api/drive/cloud-download" &&
      new URL(response.url()).searchParams.get("download") !== "1",
  );
  await report.getByRole("button", { name: "Open", exact: true }).click();
  const signedPreview = await previewResponse;
  expect(signedPreview.ok()).toBe(true);
  expect((await signedPreview.allHeaders())["access-control-allow-origin"]).toBe("*");
  await expect(report.getByTestId("acp-text-preview")).toContainText(`# Verified\n\n${marker}`);
  await expect(report.getByRole("link", { name: "Download", exact: true })).toBeVisible();
  await shot(page, info, "06-signed-cross-origin-report-preview");
  const requestsBeforeSnapshot = (await modelState()).requests.length;
  await detail(page).getByTestId("agent-session-information-trigger").click();
  const information = page.getByTestId("agent-session-information");
  await expect(information).toContainText("pi");
  await expect(information.getByText("ACP source acceptance", { exact: true })).toBeVisible();
  await expect(information.getByText("acp", { exact: true })).toBeVisible();
  await expect(
    information
      .locator("dt")
      .filter({ hasText: /^Mode$/ })
      .locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("agent");
  await expect(information.getByTestId("agent-browser-snapshot")).toBeVisible();
  await expect(information.getByTestId("agent-terminal-snapshot")).toBeVisible();
  expect((await modelState()).requests.length).toBe(requestsBeforeSnapshot);
  await shot(page, info, "07-observed-runtime-information-without-new-execution");
  await page.keyboard.press("Escape");

  // Supplemental worker boundary: only this job's DB transitions are injected.
  // The normal read-only producer, persisted ACP events, signed file route,
  // Busabase subscription and video decoding remain real; no video provider runs.
  const modelRequestsBeforeBackground = (await modelState()).requests.length;
  const promptsBeforeBackground = (await sourceState()).rpcRequests.filter(
    (entry) => entry.method === "session/prompt",
  ).length;
  const turnsBeforeBackground = await detail(page).getByTestId("acp-process").count();
  const transitionJob = async (status: "queued" | "running" | "succeeded") => {
    const response = await fetch(`${qaOrigin}/control/job-transition`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sourceId, status }),
    });
    expect(response.ok).toBe(true);
    return response.json() as Promise<{ jobId: string; status: string; filePath: string }>;
  };
  const background = await transitionJob("queued");
  const backgroundJob = detail(page).locator(
    `[data-testid="acp-job"][data-job-id="${background.jobId}"]`,
  );
  await expect(backgroundJob).toHaveCount(1);
  await expect(backgroundJob).toHaveAttribute("data-status", "queued");
  await transitionJob("running");
  await expect(backgroundJob).toHaveAttribute("data-status", "running");
  await shot(page, info, "07b-background-job-progresses-after-the-turn");
  await transitionJob("succeeded");
  await expect(backgroundJob).toHaveAttribute("data-status", "succeeded");
  const lateOutput = detail(page)
    .getByTestId("acp-resource")
    .filter({ hasText: "late-output.mp4" });
  await expect(lateOutput).toHaveCount(1);
  const lateFileResponse = page.waitForResponse(
    (response) =>
      response.url().startsWith(qaOrigin) &&
      new URL(response.url()).pathname === "/api/drive/cloud-download" &&
      new URL(response.url()).searchParams.get("download") !== "1",
  );
  await lateOutput.getByRole("button", { name: "Open", exact: true }).click();
  const videoResponse = await lateFileResponse;
  expect(videoResponse.ok()).toBe(true);
  expect((await videoResponse.allHeaders())["content-type"]).toContain("video/mp4");
  const video = lateOutput.getByLabel("late-output.mp4");
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((element) => (element as HTMLVideoElement).videoWidth))
    .toBeGreaterThan(0);
  expect((await modelState()).requests.length).toBe(modelRequestsBeforeBackground);
  expect(
    (await sourceState()).rpcRequests.filter((entry) => entry.method === "session/prompt").length,
  ).toBe(promptsBeforeBackground);
  expect(await detail(page).getByTestId("acp-process").count()).toBe(turnsBeforeBackground);
  await shot(page, info, "07c-background-result-opens-without-another-prompt");
  const supplementalBackground = {
    jobId: background.jobId,
    filePath: background.filePath,
    states: ["queued", "running", "succeeded"],
    injectedBoundary:
      "Isolated external-worker DB status transitions; local ffmpeg generated the valid MP4",
    realBoundaries: [
      "read-only DB projector",
      "durable ACP events after turn end",
      "Busabase subscription",
      "signed HTTP file read",
      "browser video decoding",
    ],
    liveVideoProviderInvoked: false,
  };

  const toolCount = await fullProcess.getByTestId("acp-tool-call").count();
  await page.reload();
  await expect(
    detail(page).getByTestId("acp-message-agent").filter({ hasText: marker }),
  ).toHaveCount(1);
  const restoredProcess = detail(page).getByTestId("acp-process").first();
  await expandProcess(restoredProcess);
  expect(await restoredProcess.getByTestId("acp-tool-call").count()).toBe(toolCount);
  await shot(page, info, "08-real-persisted-process-after-refresh");
  const disconnect = await fetch(`${qaOrigin}/control/disconnect-idle`, { method: "POST" });
  expect(disconnect.ok).toBe(true);
  await scenario("plain", `${marker}_RECONNECTED`);
  await sendPrompt(page, "Continue the same conversation after reconnecting.");
  await expect(
    detail(page)
      .getByTestId("acp-message-agent")
      .filter({ hasText: `${marker}_RECONNECTED` }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      (await sourceState()).rpcRequests.some(
        (request) =>
          request.method === "session/load" &&
          request.sessionId === sourceId &&
          typeof request.afterSeq === "number" &&
          request.afterSeq >= 0,
      ),
    )
    .toBe(true);
  await shot(page, info, "09-real-source-cursor-reconnect");

  await scenario("reject", `${marker}_REJECTED`);
  await sendPrompt(page, "Propose creating rejected.txt, then observe my authorization decision.");
  const reject = detail(page)
    .locator('[data-testid="acp-permission"] button:enabled:visible')
    .filter({ hasText: /^Reject$/ })
    .first();
  await expect(reject).toBeVisible();
  await shot(page, info, "10-reject-real-write-before-execution");
  await reject.click();
  await expect(
    detail(page)
      .getByTestId("acp-message-agent")
      .filter({ hasText: `${marker}_REJECTED` }),
  ).toBeVisible();
  expect(
    (await sourceState()).files.some(
      (file) => file === "rejected.txt" || file.endsWith("/rejected.txt"),
    ),
  ).toBe(false);
  await shot(page, info, "11-rejected-file-remains-absent");

  await scenario("question", `${marker}_QUESTION_STOPPED`);
  await sendPrompt(page, "Ask me which output to prepare and wait for my answer.");
  const pendingQuestion = detail(page).getByTestId("acp-input-request").last();
  await allowUntil(page, () =>
    pendingQuestion
      .getByRole("button", { name: "Send answer", exact: true })
      .isVisible()
      .catch(() => false),
  );
  await detail(page).getByRole("button", { name: "Stop response", exact: true }).click();
  const stoppedQuestion = detail(page).getByTestId("acp-process").last();
  await expect(stoppedQuestion).toHaveAttribute("data-status", "cancelled");
  await expandProcess(stoppedQuestion);
  await expect(stoppedQuestion.getByTestId("acp-input-request")).toContainText("Cancelled");
  await expect(
    stoppedQuestion.getByRole("button", { name: "Send answer", exact: true }),
  ).toHaveCount(0);
  await shot(page, info, "12-stop-closes-the-real-pending-question");

  await scenario("cancel", `${marker}_CANCEL`);
  await sendPrompt(page, "Keep streaming until I stop this turn.");
  await expect(detail(page).getByTestId("acp-message-agent").last()).toContainText("Working");
  await shot(page, info, "13-real-runner-stream-before-stop");
  await detail(page).getByRole("button", { name: "Stop response", exact: true }).click();
  await expect(detail(page).getByTestId("acp-process").last()).toHaveAttribute(
    "data-status",
    "cancelled",
  );
  await expect
    .poll(
      async () => (await sourceState()).sessions.find((session) => session.id === sourceId)?.status,
    )
    .toBe("cancelled");
  await scenario("plain", `${marker}_CONTINUED`);
  await sendPrompt(page, "Continue in this same conversation after stopping.");
  await expect(
    detail(page)
      .getByTestId("acp-message-agent")
      .filter({ hasText: `${marker}_CONTINUED` }),
  ).toBeVisible();
  expect(
    (await sourceState()).sessions.filter((session) => !existing.has(session.id)),
  ).toHaveLength(1);
  await shot(page, info, "14-source-session-continues-after-cancellation");
  await info.attach("source-chain-evidence.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          provenance: {
            producer: "real Buda source ACP/auth/DB/Drive",
            runtime: "compiled Bunny daemon and Pi",
            substitutedBoundary: "LLM HTTP SSE responses only",
          },
          health,
          marker,
          sourceId,
          actualFile: file,
          approvalsBeforeQuestion,
          approvalsAfterQuestion,
          modelToolNames: [...invoked],
          plans: planningAdvertised
            ? "native plan tool advertised and checked"
            : "no native plan tool advertised by this Pi runtime; supplemental protocol coverage only",
          fullSourceEvents: sourceProof.events,
          supplementalBackground,
          finalState: await sourceState(),
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
});
