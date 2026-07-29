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

  it("lists and reads seeded Skill and Drive files", async () => {
    const skills = await client.fileTrees.list({ type: "skill" });
    const drives = await client.fileTrees.list({ type: "drive" });
    expect(skills[0]?.node.id).toBe("nod_skill_ai_research_editor");
    expect(drives[0]?.node.id).toBe("nod_drive_team_files");

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
    const airapps = await client.fileTrees.list({ type: "airapp" });
    expect(airapps.length).toBeGreaterThanOrEqual(5);
    expect(airapps.every((airapp) => airapp.node.type === "airapp")).toBe(true);
  });
});
