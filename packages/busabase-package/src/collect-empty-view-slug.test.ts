/**
 * Regression coverage for a real production bug: `busabase-cli export`
 * happily wrote a Base's View with an empty `slug` (`""`) into `base.json` —
 * real legacy data predating the slug requirement — and the resulting
 * package silently fails `PackageViewSchema` (`slug: z.string().min(1)`) the
 * moment anyone runs `install` on it, far away from the export that actually
 * produced the invalid file.
 */
import { PACKAGE_FORMAT, type PackageManifest } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import type { PackageClient } from "./client";
import { collectPackageTree, type SourceNode } from "./collect";

const manifest = (): PackageManifest => ({
  format: PACKAGE_FORMAT,
  name: "space",
  description: "",
  tags: [],
});

const stubClient = (
  views: Array<{ slug: string; name: string; position?: number }>,
): PackageClient =>
  ({
    bases: {
      get: async () => ({
        id: "bse-1",
        slug: "release-sources",
        name: "Release Sources",
        description: "",
        reviewPolicy: undefined,
        fields: [],
      }),
      listViews: async () =>
        views.map((v) => ({
          slug: v.slug,
          name: v.name,
          ...(v.position !== undefined ? { position: v.position } : {}),
          description: "",
          config: { filters: [], sorts: [] },
        })),
      list: async () => [{ id: "bse-1", slug: "release-sources", fields: [] }],
    },
    records: {
      list: async () => ({ records: [], nextCursor: null }),
    },
  }) as unknown as PackageClient;

const baseRoot = (): SourceNode => ({
  id: "nod-root",
  slug: "root",
  name: "Root",
  type: "folder",
  description: "",
  position: 0,
  children: [
    {
      id: "nod-base",
      slug: "release-sources",
      name: "Release Sources",
      type: "base",
      description: "",
      position: 0,
      baseId: "bse-1",
    },
  ],
});

describe("collectBase — a View with no slug (legacy data) must not break the whole export", () => {
  it("drops the slugless view and warns, keeping the properly-slugged one", async () => {
    const warnings: string[] = [];
    const tree = await collectPackageTree(
      stubClient([
        { slug: "", name: "启用中的来源" },
        { slug: "by-product", name: "按产品分组" },
      ]),
      baseRoot(),
      { manifest: manifest(), warn: (m) => warnings.push(m), baseUrl: "http://localhost" },
    );

    const base = tree.nodes.find((n) => n.type === "base");
    expect(base?.type).toBe("base");
    const views = base?.type === "base" ? base.base.views : undefined;
    expect(views).toHaveLength(1);
    expect(views?.[0]).toMatchObject({ slug: "by-product", name: "按产品分组" });
    expect(warnings.some((w) => w.includes("view(s) with no slug"))).toBe(true);
  });

  it("writes every view as-is, and warns nothing, when all of them have a slug", async () => {
    const warnings: string[] = [];
    const tree = await collectPackageTree(
      stubClient([{ slug: "by-product", name: "按产品分组" }]),
      baseRoot(),
      { manifest: manifest(), warn: (m) => warnings.push(m), baseUrl: "http://localhost" },
    );

    const base = tree.nodes.find((n) => n.type === "base");
    const views = base?.type === "base" ? base.base.views : undefined;
    expect(views).toHaveLength(1);
    expect(warnings.some((w) => w.includes("no slug"))).toBe(false);
  });
});

describe("collectBase — view order", () => {
  const exportedSlugs = async (
    views: Array<{ slug: string; name: string; position?: number }>,
  ): Promise<string[]> => {
    const tree = await collectPackageTree(stubClient(views), baseRoot(), {
      manifest: manifest(),
      warn: () => {},
      baseUrl: "http://localhost",
    });
    const base = tree.nodes.find((n) => n.type === "base");
    return base?.type === "base" ? base.base.views.map((view) => view.slug) : [];
  };

  it("exports views in the Base's shared tab order, so install recreates it", async () => {
    expect(
      await exportedSlugs([
        { slug: "grid-view", name: "Grid view", position: 1 },
        { slug: "board", name: "Board", position: 0 },
        { slug: "open", name: "Open", position: 2 },
      ]),
    ).toEqual(["board", "grid-view", "open"]);
  });

  it("keeps the server's order when it sends no positions (a server that predates them)", async () => {
    expect(
      await exportedSlugs([
        { slug: "b", name: "B" },
        { slug: "a", name: "A" },
      ]),
    ).toEqual(["b", "a"]);
  });
});
