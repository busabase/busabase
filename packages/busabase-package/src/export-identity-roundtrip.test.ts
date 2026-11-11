import { APP_ROOT_RESOURCE_KEY } from "busabase-contract/domains/package/template";
import { PACKAGE_FORMAT, type PackageManifest } from "busabase-contract/domains/package/types";
import { describe, expect, it, vi } from "vitest";
import type { PackageClient } from "./client";
import { assertSelfContained, collectPackageTree, type SourceNode } from "./collect";
import { readPackageTree } from "./layout-read";
import { renderPackageTree } from "./layout-write";
import { type PackageBaseNode, type PackageNode, type PackageTree, walkNodes } from "./tree";

const manifest: PackageManifest = {
  format: PACKAGE_FORMAT,
  name: "backup",
  description: "",
  tags: [],
};
const common = (slug: string, position = 0) => ({ slug, name: slug, description: "", position });
const base = (slug: string, position = 0): PackageBaseNode => ({
  ...common(slug, position),
  type: "base",
  base: { name: slug, description: "", fields: [], views: [] },
  records: [],
});

const roundtrip = (nodes: PackageNode[]) => {
  const tree: PackageTree = { manifest, nodes };
  const files = renderPackageTree(tree);
  const result = readPackageTree(files);
  expect(renderPackageTree(result)).toEqual(files);
  return { files, result };
};

describe("exported identities survive their on-disk paths", () => {
  it("separates typed sibling directories while preserving slugs, bytes and order", () => {
    const bytes = Buffer.from("# Account research\n");
    const { files, result } = roundtrip([
      base("account-research"),
      { ...common("account-research", 1), type: "skill", files: [{ path: "SKILL.md", bytes }] },
      { ...common("account-research-skill", 2), type: "folder", children: [] },
    ]);
    expect(files.has("content/account-research/base.json")).toBe(true);
    expect(files.has("content/account-research-skill-2/SKILL.md")).toBe(true);
    expect(result.nodes.map((node) => [node.type, node.slug])).toEqual([
      ["base", "account-research"],
      ["skill", "account-research"],
      ["folder", "account-research-skill"],
    ]);
  });

  it("retains different File slugs with identical, non-slug original filenames", () => {
    const first = Buffer.from([1, 2, 3]);
    const second = Buffer.from([4, 5]);
    const { files, result } = roundtrip([
      {
        ...common("crm-plan-pdf"),
        type: "file",
        fileName: "CRM 整改计划 v1.2.pdf",
        mimeType: "application/pdf",
        bytes: first,
      },
      {
        ...common("crm-plan-slide", 1),
        type: "file",
        fileName: "CRM 整改计划 v1.2.pdf",
        mimeType: "application/pdf",
        bytes: second,
      },
    ]);
    expect(files.get("content/crm-plan-pdf.pdf")).toEqual(first);
    expect(files.get("content/crm-plan-slide.pdf")).toEqual(second);
    expect(
      result.nodes.map((node) =>
        node.type === "file" ? [node.slug, node.fileName, node.mimeType, node.bytes] : null,
      ),
    ).toEqual([
      ["crm-plan-pdf", "CRM 整改计划 v1.2.pdf", "application/pdf", first],
      ["crm-plan-slide", "CRM 整改计划 v1.2.pdf", "application/pdf", second],
    ]);
  });

  it("keeps a Markdown File beside a same-slug Doc without changing either type", () => {
    const bytes = Buffer.from("---\nname: a real file, not frontmatter\n---\n");
    const { result } = roundtrip([
      { ...common("guide"), type: "doc", body: "Read the guide." },
      {
        ...common("guide", 1),
        type: "file",
        fileName: "Guide source.md",
        mimeType: "text/markdown",
        bytes,
      },
    ]);
    expect(result.nodes.map((node) => [node.type, node.slug])).toEqual([
      ["doc", "guide"],
      ["file", "guide"],
    ]);
    expect(result.nodes[1]).toMatchObject({ fileName: "Guide source.md", bytes });
  });

  it("does not reinterpret original format filenames as package metadata", () => {
    const { files, result } = roundtrip([
      {
        ...common("manuals"),
        type: "folder",
        children: [
          {
            ...common("base"),
            type: "file",
            fileName: "base.json",
            mimeType: "application/json",
            bytes: Buffer.from("not a Base schema"),
          },
          {
            ...common("records", 1),
            type: "file",
            fileName: "records.ndjson",
            mimeType: "application/x-ndjson",
            bytes: Buffer.from("not package records"),
          },
          {
            ...common("busabase", 2),
            type: "file",
            fileName: "busabase.json",
            mimeType: "application/json",
            bytes: Buffer.from("not a manifest"),
          },
        ],
      },
    ]);
    expect(files.has("content/manuals/base-file.json")).toBe(true);
    const folder = result.nodes[0];
    expect(folder.type).toBe("folder");
    expect(
      folder.type === "folder" && folder.children.map((node) => [node.type, node.slug]),
    ).toEqual([
      ["file", "base"],
      ["file", "records"],
      ["file", "busabase"],
    ]);
  });

  it("does not reinterpret an extensionless file as a same-slug directory", () => {
    const { result } = roundtrip([
      { ...common("license"), type: "folder", children: [] },
      {
        ...common("license", 1),
        type: "file",
        fileName: "LICENSE",
        mimeType: "text/plain",
        bytes: Buffer.from("Terms"),
      },
    ]);
    expect(result.nodes[1]).toMatchObject({
      type: "file",
      slug: "license",
      fileName: "LICENSE",
      mimeType: "text/plain",
    });
  });
});

const sourceBase = (id: string, slug: string, target?: string) => ({
  id,
  slug,
  name: slug,
  description: "",
  fields: [
    {
      id: `title-${id}`,
      slug: "title",
      name: "Title",
      type: "text",
      required: true,
      position: 0,
      options: {},
    },
    ...(target
      ? [
          {
            id: `related-${id}`,
            slug: "related",
            name: "Related",
            type: "relation",
            required: false,
            position: 1,
            options: { targetBaseId: target },
          },
        ]
      : []),
  ],
});

const sourceFixture = () => {
  const first = sourceBase("base-a", "first-settings", "base-b");
  const second = sourceBase("base-b", "second-settings", "base-a");
  const bases = [first, second];
  const client = {
    bases: {
      list: async () => bases,
      get: async ({ baseId }: { baseId: string }) => bases.find((base) => base.id === baseId),
      listViews: async () => [],
    },
    records: {
      list: async ({ baseId }: { baseId: string }) => ({
        records: [
          {
            id: `record-${baseId}`,
            status: "active",
            headCommit: {
              payload: {
                title: baseId,
                related: [`record-${baseId === "base-a" ? "base-b" : "base-a"}`],
              },
            },
          },
        ],
        nextCursor: null,
      }),
    },
  } as unknown as PackageClient;
  const source: SourceNode = {
    ...common("root"),
    id: "root",
    type: "folder",
    children: [first, second].map((base, i) => ({
      ...common(i === 0 ? "first-app" : "second-app", i),
      id: `app-${i}`,
      type: "folder",
      metadata: { resourceKey: APP_ROOT_RESOURCE_KEY },
      children: [
        {
          ...common(base.slug),
          id: `node-${base.id}`,
          baseId: base.id,
          type: "base",
          metadata: { resourceKey: "settings" },
        },
      ],
    })),
  };
  return { client, source };
};

describe("export scope and relation keys", () => {
  it("keeps globally unique slugs across nested templates and remaps relations to them", async () => {
    const { client, source } = sourceFixture();
    const tree = await collectPackageTree(client, source, {
      manifest,
      warn: () => {},
      baseUrl: "http://localhost",
    });
    const reread = readPackageTree(renderPackageTree(tree));
    const nodes = [...walkNodes(reread.nodes)].filter((node) => node.type === "base");
    expect(nodes.map((node) => node.slug)).toEqual(["first-settings", "second-settings"]);
    expect(nodes.map((node) => node.base.fields[1].options.targetBaseSlug)).toEqual([
      "second-settings",
      "first-settings",
    ]);
  });

  it("restores resource keys when exporting a selected installed template", async () => {
    const { client, source } = sourceFixture();
    const selected = source.children![0];
    // Make this template self-contained for the selected-subtree test.
    const ownBase = sourceBase("base-a", "first-settings");
    client.bases.get = vi.fn(async () => ownBase) as unknown as typeof client.bases.get;
    const tree = await collectPackageTree(client, selected, {
      manifest,
      warn: () => {},
      baseUrl: "http://localhost",
    });
    expect(tree.nodes[0].slug).toBe("settings");
  });

  it("rejects duplicate same-type identities before reading files", async () => {
    const read = vi.fn();
    const client = { fileTrees: { listFiles: read, readFile: read } } as unknown as PackageClient;
    const root: SourceNode = {
      ...common("root"),
      id: "root",
      type: "folder",
      children: [
        { ...common("duplicate"), id: "first", type: "drive" },
        { ...common("duplicate"), id: "second", type: "drive" },
      ],
    };
    await expect(
      collectPackageTree(client, root, { manifest, warn: () => {}, baseUrl: "http://localhost" }),
    ).rejects.toThrow("Two drive nodes");
    expect(read).not.toHaveBeenCalled();
  });

  it("drops a relation key present in another Base but absent from its declared target", () => {
    const first = base("first");
    first.records = [{ key: "wrong-base-record", fields: {} }];
    first.base.fields = [
      {
        slug: "other",
        name: "Other",
        type: "relation",
        required: true,
        position: 0,
        options: { targetBaseSlug: "second" },
      },
    ];
    first.records[0].fields.other = ["wrong-base-record"];
    const second = base("second");
    const warnings: string[] = [];
    assertSelfContained(
      { manifest, nodes: [first, second] },
      { manifest, baseUrl: "http://localhost", warn: (message) => warnings.push(message) },
    );
    expect(first.records[0].fields.other).toEqual([]);
    expect(first.base.fields[0].required).toBe(false);
    expect(warnings.some((message) => message.includes("1 relation value(s)"))).toBe(true);
  });
});
