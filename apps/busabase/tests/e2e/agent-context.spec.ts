import type { Locator, Request, TestInfo } from "@playwright/test";
import { PromptAgentSessionInputSchema } from "busabase-contract/domains/agents/types";
import { z } from "zod";
import { expect, json, test, unique } from "./_fixtures";
import { AcpFixtureStateSchema } from "./fixtures/acp-fixture-protocol";

const controlUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_ACP_FIXTURE_PORT ?? "15430"}`;
const promptEnvelopeSchema = z.object({ json: PromptAgentSessionInputSchema });
const promptInput = (request: Request) => promptEnvelopeSchema.parse(request.postDataJSON()).json;
const capture = async (page: import("@playwright/test").Page, info: TestInfo, name: string) => {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
};

const setCapability = async (value: boolean | undefined) => {
  const result = await fetch(`${controlUrl}/control/capabilities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embeddedContext: value }),
  });
  expect(result.ok).toBe(true);
};

const receivedPrompts = async () => {
  const response = await fetch(`${controlUrl}/control/state`);
  expect(response.ok).toBe(true);
  return AcpFixtureStateSchema.parse(await response.json());
};

const send = async (detail: Locator, text: string) => {
  const field = detail.getByPlaceholder("Message Buda AI Agent…");
  await field.fill(text);
  await field.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
  await expect(detail.getByTestId("agent-activity-indicator")).toBeHidden();
  await expect(field).toBeEnabled();
};

for (const embedded of [true, false, undefined]) {
  test(`page context reaches ACP with embeddedContext=${String(embedded)} and replays its snapshot`, async ({
    page,
    request,
  }, info) => {
    await setCapability(embedded);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/dashboard/local/agents");
    const agents = page.getByRole("heading", { name: "Agents", exact: true });
    await expect(agents).toBeVisible();
    await agents
      .locator("xpath=ancestor::header")
      .getByRole("button", { name: "Add agent", exact: true })
      .click();
    await page
      .getByTestId("agent-catalog-card")
      .filter({ hasText: "Buda AI Agent" })
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect(page.getByPlaceholder("Message Buda AI Agent…")).toBeVisible();

    const slug = unique("context-doc")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const name = "Launch notes";
    const marker = `CONTEXT_ONLY_${crypto.randomUUID()}`;
    const doc = await json<{ node: { id: string } }>(
      await request.post("/api/v1/docs", {
        data: {
          autoMerge: true,
          slug,
          name,
          body: `# Launch notes\n\nVerification code: ${marker}`,
        },
      }),
    );
    await page.goto(`/dashboard/local/doc/${slug}`);
    await page.getByTestId("node-agent-actions-trigger").click();
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Buda AI Agent", exact: true })
      .click();
    const detail = page
      .getByRole("region", { name: "Side panel" })
      .getByTestId("agent-detail-view");
    const field = detail.getByPlaceholder("Message Buda AI Agent…");
    const form = field.locator("xpath=ancestor::form");
    await expect(form).toContainText(name);
    await capture(page, info, "01-page-visible-as-removable-reference");

    const question = `Read the verification code in the referenced page (${String(embedded)}).`;
    const promptRequest = page.waitForRequest(
      (req) => req.url().includes("/api/rpc/agents/sessions/prompt") && req.method() === "POST",
    );
    await send(detail, question);
    const requestBody = promptInput(await promptRequest);
    expect(requestBody.text).toBe(question);
    expect(requestBody.contextReferences).toEqual([{ nodeId: doc.node.id }]);
    await expect
      .poll(async () =>
        (await receivedPrompts()).prompts.some(
          ({ prompt }) => prompt[0]?.type === "text" && prompt[0].text === question,
        ),
      )
      .toBe(true);
    const wire =
      (await receivedPrompts()).prompts.findLast(
        ({ prompt }) => prompt[0]?.type === "text" && prompt[0].text === question,
      )?.prompt ?? [];
    expect(wire[0]).toEqual({ type: "text", text: question });
    expect(JSON.stringify(wire)).toContain(marker);
    expect(wire.some((part) => part.type === "resource")).toBe(embedded === true);
    if (embedded !== true) {
      const reference = wire[1];
      if (reference?.type !== "text") throw new Error("Expected a plain-text page reference");
      expect(reference.text).toContain(marker);
    }
    const message = detail.locator(".is-user").last();
    await expect(message.getByText(question, { exact: true })).toBeVisible();
    await expect(message).not.toContainText("Target: the Busabase");
    await expect(message.getByRole("link", { name, exact: true })).toBeVisible();
    await message.locator("summary").click();
    await expect(message).toContainText(marker);
    await capture(page, info, "02-sent-reference-exposes-actual-snapshot");

    await page.reload();
    // Tabs are intentionally not persisted. Re-enter the existing conversation
    // through the Agent list; the message itself must be durable.
    await expect(page.getByRole("heading", { name, exact: true }).first()).toBeVisible();
    await page.getByRole("link", { name: "Agents", exact: true }).click();
    await page
      .getByTestId("agent-connection-card")
      .filter({ hasText: "Buda AI Agent" })
      .locator("button")
      .first()
      .click();
    const replay = page.getByTestId("agent-detail-view");
    await expect(replay.locator(".is-user").last()).toContainText(question);
    await expect(
      replay.getByPlaceholder("Message Buda AI Agent…").locator("xpath=ancestor::form"),
    ).toContainText(name);
    await replay.locator(".is-user").last().locator("summary").click();
    await expect(replay.locator(".is-user").last()).toContainText(marker);

    await replay.getByRole("button", { name: "Don't send this as context", exact: true }).click();
    const without = `A general question without a page (${String(embedded)}).`;
    const withoutRequest = page.waitForRequest(
      (req) => req.url().includes("/api/rpc/agents/sessions/prompt") && req.method() === "POST",
    );
    await send(replay, without);
    expect(promptInput(await withoutRequest).contextReferences).toBeUndefined();
    await expect
      .poll(async () =>
        (await receivedPrompts()).prompts.some(
          ({ prompt }) => prompt[0]?.type === "text" && prompt[0].text === without,
        ),
      )
      .toBe(true);
    const withoutWire = (await receivedPrompts()).prompts.findLast(
      ({ prompt }) => prompt[0]?.type === "text" && prompt[0].text === without,
    )?.prompt;
    expect(withoutWire).toEqual([{ type: "text", text: without }]);
    await expect(
      replay.locator(".is-user").last().getByRole("link", { name, exact: true }),
    ).toHaveCount(0);
    await capture(page, info, "03-removing-reference-sends-only-user-text");

    await replay.getByRole("button", { name: "Reference current page", exact: true }).click();
    const updatedMarker = `UPDATED_${crypto.randomUUID()}`;
    await json(
      await request.put(`/api/v1/nodes/${doc.node.id}/content`, {
        data: {
          autoMerge: true,
          content: { kind: "doc", body: `Updated reference: ${updatedMarker}` },
        },
      }),
    );
    await send(replay, "");
    const latestCard = replay.locator(".is-user").last();
    await expect(latestCard.getByRole("link", { name, exact: true })).toBeVisible();
    await latestCard.locator("summary").click();
    await expect(latestCard).toContainText(updatedMarker);
    await expect(latestCard).not.toContainText(marker);
    await expect(replay.locator(".is-user").first()).toContainText(marker);
    await expect(replay.locator(".is-user").first()).not.toContainText(updatedMarker);
    await capture(page, info, "04-reference-only-send-uses-fresh-content-and-keeps-history");

    await replay.getByRole("button", { name: "Don't send this as context", exact: true }).click();
    await replay.getByRole("button", { name: "Agent menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "New session", exact: true }).click();
    await expect(
      replay.getByRole("button", { name: "Don't send this as context", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await page.getByRole("link", { name: "Agents", exact: true }).click();
    await page
      .getByTestId("agent-connection-card")
      .filter({ hasText: "Buda AI Agent" })
      .locator("button")
      .first()
      .click();
    await expect(
      page
        .getByTestId("agent-detail-view")
        .getByRole("button", { name: "Don't send this as context", exact: true }),
    ).toHaveCount(0);
    await setCapability(false);
  });
}

test("failed page read retains text and file attachment until retry, including narrow layout", async ({
  page,
  request,
}, info) => {
  await setCapability(false);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard/local/agents");
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  await page
    .getByTestId("agent-catalog-card")
    .filter({ hasText: "Buda AI Agent" })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  const slug = unique("retry-context")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  await json(
    await request.post("/api/v1/docs", {
      data: { autoMerge: true, slug, name: "Retry context", body: "Readable page body" },
    }),
  );
  await page.goto(`/dashboard/local/doc/${slug}`);
  await page.getByTestId("node-agent-actions-trigger").click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Buda AI Agent", exact: true })
    .click();
  const detail = page.getByRole("region", { name: "Side panel" }).getByTestId("agent-detail-view");
  const field = detail.getByPlaceholder("Message Buda AI Agent…");
  const form = field.locator("xpath=ancestor::form");
  const chooser = page.waitForEvent("filechooser");
  await form.getByRole("button", { name: "Attach a file", exact: true }).click();
  await (await chooser).setFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Keep this file after a failed send."),
  });
  await page.route("**/api/rpc/agents/sessions/prompt", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        json: {
          defined: false,
          code: "INTERNAL_SERVER_ERROR",
          status: 500,
          message: "Could not read the referenced page. Retry or remove the reference.",
        },
      }),
    }),
  );
  await field.fill("Keep my draft until the page can be read.");
  await form.locator('button[type="submit"]').click();
  await expect(field).toHaveValue("Keep my draft until the page can be read.");
  await expect(form).toContainText("notes.txt");
  await expect(form).toContainText("Retry context");
  await expect(detail.getByRole("alert")).toBeVisible();
  await capture(page, info, "04-failed-reference-read-preserves-entire-draft");
  await page.unroute("**/api/rpc/agents/sessions/prompt");
  await form.locator('button[type="submit"]').click();
  await expect(detail.locator(".is-user").last()).toContainText(
    "Keep my draft until the page can be read.",
  );
  await expect(field).toHaveValue("");
  await expect(form).not.toContainText("notes.txt");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, info, "05-retry-succeeds-and-reference-remains-on-narrow-screen");
});

test("Base page sends a node card and actual fields without a hidden Target prefix", async ({
  page,
  request,
}, info) => {
  await setCapability(false);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard/local/agents");
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  await page
    .getByTestId("agent-catalog-card")
    .filter({ hasText: "Buda AI Agent" })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  const slug = unique("context-base")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const base = await json<{ nodeId: string; id: string }>(
    await request.post("/api/v1/bases", {
      data: { autoMerge: true, slug, name: "产品候选池" },
    }),
  );
  await page.goto(`/dashboard/local/base/${slug}`);
  await page.getByTestId("node-agent-actions-trigger").click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Buda AI Agent", exact: true })
    .click();
  const detail = page.getByRole("region", { name: "Side panel" }).getByTestId("agent-detail-view");
  const form = detail.getByPlaceholder("Message Buda AI Agent…").locator("xpath=ancestor::form");
  await expect(form).toContainText("产品候选池");
  await capture(page, info, "06-base-reference-visible-before-sending");
  const requestSent = page.waitForRequest(
    (req) => req.url().includes("/api/rpc/agents/sessions/prompt") && req.method() === "POST",
  );
  await send(detail, "hi");
  expect(promptInput(await requestSent)).toMatchObject({
    text: "hi",
    contextReferences: [{ nodeId: base.nodeId }],
  });
  const message = detail.locator(".is-user").last();
  await expect(message.getByText("hi", { exact: true })).toBeVisible();
  await expect(message.getByRole("link", { name: "产品候选池", exact: true })).toBeVisible();
  await expect(message).not.toContainText("Target: the Busabase");
  await capture(page, info, "07-base-reference-is-a-card-next-to-user-text");
  await message.locator("summary").click();
  await expect(message).toContainText(`Base ID: ${base.id}`);
  await expect(message).toContainText("## Fields");
  await expect(message).toContainText("## Example records");
  await capture(page, info, "08-base-snapshot-includes-fields-and-record-sample");
});

test("demo page references remain explicit and replay seeded content as node cards", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => window.localStorage.setItem("busabaseLocale", "en"));
  await page.goto("/dashboard/local/agents?demo=1");
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(heading).toBeVisible();
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  await page
    .getByTestId("agent-catalog-card")
    .filter({ hasText: "Demo Agent (scripted)" })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/local\/agents\/busabase-demo-agent\?demo=1$/);
  await expect(page.getByPlaceholder("Message Demo Agent (scripted)…")).toBeVisible();
  await capture(page, info, "00-demo-agent-connected-from-catalog");
  await page.goto("/dashboard/local/doc/agent-operating-guide?demo=1");
  await page.getByTestId("node-agent-actions-trigger").click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Demo Agent (scripted)", exact: true })
    .click();
  const detail = page.getByRole("region", { name: "Side panel" }).getByTestId("agent-detail-view");
  const field = detail.getByPlaceholder("Message Demo Agent (scripted)…");
  const form = field.locator("xpath=ancestor::form");
  await expect(form).toContainText("Agent Operating Guide");
  await capture(page, info, "01-demo-visible-page-reference");

  const submitted = page.waitForRequest(
    (request) =>
      request.url().includes("/api/rpc/agents/sessions/prompt") && request.method() === "POST",
  );
  await field.fill("/status");
  await form.locator('button[type="submit"]').click();
  expect(promptInput(await submitted)).toMatchObject({
    text: "/status",
    contextReferences: [{ nodeId: "nod_doc_agent_operating_guide" }],
  });
  const cards = detail.getByTestId("agent-context-resource");
  await expect(cards).toHaveCount(1);
  await cards.getByText("View sent context", { exact: true }).click();
  await expect(cards.locator("pre")).toContainText("## Page content");
  await expect(cards.locator("pre")).toContainText("no model or persistent workspace is used");
  await expect(
    cards.getByRole("link", { name: "Agent Operating Guide", exact: true }),
  ).toHaveAttribute("href", /\/doc\/nod_doc_agent_operating_guide/);
  await capture(page, info, "02-demo-sent-card-shows-seeded-snapshot");

  await expect(field).toBeEnabled();
  await form.getByRole("button", { name: "Don't send this as context", exact: true }).click();
  const withoutReference = page.waitForRequest(
    (request) =>
      request.url().includes("/api/rpc/agents/sessions/prompt") && request.method() === "POST",
  );
  await field.fill("/status");
  await form.locator('button[type="submit"]').click();
  const input = promptInput(await withoutReference);
  expect(input.text).toBe("/status");
  expect(input.contextReferences).toBeUndefined();
  await expect(field).toBeEnabled();
  await expect(detail.locator(".is-user")).toHaveCount(2);
  await expect(detail.locator(".is-user").last()).toHaveText("/status");
  await expect(detail.locator(".is-user").last().getByTestId("agent-context-resource")).toHaveCount(
    0,
  );
  await expect(cards).toHaveCount(1);
  await capture(page, info, "03-demo-removed-reference-is-not-sent");
});
