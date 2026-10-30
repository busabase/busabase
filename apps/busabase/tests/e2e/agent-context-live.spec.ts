import type { APIRequestContext, Locator, Page, Request, TestInfo } from "@playwright/test";
import { PromptAgentSessionInputSchema } from "busabase-contract/domains/agents/types";
import { z } from "zod";
import { expect, json, test } from "./_fixtures";

// This suite uses the configured real Buda agent. Secrets are provided only by
// the runner's environment; neither fixtures nor screenshots contain them.
test.setTimeout(360_000);
const promptEnvelopeSchema = z.object({ json: PromptAgentSessionInputSchema });
const sessionEnvelopeSchema = z.object({ json: z.object({ id: z.string() }) });
const docSchema = z.object({ node: z.object({ id: z.string() }) });
const baseSchema = z.object({ id: z.string(), nodeId: z.string() });
const promptInput = (request: Request) => promptEnvelopeSchema.parse(request.postDataJSON()).json;
const marker = () => `LIVE_${crypto.randomUUID().replaceAll("-", "")}`;
const fixtureSlug = (prefix: string) => `${prefix}-${crypto.randomUUID().replaceAll("-", "")}`;
const readCode =
  "Do not use tools, edit files, run commands, or take external actions. " +
  "For this and subsequent turns, when a page reference is supplied, read verification_code " +
  "from the latest supplied reference and reply with exactly its value, without formatting or any other text. " +
  "Use only the supplied page reference, not earlier messages.";

async function capture(page: Page, info: TestInfo, name: string) {
  const detail = page.getByTestId("agent-detail-view");
  const reply = detail.locator(".is-assistant").last();
  if (await reply.count()) {
    const snapshot = detail
      .getByTestId("agent-context-resource")
      .last()
      .locator("details[open] pre");
    if (await snapshot.count()) {
      await snapshot.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    }
    await reply.scrollIntoViewIfNeeded();
  }
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
}

/** Only sessions created or prompted by this test may be closed by cleanup. */
function ownSessions(page: Page, request: APIRequestContext) {
  const ids = new Set<string>();
  const reads: Promise<void>[] = [];
  page.on("response", (response) => {
    if (
      response.request().method() !== "POST" ||
      !response.url().includes("/api/rpc/agents/sessions/create") ||
      !response.ok()
    )
      return;
    reads.push(
      (async () => {
        const parsed = sessionEnvelopeSchema.safeParse(await response.json());
        if (parsed.success) ids.add(parsed.data.json.id);
      })().catch(() => undefined),
    );
  });
  return {
    ids,
    close: async () => {
      await Promise.allSettled(reads);
      for (const sessionId of ids) {
        await request
          .post("/api/rpc/agents/sessions/close", {
            data: { json: { sessionId } },
          })
          .catch(() => undefined);
      }
    },
  };
}

async function connectBuda(page: Page) {
  await page.goto("/dashboard/local/agents");
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(heading).toBeVisible();
  const existing = page.getByTestId("agent-connection-card").filter({ hasText: "Buda AI Agent" });
  if (await existing.count()) {
    await existing.locator("button").first().click();
  } else {
    await heading
      .locator("xpath=ancestor::header")
      .getByRole("button", { name: "Add agent", exact: true })
      .click();
    await page
      .getByTestId("agent-catalog-card")
      .filter({ hasText: "Buda AI Agent" })
      .getByRole("button", { name: "Connect", exact: true })
      .click();
  }
  const composer = page.getByPlaceholder("Message Buda AI Agent…");
  const empty = page.getByRole("heading", { name: "No sessions yet", exact: true });
  await expect(composer.or(empty)).toBeVisible();
  if (await empty.isVisible()) {
    await page.getByRole("button", { name: "New session", exact: true }).last().click();
  }
  await expect(composer).toBeVisible();
}

async function openFromNode(page: Page, path: string) {
  await page.goto(path);
  await page.getByTestId("node-agent-actions-trigger").click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Buda AI Agent", exact: true })
    .click();
  const detail = page.getByRole("region", { name: "Side panel" }).getByTestId("agent-detail-view");
  await expect(detail.getByPlaceholder("Message Buda AI Agent…")).toBeVisible();
  return detail;
}

async function send(page: Page, detail: Locator, text: string, sessions: Set<string>) {
  const field = detail.getByPlaceholder("Message Buda AI Agent…");
  await expect(field).toBeEnabled();
  const outgoing = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/api/rpc/agents/sessions/prompt"),
  );
  await field.fill(text);
  await field.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
  const input = promptInput(await outgoing);
  sessions.add(input.sessionId);
  expect(input.text).toBe(text);
  expect(input.text).not.toContain("Target: the Busabase");
  return input;
}

async function expectExactReply(detail: Locator, expected: string) {
  const reply = detail.locator(".is-assistant").filter({ hasText: expected }).last();
  await expect(reply).toBeVisible({ timeout: 120_000 });
  await expect(reply).toHaveText(expected);
  await expect(detail.getByPlaceholder("Message Buda AI Agent…")).toBeEnabled({ timeout: 120_000 });
  await expect(detail.getByTestId("agent-activity-indicator")).toBeHidden();
  await expect(detail.getByTestId("acp-tool-call")).toHaveCount(0);
}

test("real Buda reads a Doc reference, a fresh reference-only turn, and durable cards after reload", async ({
  page,
  request,
}, info) => {
  const owned = ownSessions(page, request);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await connectBuda(page);
    const slug = fixtureSlug("live-context-doc");
    const name = "Live reference document";
    const firstCode = marker();
    const doc = docSchema.parse(
      await json(
        await request.post("/api/v1/docs", {
          data: {
            autoMerge: true,
            slug,
            name,
            body: `# Reference data\n\nverification_code: ${firstCode}`,
          },
        }),
      ),
    );
    let detail = await openFromNode(page, `/dashboard/local/doc/${doc.node.id}`);
    const form = detail.getByPlaceholder("Message Buda AI Agent…").locator("xpath=ancestor::form");
    await expect(form).toContainText(name);
    await capture(page, info, "01-open-document-reference-visible-before-send");

    const first = await send(page, detail, readCode, owned.ids);
    expect(first.contextReferences).toEqual([{ nodeId: doc.node.id }]);
    expect(first.text).not.toContain(firstCode);
    await expectExactReply(detail, firstCode);
    const firstMessage = detail.locator(".is-user").last();
    await expect(firstMessage.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(firstMessage.getByText(readCode, { exact: true })).toBeVisible();
    await firstMessage.locator("summary").click();
    await expect(firstMessage).toContainText(firstCode);
    await capture(page, info, "02-real-model-answers-code-present-only-in-reference");

    const nextCode = marker();
    await json(
      await request.put(`/api/v1/nodes/${doc.node.id}/content`, {
        data: {
          autoMerge: true,
          content: {
            kind: "doc",
            body: `# Updated reference data\n\nverification_code: ${nextCode}`,
          },
        },
      }),
    );
    const next = await send(page, detail, "", owned.ids);
    expect(next.contextReferences).toEqual([{ nodeId: doc.node.id }]);
    expect(next.text).toBe("");
    await expectExactReply(detail, nextCode);
    const nextMessage = detail.locator(".is-user").last();
    await nextMessage.locator("summary").click();
    await expect(nextMessage).toContainText(nextCode);
    await expect(nextMessage).not.toContainText(firstCode);
    await expect(detail.locator(".is-user").first()).toContainText(firstCode);
    await capture(
      page,
      info,
      "03-reference-only-turn-reads-updated-content-with-old-snapshot-preserved",
    );

    await page.reload();
    await expect(page.getByRole("heading", { name, exact: true }).first()).toBeVisible();
    await page.getByRole("link", { name: "Agents", exact: true }).click();
    await page
      .getByTestId("agent-connection-card")
      .filter({ hasText: "Buda AI Agent" })
      .locator("button")
      .first()
      .click();
    detail = page.getByTestId("agent-detail-view");
    await expect(detail.locator(".is-user")).toHaveCount(2);
    for (const [index, code] of [firstCode, nextCode].entries()) {
      const message = detail.locator(".is-user").nth(index);
      await expect(message.getByRole("link", { name, exact: true })).toHaveAttribute(
        "href",
        `/dashboard/local/doc/${doc.node.id}`,
      );
      await message.locator("summary").click();
      await expect(message).toContainText(code);
    }
    await expect(
      detail.getByPlaceholder("Message Buda AI Agent…").locator("xpath=ancestor::form"),
    ).toContainText(name);
    await capture(
      page,
      info,
      "04-reloaded-conversation-retains-exact-snapshots-and-explicit-origin",
    );

    await detail.getByRole("button", { name: "Don't send this as context", exact: true }).click();
    const generalReply = "REFERENCE_REMOVED_OK";
    const generalQuestion = `Do not use tools or take external actions. Ignore earlier tasks and reply exactly ${generalReply}.`;
    const removed = await send(page, detail, generalQuestion, owned.ids);
    expect(removed.contextReferences).toBeUndefined();
    await expectExactReply(detail, generalReply);
    await expect(
      detail.locator(".is-user").last().getByTestId("agent-context-resource"),
    ).toHaveCount(0);
    await capture(page, info, "05-removing-reference-sends-user-text-without-a-node-card");

    await detail.getByRole("button", { name: "Agent menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "New session", exact: true }).click();
    await expect(
      detail.getByRole("button", { name: "Don't send this as context", exact: true }),
    ).toBeVisible();
    await capture(page, info, "06-new-conversation-initializes-the-visible-source-reference");
  } finally {
    await owned.close();
  }
});

test("real Buda reads a Base record sample while messages keep the original user text", async ({
  page,
  request,
}, info) => {
  const owned = ownSessions(page, request);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await connectBuda(page);
    const slug = fixtureSlug("live-context-base");
    const name = "产品候选池 · Live reference";
    const code = marker();
    const base = baseSchema.parse(
      await json(
        await request.post("/api/v1/bases", {
          data: {
            autoMerge: true,
            slug,
            name,
            fields: [
              { name: "Name", slug: "name", type: "text", required: true },
              { name: "verification_code", slug: "verification_code", type: "text" },
            ],
          },
        }),
      ),
    );
    await json(
      await request.post(`/api/v1/bases/${base.id}/change-requests`, {
        data: {
          autoMerge: true,
          fields: { name: "Harmless acceptance record", verification_code: code },
          message: "Create isolated live context acceptance record",
          submittedBy: "playwright",
        },
      }),
    );
    const detail = await openFromNode(page, `/dashboard/local/base/${base.nodeId}`);
    await expect(
      detail.getByPlaceholder("Message Buda AI Agent…").locator("xpath=ancestor::form"),
    ).toContainText(name);
    await capture(page, info, "07-base-reference-visible-in-the-composer");

    const question =
      "Do not use tools, edit files, run commands, or take external actions. Read verification_code from the supplied Base record sample and reply exactly its value, without formatting or any other text.";
    const input = await send(page, detail, question, owned.ids);
    expect(input.contextReferences).toEqual([{ nodeId: base.nodeId }]);
    expect(input.text).not.toContain(code);
    await expectExactReply(detail, code);
    const message = detail.locator(".is-user").last();
    await expect(message.getByText(question, { exact: true })).toBeVisible();
    await expect(message).not.toContainText("Target: the Busabase");
    await expect(message.getByRole("link", { name, exact: true })).toBeVisible();
    await message.locator("summary").click();
    await expect(message).toContainText("## Fields");
    await expect(message).toContainText("## Example records");
    await expect(message).toContainText("A sample of at most 20 records from the whole Base");
    await expect(message).toContainText(code);
    await capture(page, info, "08-real-model-reads-field-value-only-present-in-base-snapshot");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, info, "09-reference-card-and-real-answer-on-narrow-screen");
  } finally {
    await owned.close();
  }
});
