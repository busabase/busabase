import type { Page, TestInfo } from "@playwright/test";
import {
  AGENT_PROMPT_CLIPBOARD_MIME,
  AgentPromptEnvelopeSchema,
  joinAgentPromptSegments,
} from "busabase-contract/domains/agents/prompt-context";
import { expect, json, test, unique } from "./_fixtures";
import { AcpFixtureStateSchema } from "./fixtures/acp-fixture-protocol";

const controlUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_ACP_FIXTURE_PORT ?? "15430"}`;
const screenshot = async (page: Page, info: TestInfo, name: string) => {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
};

const connect = async (page: Page) => {
  await page.goto("/dashboard/local/agents");
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  const existing = page.getByTestId("agent-connection-card").filter({ hasText: "Buda AI Agent" });
  if (await existing.count()) {
    await existing.locator("button").first().click();
    return;
  }
  await page
    .getByRole("heading", { name: "Agents", exact: true })
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  await page
    .getByTestId("agent-catalog-card")
    .filter({ hasText: "Buda AI Agent" })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await expect(page.getByPlaceholder("Message Buda AI Agent…")).toBeVisible();
};

for (const embedded of [true, false]) {
  test(`native prompt copy and Ask Agent send complete context with embeddedContext=${embedded}`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(180_000);
    const capability = await request.post(`${controlUrl}/control/capabilities`, {
      data: { embeddedContext: embedded },
    });
    expect(capability.ok()).toBe(true);
    await page.setViewportSize({ width: 1440, height: 960 });
    const skillMarker = `SKILL_CONTEXT_${crypto.randomUUID()}`;
    const skillName = unique("Prompt handoff skill");
    const skill = embedded
      ? await json<{ node: { id: string } }>(
          await request.post("/api/v1/file-trees", {
            data: {
              type: "skill",
              autoMerge: true,
              slug: skillName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              name: skillName,
              description: "Verify explicit skill and prompt context coexist.",
              files: [{ path: "SKILL.md", content: `# Prompt handoff skill\n\n${skillMarker}` }],
            },
          }),
        )
      : null;
    await connect(page);
    const name = unique("Prompt context");
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const created = await json<{ node: { id: string } }>(
      await request.post("/api/v1/docs", {
        data: {
          autoMerge: true,
          slug,
          name,
          body: "# Acceptance notes\n\nUser-owned source content.",
        },
      }),
    );
    const marker = `PROMPT_CONTEXT_${crypto.randomUUID()}`;
    expect(
      (
        await request.put(`/api/v1/nodes/${created.node.id}/agent-prompts`, {
          data: {
            agentPrompts: [
              {
                key: "context-verification",
                intent: "read-only",
                label: "Inspect acceptance notes",
                body: `Read {target}. Return ${marker}. Do not change anything.`,
              },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto(`/dashboard/local/doc/${slug}`);
    await page.getByTestId("node-agent-prompts-button").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Inspect acceptance notes", exact: true }).click();
    await screenshot(page, info, "01-select-scenario-and-copy");
    // Observe a real native paste event, never readText() and never inject clipboard data.
    await page.evaluate(() => {
      document.addEventListener(
        "paste",
        (event) => {
          const data = (event as ClipboardEvent).clipboardData;
          (window as unknown as { nativePromptPaste: unknown }).nativePromptPaste = {
            types: Array.from(data?.types ?? []),
            text: data?.getData("text/plain"),
            metadata: data?.getData("application/x-busabase-agent-prompt+json"),
          };
        },
        { capture: true },
      );
    });
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    const externalEditor = await page.context().newPage();
    await externalEditor.setContent(
      '<label>External text editor<textarea aria-label="External text editor"></textarea></label>',
    );
    const externalField = externalEditor.getByRole("textbox", { name: "External text editor" });
    await externalField.focus();
    await externalField.press("ControlOrMeta+V");
    const externalText = await externalField.inputValue();
    expect(externalText).toContain(marker);
    await externalEditor.close();
    // Ask Agent stages the same snapshot and opens the side panel without sending.
    const requests: unknown[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/rpc/agents/sessions/prompt") && req.method() === "POST")
        requests.push(req.postDataJSON());
    });
    await dialog.getByRole("button", { name: "Ask Agent", exact: true }).click();
    const detail = page
      .getByRole("region", { name: "Side panel" })
      .getByTestId("agent-detail-view");
    const field = detail.getByPlaceholder("Message Buda AI Agent…");
    const form = field.locator("xpath=ancestor::form");
    await expect(field).toHaveValue("");
    await expect(form).toContainText("Inspect acceptance notes");
    expect(requests).toHaveLength(0);
    await screenshot(page, info, "02-ask-agent-stages-inspectable-chip");
    await form
      .getByRole("group", { name: `Inspect acceptance notes · ${name}`, exact: true })
      .getByRole("button", { name: "Don't send this as context", exact: true })
      .click();
    await field.fill("Additional user instruction.");
    await field.press("ControlOrMeta+V");
    const pasted = await page.evaluate(
      () =>
        (
          window as unknown as {
            nativePromptPaste: { types: string[]; text: string; metadata: string };
          }
        ).nativePromptPaste,
    );
    expect(externalText).toBe(pasted.text);
    if (pasted.metadata) {
      expect(pasted.types).toContain(AGENT_PROMPT_CLIPBOARD_MIME);
      const envelope = AgentPromptEnvelopeSchema.parse(JSON.parse(pasted.metadata));
      expect(joinAgentPromptSegments(envelope.segments)).toBe(pasted.text);
      await expect(form).toContainText("Inspect acceptance notes");
      await expect(field).toHaveValue("Additional user instruction.");
    } else {
      // A browser that strips custom MIME must retain the complete visible text.
      await expect(field).toHaveValue(`Additional user instruction.${pasted.text}`);
      await screenshot(page, info, "03-native-clipboard-degrades-to-full-visible-text");
      await field.fill("Additional user instruction.");
      await page.getByTestId("node-agent-prompts-button").click();
      await dialog.getByRole("button", { name: "Inspect acceptance notes", exact: true }).click();
      await dialog.getByRole("button", { name: "Ask Agent", exact: true }).click();
      await expect(form).toContainText("Inspect acceptance notes");
    }
    expect(pasted.text).toContain(marker);
    await info.attach("native-clipboard", {
      body: JSON.stringify(
        {
          browser: info.project.name,
          userAgent: await page.evaluate(() => navigator.userAgent),
          types: pasted.types,
          structured: Boolean(pasted.metadata),
          exactMatch: true,
          externalEditorExact: true,
          fullText: pasted.text,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    await form.getByRole("button", { name: /^Inspect prompt context:/ }).click();
    await expect(form.locator("textarea[readonly]")).toHaveValue(pasted.text);
    if (skill) {
      await field.fill("/");
      await form.getByRole("option", { name: new RegExp(skillName) }).click();
      await expect(form).toContainText(skillName);
      await expect(form).toContainText("Inspect acceptance notes");
      await field.fill("Additional user instruction.");
    }
    await screenshot(page, info, "03-native-paste-preserves-full-context-and-user-text");
    await form.locator('button[type="submit"]').click();
    await expect(field).toBeEnabled();
    await expect.poll(() => requests.length).toBe(1);
    const sent = requests[0] as {
      json: { text: string; resourceContext: Array<{ text: string }>; contextReferences?: unknown };
    };
    expect(sent.json.text).toBe("Additional user instruction.");
    expect(sent.json.resourceContext).toHaveLength(1);
    expect(sent.json.resourceContext[0]?.text).toBe(pasted.text);
    expect(sent.json.contextReferences).toEqual([
      { nodeId: created.node.id },
      ...(skill ? [{ nodeId: skill.node.id, kind: "invocation" }] : []),
    ]);
    await expect
      .poll(async () => {
        const state = AcpFixtureStateSchema.parse(
          await (await request.get(`${controlUrl}/control/state`)).json(),
        );
        return state.prompts.some(({ prompt }) => JSON.stringify(prompt).includes(marker));
      })
      .toBe(true);
    const state = AcpFixtureStateSchema.parse(
      await (await request.get(`${controlUrl}/control/state`)).json(),
    );
    const wire = state.prompts.findLast(({ prompt }) => JSON.stringify(prompt).includes(marker));
    expect(wire).toBeDefined();
    expect(wire?.prompt[0]).toEqual({ type: "text", text: "Additional user instruction." });
    if (skill) {
      expect(JSON.stringify(wire?.prompt.slice(2))).toContain(skillMarker);
      expect(wire?.prompt).toHaveLength(4);
    }
    const context = wire?.prompt[1];
    if (embedded) {
      expect(context?.type).toBe("resource");
      if (context?.type !== "resource" || !("text" in context.resource))
        throw new Error("Expected embedded text resource");
      expect(context.resource.text).toBe(pasted.text);
    } else {
      expect(context?.type).toBe("text");
      if (context?.type !== "text") throw new Error("Expected text fallback");
      expect(context.text).toBe(pasted.text);
      await expect(detail).toContainText("The complete prompt context was sent as text instead.");
    }
    await info.attach("acp-prompt", {
      body: JSON.stringify(wire, null, 2),
      contentType: "application/json",
    });
    const message = detail.locator(".is-user").last();
    await expect(message.getByRole("button", { name: /Inspect acceptance notes/ })).toBeVisible();
    await message.getByRole("button", { name: /Inspect acceptance notes/ }).click();
    await expect(message.locator("pre").filter({ hasText: marker })).toHaveText(pasted.text);
    await screenshot(page, info, "04-agent-receives-complete-context-and-transcript-stays-compact");
    await page.reload();
    await page.getByRole("link", { name: "Agents", exact: true }).click();
    await page
      .getByTestId("agent-connection-card")
      .filter({ hasText: "Buda AI Agent" })
      .locator("button")
      .first()
      .click();
    const replay = page.getByTestId("agent-detail-view");
    await replay
      .locator(".is-user")
      .last()
      .getByRole("button", { name: /Inspect acceptance notes/ })
      .click();
    await expect(
      replay.locator(".is-user").last().locator("pre").filter({ hasText: marker }),
    ).toHaveText(pasted.text);
    await screenshot(page, info, "05-refresh-replays-original-chip-and-complete-snapshot");
  });
}

test("corrupted native clipboard metadata falls back to complete visible text", async ({
  page,
  request,
}, info) => {
  test.setTimeout(180_000);
  await connect(page);
  const name = unique("Clipboard fallback");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const doc = await json<{ node: { id: string } }>(
    await request.post("/api/v1/docs", {
      data: { autoMerge: true, slug, name, body: "# Clipboard checks" },
    }),
  );
  expect(
    (
      await request.put(`/api/v1/nodes/${doc.node.id}/agent-prompts`, {
        data: {
          agentPrompts: [
            {
              key: "fallback",
              intent: "read-only",
              label: "Clipboard checks",
              body: "Read {target}. Preserve every character. 中文。",
            },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(`/dashboard/local/doc/${slug}`);
  for (const variant of ["unknown-version", "mismatch", "missing"] as const) {
    await page.getByTestId("node-agent-prompts-button").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Clipboard checks", exact: true }).click();
    // Alter the actual native copy event after the product's capture handler.
    await page.evaluate((variant) => {
      document.addEventListener(
        "copy",
        (event) => {
          const data = (event as ClipboardEvent).clipboardData;
          if (!data) throw new Error("No native copy data");
          (window as unknown as { fallbackPlainText: string }).fallbackPlainText =
            data.getData("text/plain");
          const mime = "application/x-busabase-agent-prompt+json";
          if (variant === "missing") data.clearData(mime);
          else {
            const payload = JSON.parse(data.getData(mime));
            if (variant === "unknown-version") payload.version = 2;
            else payload.segments[0].text += " altered";
            data.setData(mime, JSON.stringify(payload));
          }
        },
        { once: true },
      );
    }, variant);
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    const fullText = await page.evaluate(
      () => (window as unknown as { fallbackPlainText: string }).fallbackPlainText,
    );
    await dialog.getByRole("button", { name: "Ask Agent", exact: true }).click();
    const detail = page
      .getByRole("region", { name: "Side panel" })
      .getByTestId("agent-detail-view");
    const field = detail.getByPlaceholder("Message Buda AI Agent…");
    const form = field.locator("xpath=ancestor::form");
    await form
      .getByRole("group", { name: `Clipboard checks · ${name}`, exact: true })
      .getByRole("button", { name: "Don't send this as context", exact: true })
      .click();
    await field.fill("Keep this. ");
    await field.press("ControlOrMeta+V");
    await expect(field).toHaveValue(`Keep this. ${fullText}`);
    await expect(form.getByRole("button", { name: /^Inspect prompt context:/ })).toHaveCount(0);
    await screenshot(page, info, `fallback-${variant}-keeps-full-visible-prompt`);
  }
  await page.getByTestId("node-agent-prompts-button").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Clipboard checks", exact: true }).click();
  await page.evaluate(() => {
    document.execCommand = () => false;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(new DOMException("Clipboard permission denied", "NotAllowedError")),
      },
    });
  });
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(dialog).toContainText(
    "Couldn't copy automatically — select the prompt preview and copy it manually.",
  );
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain(
    "Preserve every character. 中文。",
  );
  await screenshot(page, info, "denied-copy-retains-selectable-complete-preview");
});
