import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "./_fixtures";

const enabled = process.env.BUSABASE_LOCAL_INSTRUCTIONS_ACCEPTANCE === "1";
const evidence = process.env.SPACE_INSTRUCTIONS_EVIDENCE_DIR;
const marker = "LOCAL-GLOBAL-20261028-A";
const body = `## 愿景 / Vision
帮助小团队把分散的信息变成清楚、可靠的工作系统。

## 使命 / Mission
让业务人员减少重复劳动，掌握自己的工作。

## 价值观 / Values
先核实事实，再提出建议。Never promise guaranteed outcomes.

## 设计风格 / Design style
Use short, friendly sentences. Welcome copy must include the exact words "clear and calm".

verification_marker: ${marker}`;

test.skip(!enabled, "Enable only against an isolated local space-instructions database");
test.setTimeout(180_000);

test("local settings preserve shared context, recover edits and copy executable reading directions", async ({
  page,
  context,
  request,
}, testInfo) => {
  if (!process.env.PG_DATABASE_URL?.startsWith("pglite:///tmp/busabase-green-local")) {
    throw new Error("This acceptance story requires its own isolated PGlite directory");
  }
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  page.setDefaultTimeout(20_000);
  await page.addInitScript(() => window.localStorage.setItem("busabaseLocale", "en"));
  const capture = async (name: string) => {
    const path = evidence ? `${evidence}/${name}.png` : testInfo.outputPath(`${name}.png`);
    if (evidence) await mkdir(evidence, { recursive: true });
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(name, { path, contentType: "image/png" });
  };
  const read = async () => {
    const response = await request.get("/api/v1/space-instructions");
    expect(response.ok(), await response.text()).toBe(true);
    return response.json() as Promise<{ spaceId: string; body: string; version: number }>;
  };
  const openSettings = async () => {
    await page.locator('[data-sidebar="menu-button"]').first().click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Instructions", exact: true }).click();
  };

  await page.goto("/dashboard/local/home");
  await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await capture("01-enter-local-workspace");
  await openSettings();
  const instructionsTab = page.getByRole("button", { name: "Instructions", exact: true });
  expect(
    await instructionsTab.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  for (const width of [800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await instructionsTab.scrollIntoViewIfNeeded();
    expect(
      await instructionsTab.evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await capture(`short-label-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const editor = page.getByLabel("Instructions (Markdown)");
  const initial = await read();
  if (initial.body) {
    await editor.fill("");
    await page.getByRole("button", { name: "Save instructions", exact: true }).click();
    await expect(page.getByText("Instructions saved", { exact: true })).toBeVisible();
  }
  await expect(editor).toHaveValue("");
  await page.getByRole("button", { name: "Insert example", exact: true }).click();
  await expect(editor).toHaveValue(
    /## Vision[\s\S]*## Mission[\s\S]*## Values[\s\S]*## Design style/,
  );
  await capture("02-optional-example");
  await editor.fill(body);
  await page.getByRole("button", { name: "Save instructions", exact: true }).click();
  await expect(page.getByText("Instructions saved", { exact: true })).toBeVisible();
  expect(await read()).toMatchObject({ spaceId: "local", body });
  await capture("03-save-team-context");

  const draft = `${body}\n\nUnfinished style detail`;
  await editor.fill(draft);
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await page.getByRole("button", { name: "Instructions", exact: true }).click();
  await expect(editor).toHaveValue(draft);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await openSettings();
  await expect(editor).toHaveValue(draft);
  await capture("04-unsaved-draft-survives-tab-and-close");

  // A real failed request must preserve editable text and leave the database unchanged.
  await page.route("**/api/rpc/spaceInstructions/update", (route) =>
    route.abort("connectionfailed"),
  );
  await page.getByRole("button", { name: "Save instructions", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save");
  await expect(editor).toHaveValue(draft);
  expect((await read()).body).toBe(body);
  await capture("05-failed-save-preserves-draft");
  await page.unroute("**/api/rpc/spaceInstructions/update");
  await page.getByRole("button", { name: "Save instructions", exact: true }).click();
  await expect(page.getByText("Instructions saved", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await openSettings();
  await expect(editor).toHaveValue(draft);

  // Exercise optimistic concurrency against the real API/database boundary.
  const beforeConflict = await read();
  await editor.fill("My local draft must remain after a conflict");
  const concurrent = await request.put("/api/v1/space-instructions", {
    data: { body: "A second editor's saved mission", expectedVersion: beforeConflict.version },
  });
  expect(concurrent.ok(), await concurrent.text()).toBe(true);
  await page.getByRole("button", { name: "Save instructions", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Someone else updated these instructions");
  await expect(editor).toHaveValue("My local draft must remain after a conflict");
  await capture("06-concurrent-edit-keeps-draft");
  await page.getByRole("button", { name: "Reload latest (replaces draft)", exact: true }).click();
  await expect(editor).toHaveValue("A second editor's saved mission");
  await page.getByRole("button", { name: "Clear text", exact: true }).click();
  await page.getByRole("button", { name: "Save instructions", exact: true }).click();
  await expect(page.getByText("Instructions saved", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await openSettings();
  await expect(editor).toHaveValue("");
  expect((await read()).body).toBe("");
  await capture("07-cleared-context-survives-refresh");

  // Leave an explicit canary for the subsequent real Agent and tunnel stories.
  await editor.fill(body);
  await page.getByRole("button", { name: "Save instructions", exact: true }).click();
  await expect(page.getByText("Instructions saved", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  const slug = `global-context-verification-${Date.now()}`;
  const created = await request.post("/api/v1/docs", {
    data: { slug, name: "Shared background verification", body: "Read-only acceptance fixture." },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const doc = await created.json();
  const custom = await request.put(`/api/v1/nodes/${doc.node.id}/agent-prompts`, {
    data: {
      agentPrompts: [
        {
          key: "welcome-from-team-background",
          label: "Welcome from team background",
          body: "For {target}: Read the current space's global instructions, then write a short welcome message for our users that follows those principles. Include the verification_marker you actually read. Do not change any workspace data.",
          intent: "read-only",
        },
      ],
    },
  });
  expect(custom.ok(), await custom.text()).toBe(true);
  await page.goto(`/dashboard/local/doc/${slug}`);
  await page.getByRole("button", { name: "Agent prompts", exact: true }).click();
  await page.getByRole("button", { name: "Welcome from team background", exact: true }).click();
  const preview = page.getByTestId("agent-prompts-preview");
  await expect(preview).toContainText("short welcome message");
  // Reading the instructions is the busabase skill's rule; the prompt does not repeat it.
  await expect(preview).not.toContainText("space_instructions_get");
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).not.toContain("space_instructions_get");
  expect(copied).not.toContain("busabase-cli space-instructions get");
  expect(copied).toContain(new URL(page.url()).origin);
  expect(copied).not.toContain(marker); // Fetch the latest body instead of copying a stale snapshot.
  await capture("08-copied-prompt-leaves-context-to-skill");
  const textPath = evidence
    ? `${evidence}/copied-prompt.txt`
    : testInfo.outputPath("copied-prompt.txt");
  await writeFile(textPath, copied);
  await testInfo.attach("exact-copied-prompt", { path: textPath, contentType: "text/plain" });
  if (evidence) {
    await writeFile(`${evidence}/saved-instructions.json`, JSON.stringify(await read(), null, 2));
    await writeFile(
      `${evidence}/fixture.json`,
      JSON.stringify({ docId: doc.node.id, slug, marker }, null, 2),
    );
  }
});
