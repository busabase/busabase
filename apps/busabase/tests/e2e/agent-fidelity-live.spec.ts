import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// Credentials stay in the server's environment. Browser evidence contains only test work.
test.use({ trace: "off", video: "on" });

test("real Buda ACP: shows work, restores it, stops and continues the same conversation", async ({
  page,
}, info) => {
  test.setTimeout(600_000);
  const marker = `ACP_FIDELITY_${randomUUID().replaceAll("-", "")}`;
  const sourceQaOrigin =
    process.env.PLAYWRIGHT_EXPECT_SOURCE_ACP === "true"
      ? process.env.BUDA_ACP_QA_ORIGIN
      : undefined;
  if (process.env.PLAYWRIGHT_EXPECT_SOURCE_ACP === "true" && !sourceQaOrigin)
    throw new Error("Set the isolated BUDA_ACP_QA_ORIGIN when requiring source ACP evidence.");
  let workdir = "/tmp";
  if (sourceQaOrigin) {
    const url = new URL(sourceQaOrigin);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error("Source acceptance requires a loopback QA host.");
    const healthResponse = await fetch(`${sourceQaOrigin}/health`);
    expect(healthResponse.ok).toBe(true);
    const health = (await healthResponse.json()) as { isolated?: boolean; workdir?: string };
    expect(health.isolated).toBe(true);
    if (!health.workdir) throw new Error("The QA host did not expose its isolated workdir.");
    workdir = health.workdir;
  }
  const scratch = `${workdir}/${marker.toLowerCase()}`;
  if (sourceQaOrigin) await mkdir(scratch, { recursive: false });
  await page.goto("/dashboard/local/agents", { waitUntil: "commit" });
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(heading).toBeVisible();
  await page.screenshot({ path: info.outputPath("01-agents-entry.png") });
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  const card = page.getByTestId("agent-catalog-card").filter({ hasText: "Buda AI Agent" });
  await card.getByRole("button", { name: "Connect", exact: true }).click();
  const detail = page.locator('[data-testid="agent-detail-view"]:visible').last();
  let composer = detail.getByRole("textbox").last();
  await expect(composer).toBeVisible();
  await composer.fill(
    `This is a controlled ACP acceptance test. Work only in the new empty directory ${scratch}.${sourceQaOrigin ? " This directory already exists. Use only the write and read tools, with the exact absolute file path below; no shell commands are needed." : ""} Use your actual tools to create ${scratch}/proof.md containing exactly two lines: alpha and beta. Read the file back with a tool. Do not inspect environment variables, credentials, unrelated files, repositories, integrations, or external services. Finish by replying with ${marker}_DONE, the two file lines and the path. Do not merely describe tool use.`,
  );
  await composer.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
  const processCard = detail.getByTestId("acp-process").last();
  await expect(processCard).toBeVisible();
  await page.screenshot({ path: info.outputPath("02-real-running-process.png") });
  const reply = detail
    .getByTestId("acp-message-agent")
    .filter({ hasText: `${marker}_DONE` })
    .last();
  if (sourceQaOrigin) {
    let approvals = 0;
    await expect
      .poll(
        async () => {
          if (await reply.isVisible()) return true;
          const status = await processCard.getAttribute("data-status");
          if (status === "failed" || status === "interrupted")
            throw new Error(
              `Source execution ended with ${status}; inspect the actual source journal.`,
            );
          const allow = detail
            .locator('[data-testid="acp-permission"] button:enabled:visible')
            .filter({ hasText: /^Allow once$/ })
            .first();
          if (await allow.count()) {
            const stateResponse = await fetch(`${sourceQaOrigin}/control/state`);
            expect(stateResponse.ok).toBe(true);
            const state = (await stateResponse.json()) as {
              events: Array<{
                payload: {
                  update?: {
                    sessionUpdate?: string;
                    name?: string;
                    title?: string;
                    rawInput?: Record<string, unknown>;
                  };
                };
              }>;
            };
            const proposed = state.events.find(
              (entry) => entry.payload.update?.rawInput !== undefined,
            )?.payload.update;
            expect(proposed).toBeTruthy();
            const toolName = proposed?.name ?? proposed?.title?.split(":", 1)[0];
            expect(toolName?.toLowerCase()).toMatch(/^(write|read|write_file|read_file)$/);
            const input = proposed?.rawInput;
            expect(input?.path ?? input?.file_path ?? input?.filePath).toBe(`${scratch}/proof.md`);
            if (/write/i.test(toolName ?? ""))
              expect(String(input?.content).trimEnd()).toBe("alpha\nbeta");
            if (approvals === 0)
              await page.screenshot({
                path: info.outputPath("02b-source-permission-before-execution.png"),
              });
            await allow.click();
            approvals += 1;
          }
          return false;
        },
        { timeout: 210_000, intervals: [250, 500] },
      )
      .toBe(true);
    expect(approvals).toBeGreaterThanOrEqual(2);
  }
  await expect(reply).toBeVisible({ timeout: 210_000 });
  await expect(reply).toContainText("alpha");
  await expect(reply).toContainText("beta");
  await expect(processCard.getByTestId("acp-process-summary")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await processCard.getByTestId("acp-process-summary").click();
  for (const group of await processCard.getByTestId("acp-tool-run").all()) {
    if ((await group.getAttribute("aria-expanded")) === "false") await group.click();
  }
  const tools = processCard.getByTestId("acp-tool-call");
  await expect(tools.first()).toBeVisible();
  await expect(tools).not.toHaveCount(0);
  await tools.last().getByRole("button").first().click();
  await expect(tools.last().getByTestId("acp-tool-input")).toBeVisible();
  await expect(tools.last().getByTestId("acp-tool-output")).toContainText("alpha");
  if (sourceQaOrigin) {
    await expect(processCard.getByTestId("acp-step")).not.toHaveCount(0);
    const proofResponse = await fetch(`${sourceQaOrigin}/control/state`);
    expect(proofResponse.ok).toBe(true);
    const proof = (await proofResponse.json()) as {
      events: Array<{ payload: { event?: { type?: string } } }>;
    };
    expect(proof.events.some((entry) => entry.payload.event?.type === "step_started")).toBe(true);
    await info.attach("actual-source-journal.json", {
      body: Buffer.from(JSON.stringify(proof, null, 2)),
      contentType: "application/json",
    });
  }
  await page.screenshot({ path: info.outputPath("03-real-tools-and-answer.png") });

  const conversationUrl = page.url();
  await detail.getByRole("button", { name: "View in side panel", exact: true }).click();
  const panel = page.getByRole("region", { name: "Side panel" });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByTestId("acp-message-agent").filter({ hasText: `${marker}_DONE` }),
  ).toHaveCount(1);
  await panel.getByTestId("acp-process-summary").click();
  if (sourceQaOrigin) {
    await info.attach("compact-message-layout.json", {
      body: Buffer.from(
        JSON.stringify(
          await panel
            .getByTestId("acp-message-user")
            .locator("p")
            .evaluateAll((paragraphs) =>
              paragraphs.map((element) => ({
                client: element.clientWidth,
                scroll: element.scrollWidth,
                wrap: getComputedStyle(element).overflowWrap,
              })),
            ),
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
    await expect
      .poll(() =>
        panel
          .getByTestId("acp-message-user")
          .locator("p")
          .evaluateAll((paragraphs) =>
            paragraphs.every((element) => element.scrollWidth <= element.clientWidth + 1),
          ),
      )
      .toBe(true);
    for (const group of await panel.getByTestId("acp-tool-run").all()) {
      if ((await group.getAttribute("aria-expanded")) === "false") await group.click();
    }
    await expect
      .poll(() =>
        panel
          .getByTestId("acp-tool-call")
          .getByRole("button")
          .evaluateAll((buttons) =>
            buttons.every((element) => element.scrollWidth <= element.clientWidth + 1),
          ),
      )
      .toBe(true);
  }
  await page.screenshot({ path: info.outputPath("03b-real-compact-panel.png") });
  await page.getByRole("button", { name: "Collapse side panel", exact: true }).click();
  await page.goto(conversationUrl, { waitUntil: "commit" });
  const restored = page.locator('[data-testid="agent-detail-view"]:visible').last();
  await expect(
    restored.getByTestId("acp-message-agent").filter({ hasText: `${marker}_DONE` }),
  ).toHaveCount(1, { timeout: 90_000 });
  await expect(restored.getByTestId("acp-process")).toHaveCount(1);
  await restored.getByTestId("acp-process-summary").click();
  for (const group of await restored.getByTestId("acp-tool-run").all()) {
    if ((await group.getAttribute("aria-expanded")) === "false") await group.click();
  }
  await expect(restored.getByTestId("acp-tool-call").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("04-reloaded-same-process.png") });

  composer = restored.getByRole("textbox").last();
  await composer.fill(
    "For this controlled cancellation test, use no tools and take no external actions. Start writing a numbered list of 500 software reliability tips, one paragraph per item, and keep writing until stopped.",
  );
  await composer.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
  const stop = restored.getByRole("button", { name: "Stop response" });
  await expect(stop).toBeVisible();
  await expect(restored.getByTestId("acp-process")).toHaveCount(2);
  await expect(restored.getByTestId("acp-message-agent").last()).toContainText(/reliability|1\./i);
  await page.screenshot({ path: info.outputPath("05-second-turn-running.png") });
  const cancelResponse = page.waitForResponse((response) =>
    response.url().includes("/api/rpc/agents/sessions/cancel"),
  );
  await stop.click();
  const cancelled = await cancelResponse;
  expect(cancelled.ok(), await cancelled.text()).toBe(true);
  await expect(stop).toBeHidden({ timeout: 90_000 });
  await expect(restored.getByTestId("acp-process-summary").last()).toContainText("Stopped");
  await page.screenshot({ path: info.outputPath("06-stopped-with-history.png") });

  await composer.fill(
    sourceQaOrigin
      ? `Continue this same conversation without using tools. The isolated QA host will clean up the test directory. Reply with exactly ${marker}_CONTINUED.`
      : `Continue this same conversation. Remove only the test file ${scratch}/proof.md and its now-empty test directory ${scratch}; do not remove anything else. Then reply with exactly ${marker}_CONTINUED.`,
  );
  await composer.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
  await expect(
    restored
      .getByTestId("acp-message-agent")
      .filter({ hasText: `${marker}_CONTINUED` })
      .last(),
  ).toBeVisible({ timeout: 210_000 });
  await expect(composer).toBeEnabled();
  await page.screenshot({ path: info.outputPath("07-continued-and-cleaned-up.png") });
  await info.attach("Live acceptance scope", {
    body: Buffer.from(
      JSON.stringify(
        {
          agentId: process.env.BUDA_AGENT_ID,
          marker,
          scratch,
          validated: [
            "real ACP authentication",
            "real tool execution",
            "process display",
            "refresh/replay",
            "cancel",
            "same-session continuation",
          ],
          backendExtensionsRequired: Boolean(sourceQaOrigin),
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
});
