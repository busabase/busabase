import { expect, json, test, unique } from "./_fixtures";

/**
 * A node's custom prompts are fetched when the dialog opens — they are no
 * longer carried on the node itself.
 *
 * The point of the split is what a LISTING costs: the field is capped at 50
 * prompts x 8 KiB of body per locale, and the sidebar reads every node in the
 * tree. So this asserts both halves against a real server: the listing does not
 * carry them, and the dialog still shows them.
 */

test.setTimeout(120_000);

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const PROMPTS = [
  {
    key: "e2e-weekly-summary",
    intent: "read-only",
    label: "Weekly severity summary",
    body: "Summarize tickets opened in {target} in the last 7 days, grouped by severity.",
  },
];

test("custom prompts reach the dialog without riding along on the node listing", async ({
  page,
  request,
}) => {
  const name = unique("e2e agent prompts");
  const slug = slugify(name);
  const created = await json<{ node: { id: string } }>(
    await request.post("/api/v1/docs", {
      data: { autoMerge: true, slug, name, body: "# Tickets\n\nA doc to hang prompts on.\n" },
    }),
  );
  const nodeId = created.node.id;

  const written = await request.put(`/api/v1/nodes/${nodeId}/agent-prompts`, {
    data: { agentPrompts: PROMPTS },
  });
  expect(written.ok()).toBe(true);

  // Half one: a listing does NOT carry them — the reason the column exists.
  const listed = await request.get("/api/v1/nodes");
  expect(listed.ok()).toBe(true);
  const listedBody = await listed.text();
  expect(listedBody).not.toContain("e2e-weekly-summary");
  expect(listedBody).not.toContain("Weekly severity summary");

  // Half two: asking for them directly still returns them.
  const fetched = await json<{ agentPrompts: Array<{ key: string }> | null }>(
    await request.get(`/api/v1/nodes/${nodeId}/agent-prompts`),
  );
  expect(fetched.agentPrompts?.map((prompt) => prompt.key)).toEqual(["e2e-weekly-summary"]);

  // Half three: the dialog renders what it fetched, in a real browser.
  await page.goto(`/dashboard/local/doc/${slug}`, { waitUntil: "commit" });
  await page.getByTestId("node-agent-prompts-button").click();
  await expect(page.getByText("Weekly severity summary")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/agent-prompts-dialog.png", fullPage: true });
});
