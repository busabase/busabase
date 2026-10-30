import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./_fixtures";

const origin = process.env.BUDA_ACP_QA_ORIGIN ?? "http://127.0.0.1:33919";
const modelOrigin = process.env.BUNNY_ACP_QA_MODEL_ORIGIN ?? "http://127.0.0.1:33918";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

// Opt-in: real model spend and an explicitly supplied acceptance PDF are required.
test("real BudaAgent reads the uploaded PDF with a live LLM and restores its answer", async ({
  page,
}, info) => {
  const pdfPath = process.env.BUSABASE_PDF_E2E_FILE;
  test.skip(!pdfPath, "Set BUSABASE_PDF_E2E_FILE to the acceptance PDF");
  if (!pdfPath) throw new Error("Missing acceptance PDF");
  const bytes = await readFile(pdfPath);
  const health = await (await fetch(`${origin}/health`)).json();
  const relayHealth = await (await fetch(`${modelOrigin}/health`)).json();
  expect(health.isolated).toBe(true);
  expect(relayHealth.live).toBe(true);
  const firstModelRequest = relayHealth.requests;
  const before = await (await fetch(`${origin}/control/state`)).json();
  const existing = new Set(before.sessions.map((session: { id: string }) => session.id));
  const shot = async (name: string) => {
    const target = info.outputPath(`${name}.png`);
    await page.screenshot({ path: target });
    await info.attach(name, { path: target, contentType: "image/png" });
  };
  await page.goto("/dashboard/local/agents");
  const heading = page.getByRole("heading", { name: "Agents", exact: true });
  await expect(heading).toBeVisible();
  await shot("01-real-buda-entry");
  await heading
    .locator("xpath=ancestor::header")
    .getByRole("button", { name: "Add agent", exact: true })
    .click();
  await page
    .getByTestId("agent-catalog-card")
    .filter({ hasText: "Buda AI Agent" })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  const detail = page.locator('[data-testid="agent-detail-view"]:visible').last();
  const composer = detail.getByPlaceholder("Message Buda AI Agent…");
  await expect(composer).toBeEnabled();
  await detail.getByLabel("Upload files", { exact: true }).setInputFiles({
    name: path.basename(pdfPath),
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await composer.fill(
    "Read the attached PDF using read-only local tools; do not browse the web. " +
      "Extract its text if needed. In your answer give the exact document title, " +
      "the embedded font family, and every item and required quantity in the ITEM/NEEDED table. " +
      "Also summarize the conversion instructions on the first page. Cite page numbers. " +
      "Do not guess or answer from the filename: if you cannot open the PDF, say so explicitly.",
  );
  await shot("02-original-pdf-staged");
  await composer.locator("xpath=ancestor::form").locator('button[type="submit"]').click();
  await expect(detail.locator(".is-user")).toContainText(path.basename(pdfPath));
  let approvals = 0;
  await expect
    .poll(
      async () => {
        const allow = detail
          .locator('[data-testid="acp-permission"] button:enabled:visible')
          .filter({ hasText: /^Allow once$/ })
          .first();
        if (await allow.count()) {
          if (approvals === 0) await shot("03-real-file-tool-approval");
          await allow.click();
          approvals += 1;
        }
        const answer = await detail
          .locator(".is-assistant")
          .last()
          .textContent()
          .catch(() => "");
        return (
          /calibre/i.test(answer ?? "") &&
          /Ubuntu/i.test(answer ?? "") &&
          /Highlighter/i.test(answer ?? "")
        );
      },
      { timeout: 480_000, intervals: [500, 1000] },
    )
    .toBe(true);
  await expect(composer).toBeEnabled({ timeout: 60_000 });
  const answer = await detail.locator(".is-assistant").last().innerText();
  expect(answer).toMatch(/DOCX/i);
  expect(answer).toMatch(/Pens[^\n]*3/i);
  expect(answer).toMatch(/Highlighter[^\n]*2/i);
  expect(answer).toMatch(/Scissors[^\n]*1/i);
  await shot("04-live-llm-document-answer");
  const state = await (await fetch(`${origin}/control/state`)).json();
  const sourceSession = state.sessions.find((session: { id: string }) => !existing.has(session.id));
  expect(sourceSession).toBeTruthy();
  const echoedPdf = state.events.find(
    (event: {
      payload?: { update?: { content?: { type?: string; resource?: { mimeType?: string } } } };
    }) =>
      event.payload?.update?.content?.type === "resource" &&
      event.payload.update.content.resource?.mimeType === "application/pdf",
  );
  expect(echoedPdf).toBeTruthy();
  const wireContent = echoedPdf.payload.update.content;
  expect(wireContent.resource.uri).toBe(
    `attachment:///${encodeURIComponent(path.basename(pdfPath))}`,
  );
  expect(typeof wireContent.resource.blob).toBe("string");
  expect(digest(Buffer.from(wireContent.resource.blob, "base64"))).toBe(digest(bytes));
  expect(wireContent._meta?.["acp-ui.resourceContext"]).toBeUndefined();
  const stored = state.files.filter(
    (file: string) =>
      file.includes(`/${sourceSession.id}/`) && file.endsWith(`-${path.basename(pdfPath)}`),
  );
  expect(stored).toHaveLength(1);
  expect(digest(await readFile(path.join(health.workdir, stored[0])))).toBe(digest(bytes));
  const model = await (await fetch(`${modelOrigin}/requests`)).json();
  expect(model.live).toBe(true);
  const liveRequests = model.requests.slice(firstModelRequest);
  const toolResults = liveRequests.flatMap(
    (request: {
      messages?: Array<{ role: string; content: unknown }>;
      input?: Array<{ type: string; output?: unknown }>;
    }) => [
      ...(request.messages?.filter((message) => message.role === "tool") ?? []),
      ...(Array.isArray(request.input)
        ? request.input.filter((item) => item.type === "function_call_output")
        : []),
    ],
  );
  const textSeenByLlm = JSON.stringify(toolResults);
  expect(textSeenByLlm).toMatch(/calibre/i);
  expect(textSeenByLlm).toMatch(/Ubuntu/i);
  expect(textSeenByLlm).toMatch(/Highlighter/i);
  expect(
    liveRequests.every((request: { upstreamStatus: number }) => request.upstreamStatus === 200),
  ).toBe(true);
  await info.attach("live-pdf-evidence", {
    body: JSON.stringify(
      {
        pdfSha256: digest(bytes),
        pdfBytes: bytes.length,
        sourceSessionId: sourceSession.id,
        sourceFile: stored[0],
        transport: "ACP embedded resource.blob, base64; no signed URL or resourceContext",
        wireSha256: digest(Buffer.from(wireContent.resource.blob, "base64")),
        liveModelRequests: liveRequests.length,
        approvals,
        answer,
        evidence: "The actual upstream LLM received document text in real tool results.",
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await page.reload();
  await expect(
    page
      .locator('[data-testid="agent-detail-view"]:visible')
      .last()
      .locator(".is-assistant")
      .last(),
  ).toContainText("Ubuntu");
  await expect(page.getByText("Could not persist the remote agent transcript.")).toBeHidden();
  await shot("05-real-answer-restored");
});
