import { createRouterClient } from "@orpc/server";
import { beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const collectPages = async (
  client: Client,
  input: Omit<Parameters<Client["search"]>[0], "limit" | "offset">,
) => {
  const pages = [];
  for (const offset of [0, 20, 40, 60]) {
    const page = await client.search({ ...input, limit: 20, offset });
    pages.push(page);
    if (!page.hasMore) break;
  }
  return pages;
};

describe("search global pagination", () => {
  let client: Client;

  beforeAll(async () => {
    await seedScenario("search-global-pagination");
    client = createRouterClient(busabaseRouter);

    await client.fileTrees.create({
      type: "drive",
      slug: "pagination-fixtures",
      name: "Pagination fixtures",
      autoMerge: true,
      files: Array.from({ length: 25 }, (_, index) => ({
        path: `globalpage-file-${String(index).padStart(2, "0")}.md`,
        content: "file pagination fixture",
      })),
    });

    for (let index = 0; index < 25; index += 1) {
      await client.docs.create({
        autoMerge: true,
        slug: `globalpage-doc-${String(index).padStart(2, "0")}`,
        name: `Document ${index}`,
        body: `GLOBALPAGE body ${index}`,
      });
      await client.bases.create({
        autoMerge: true,
        slug: `globalpage-base-${String(index).padStart(2, "0")}`,
        name: `GLOBALPAGE Base ${index}`,
      });
    }
  }, 300_000);

  it("pages through more than 20 file-only matches without duplicates or omissions", async () => {
    const pages = await collectPages(client, {
      query: "globalpage-file",
      mode: "quick",
      sources: ["files"],
    });
    const ids = pages.flatMap((page) => page.results.map((result) => result.id));

    expect(pages.map((page) => page.results.length)).toEqual([20, 5]);
    expect(pages.map((page) => page.hasMore)).toEqual([true, false]);
    expect(new Set(ids).size).toBe(25);
  });

  it.each([
    { source: "nodes" as const, query: "GLOBALPAGE body" },
    { source: "names" as const, query: "GLOBALPAGE Base" },
  ])("pages through more than 20 $source matches", async ({ source, query }) => {
    const pages = await collectPages(client, { query, mode: "quick", sources: [source] });
    const ids = pages.flatMap((page) => page.results.map((result) => result.id));

    expect(pages.map((page) => page.results.length)).toEqual([20, 5]);
    expect(pages.map((page) => page.hasMore)).toEqual([true, false]);
    expect(new Set(ids).size).toBe(25);
  });

  it("applies offset after merging mixed sources", async () => {
    const pages = await collectPages(client, {
      query: "GLOBALPAGE",
      mode: "quick",
      sources: ["files", "names", "nodes"],
    });
    const keys = pages.flatMap((page) =>
      page.results.map((result) => `${result.kind}:${result.id}`),
    );

    expect(pages.map((page) => page.results.length)).toEqual([20, 20, 20, 15]);
    expect(pages.map((page) => page.hasMore)).toEqual([true, true, true, false]);
    expect(new Set(keys).size).toBe(75);
    expect(keys).toHaveLength(75);
  });

  it("keeps an explicitly empty source selection as a valid empty page", async () => {
    const page = await client.search({
      query: "GLOBALPAGE",
      limit: 20,
      offset: 0,
      sources: [],
    });

    expect(page.results).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});
