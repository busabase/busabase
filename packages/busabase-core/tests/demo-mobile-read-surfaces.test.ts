import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseDemoRouter } from "../src/router-demo";

describe("demo mobile read surfaces", () => {
  const client = createRouterClient(busabaseDemoRouter);

  it("paginates records and honors base scope", async () => {
    const first = await client.records.list({ baseId: "bse_local_blog", limit: 10 });
    expect(first.records).toHaveLength(10);
    expect(first.records.every((record) => record.baseId === "bse_local_blog")).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await client.records.list({
      baseId: "bse_local_blog",
      cursor: first.nextCursor ?? undefined,
      limit: 10,
    });
    expect(second.records.every((record) => record.baseId === "bse_local_blog")).toBe(true);
    expect(second.records[0]?.id).not.toBe(first.records[0]?.id);
  });

  it("supports numbered pages with saved-view filtering in demo mode", async () => {
    const page = await client.records.listPage({
      baseId: "bse_local_blog",
      viewId: "viw_seed_blog_drafts",
      page: 1,
      pageSize: 5,
    });

    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(5);
    expect(page.totalPages).toBe(Math.ceil(page.total / 5));
    const views = await client.bases.listViews({ baseId: "bse_local_blog" });
    const view = views.find((item) => item.id === "viw_seed_blog_drafts");
    const expectedStatus = view?.config.filters[0]?.value;
    const statuses = page.records.map((record) => record.headCommit.fields.status);
    expect(statuses).toEqual(statuses.filter((status) => status === expectedStatus));
  });

  it("counts records in demo mode, including viewId/filters — kept in lockstep with real mode", async () => {
    const plain = await client.records.count({ baseId: "bse_local_blog" });
    const all = await client.records.list({ baseId: "bse_local_blog", limit: 100 });
    expect(all.nextCursor).toBeNull(); // sanity: this IS the whole base, not a partial page
    expect(plain.total).toBe(all.records.length);

    const views = await client.bases.listViews({ baseId: "bse_local_blog" });
    const view = views.find((item) => item.id === "viw_seed_blog_drafts");
    const expectedStatus = view?.config.filters[0]?.value;
    const expectedCount = all.records.filter(
      (record) => record.headCommit.fields.status === expectedStatus,
    ).length;

    const viaView = await client.records.count({
      baseId: "bse_local_blog",
      viewId: "viw_seed_blog_drafts",
    });
    expect(viaView.total).toBe(expectedCount);

    const viaFilters = await client.records.count({
      baseId: "bse_local_blog",
      filters: [{ fieldSlug: "status", operator: "equals", value: expectedStatus }],
    });
    expect(viaFilters.total).toBe(expectedCount);

    await expect(
      client.records.count({ baseId: "bse_local_blog", viewId: "viw_does_not_exist" }),
    ).rejects.toThrow();
  });

  it("lists and reads seeded Skill and Drive files", async () => {
    const skills = await client.nodes.list({ types: ["skill"] });
    const drives = await client.nodes.list({ types: ["drive"] });
    expect(skills[0]?.id).toBe("nod_skill_ai_research_editor");
    expect(drives[0]?.id).toBe("nod_drive_team_files");

    const file = await client.fileTrees.readFile({
      type: "drive",
      nodeId: "nod_drive_team_files",
      filePath: "README.md",
    });
    expect(file.encoding).toBe("utf8");
    expect(file.content).toContain("# Team Files");
    expect(file.contentHash).toMatch(/^demo-/);
  });

  it("exposes seeded AirApps to mobile detail screens", async () => {
    const airapps = await client.nodes.list({ types: ["airapp"] });
    expect(airapps.length).toBeGreaterThanOrEqual(5);
    expect(airapps.every((airapp) => airapp.type === "airapp")).toBe(true);
  });

  it("keeps demo review/merge batched and preserves per-item NOT_FOUND errors", async () => {
    const review = await client.changeRequests.review({
      changeRequestIds: ["crq_seed_newsletter_approved", "crq_missing"],
      verdict: "approved",
    });
    expect(review.results[0]).toMatchObject({ ok: true, status: "approved" });
    expect(review.results[1]).toMatchObject({ ok: false, code: "NOT_FOUND" });

    const merge = await client.changeRequests.merge({
      changeRequestIds: ["crq_seed_newsletter_approved", "crq_missing"],
    });
    expect(merge.results[0]).toMatchObject({ ok: true, status: "merged" });
    expect(merge.results[1]).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
