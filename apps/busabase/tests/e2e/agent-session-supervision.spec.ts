import { randomUUID } from "node:crypto";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./_fixtures";

const qaOrigin = process.env.BUDA_ACP_QA_ORIGIN ?? "http://127.0.0.1:33919";
const modelOrigin = process.env.BUNNY_ACP_QA_MODEL_ORIGIN ?? "http://127.0.0.1:33918";
interface SourceState {
  sessions: Array<{ id: string; status: string }>;
  rpcRequests: Array<{ method: string; sessionId?: string; afterSeq?: number }>;
}
async function sourceState(): Promise<SourceState> {
  const response = await fetch(`${qaOrigin}/control/state`);
  expect(response.ok).toBe(true);
  return response.json();
}
async function modelRequests(): Promise<number> {
  const response = await fetch(`${modelOrigin}/requests`);
  expect(response.ok).toBe(true);
  return ((await response.json()) as { requests: unknown[] }).requests.length;
}
async function scenario(marker: string) {
  const response = await fetch(`${modelOrigin}/control/scenario`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario: "plain", marker, clearRequests: false }),
  });
  expect(response.ok).toBe(true);
}
const detail = (page: Page) => page.locator('[data-testid="agent-detail-view"]:visible').last();
const status = (page: Page) => detail(page).getByTestId("agent-session-reliability");
const composer = (page: Page) => detail(page).getByPlaceholder("Message Buda AI Agent…");
const submit = (page: Page) =>
  composer(page).locator("xpath=ancestor::form").locator('button[type="submit"]');
async function shot(page: Page, info: TestInfo, name: string) {
  const file = info.outputPath(`${name}.png`);
  await page.screenshot({ path: file });
  await info.attach(name, { path: file, contentType: "image/png" });
}
async function ready(page: Page) {
  await expect(status(page)).toContainText("Connected");
  await expect(status(page)).toContainText("Ready");
  await expect(status(page)).toContainText("Saved");
  await expect(composer(page)).toBeEnabled();
}

test("a conversation survives two tabs, a socket handoff and a lost acceptance response without repeating work", async ({
  page,
  context,
}, info) => {
  const healthResponse = await fetch(`${qaOrigin}/health`);
  expect(healthResponse.ok).toBe(true);
  const health = (await healthResponse.json()) as {
    isolated: boolean;
    model: string;
    daemon: string;
  };
  expect(health.isolated).toBe(true);
  for (const origin of [health.model, health.daemon, modelOrigin])
    expect(new URL(origin).hostname).toBe("127.0.0.1");
  const existing = new Set((await sourceState()).sessions.map((session) => session.id));
  const marker = `SUPERVISION_UI_${randomUUID().replaceAll("-", "")}`;
  await scenario(`${marker}_FIRST`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dashboard/local/agents");
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(heading).toBeVisible();
  await shot(page, info, "01-user-enters-agents");
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  await page
    .getByTestId("agent-catalog-card")
    .filter({ hasText: "Buda AI Agent" })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await ready(page);
  await shot(page, info, "02-connection-message-and-history-ready");

  const firstPrompt = "Reply once so I can verify this conversation is saved.";
  await composer(page).fill(firstPrompt);
  await submit(page).click();
  await expect(
    detail(page)
      .getByTestId("acp-message-agent")
      .filter({ hasText: `${marker}_FIRST` }),
  ).toHaveCount(1);
  await ready(page);
  const created = (await sourceState()).sessions.filter((session) => !existing.has(session.id));
  expect(created).toHaveLength(1);
  const remoteId = created[0].id;
  await shot(page, info, "03-first-command-has-one-saved-answer");

  const second = await context.newPage();
  await second.goto(page.url(), { waitUntil: "commit" });
  await ready(second);
  await expect(
    detail(second).getByTestId("acp-message-user").filter({ hasText: firstPrompt }),
  ).toHaveCount(1);
  await expect(
    detail(second)
      .getByTestId("acp-message-agent")
      .filter({ hasText: `${marker}_FIRST` }),
  ).toHaveCount(1);
  const requestsBeforeHandoff = await modelRequests();
  const disconnect = await fetch(`${qaOrigin}/control/disconnect-idle`, { method: "POST" });
  expect(disconnect.ok).toBe(true);
  await expect
    .poll(async () =>
      (await sourceState()).rpcRequests.some(
        (request) =>
          request.method === "session/load" &&
          request.sessionId === remoteId &&
          typeof request.afterSeq === "number",
      ),
    )
    .toBe(true);
  await ready(page);
  await expect(status(page).getByText(/^Reference:/)).toHaveCount(0);
  await shot(page, info, "04-same-conversation-recovers-by-cursor-without-another-run");
  await second.reload({ waitUntil: "commit" });
  await ready(second);
  expect(await modelRequests()).toBe(requestsBeforeHandoff);
  await expect(
    detail(second)
      .getByTestId("acp-message-agent")
      .filter({ hasText: `${marker}_FIRST` }),
  ).toHaveCount(1);

  await scenario(`${marker}_ACK_LOST`);
  let droppedAcceptance = false;
  await page.route("**/api/rpc/**", async (route) => {
    const request = route.request();
    const isPrompt =
      request.url().includes("/agents/sessions/prompt") ||
      (request.postData() ?? "").includes("/agents/sessions/prompt");
    if (!droppedAcceptance && isPrompt) {
      droppedAcceptance = true;
      await route.fetch(); // Actual server admission commits before the response is lost.
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  const retryPrompt = "Keep this accepted message safe even if its HTTP response is lost.";
  await composer(page).fill(retryPrompt);
  await submit(page).click();
  await expect.poll(() => droppedAcceptance).toBe(true);
  await expect(
    detail(page)
      .getByTestId("acp-message-agent")
      .filter({ hasText: `${marker}_ACK_LOST` }),
  ).toHaveCount(1);
  await expect(composer(page)).toHaveValue(retryPrompt);
  await ready(page);
  await shot(page, info, "05-saved-answer-with-original-draft-after-response-loss");
  const promptsBeforeRetry = (await sourceState()).rpcRequests.filter(
    (request) => request.method === "session/prompt" && request.sessionId === remoteId,
  ).length;
  const modelBeforeRetry = await modelRequests();
  await submit(page).click();
  await expect(composer(page)).toHaveValue("");
  await ready(page);
  expect(
    (await sourceState()).rpcRequests.filter(
      (request) => request.method === "session/prompt" && request.sessionId === remoteId,
    ),
  ).toHaveLength(promptsBeforeRetry);
  expect(await modelRequests()).toBe(modelBeforeRetry);
  await page.reload();
  await ready(page);
  await expect(status(page).getByText(/^Reference:/)).toHaveCount(0);
  await expect(
    detail(page).getByTestId("acp-message-user").filter({ hasText: retryPrompt }),
  ).toHaveCount(1);
  await expect(
    detail(page)
      .getByTestId("acp-message-agent")
      .filter({ hasText: `${marker}_ACK_LOST` }),
  ).toHaveCount(1);
  await expect(detail(page).getByTestId("agent-pending-command")).toHaveCount(0);
  expect(
    (await sourceState()).sessions.filter((session) => !existing.has(session.id)),
  ).toHaveLength(1);
  await shot(page, info, "06-same-conversation-and-one-answer-after-retry-and-refresh");
  await info.attach("supervision-story-evidence", {
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify(
        {
          story:
            "Enter Agents, connect real Buda, observe saved reply in two tabs, recover an idle transport, lose a real admission response, safely retry and reload.",
          marker,
          remoteSessionId: remoteId,
          droppedAcceptance,
          promptsBeforeRetry,
          modelRequestsBeforeRetry: modelBeforeRetry,
          boundaries: [
            "real Busabase browser/RPC/PGlite",
            "real session supervisor/journal",
            "real Buda ACP/source journal",
            "real compiled Bunny runtime",
            "deterministic loopback model only",
          ],
          productionVerified: false,
          paidModelInvoked: false,
        },
        null,
        2,
      ),
    ),
  });
  await second.close();
});
