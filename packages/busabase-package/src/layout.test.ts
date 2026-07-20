import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import { type PackageFiles, readPackageTree } from "./layout-read";
import { renderPackageTree } from "./layout-write";
import type { PackageTree } from "./tree";

const text = (value: string): Buffer => Buffer.from(value, "utf8");

const toText = (files: PackageFiles): Record<string, string> =>
  Object.fromEntries([...files].map(([path, bytes]) => [path, bytes.toString("utf8")]));

/** A fixture exercising every node type, both sidecar kinds, and both option key rewrites. */
const buildFixture = (): PackageTree => ({
  manifest: {
    format: PACKAGE_FORMAT,
    name: "support-kb",
    description: "A support knowledge base template",
    version: "1.0.0",
    tags: ["support", "kb"],
  },
  nodes: [
    {
      type: "doc",
      slug: "getting-started",
      name: "Getting Started",
      description: "Read me first",
      position: 0,
      body: "# Hello\n\nSome body text.",
    },
    {
      type: "folder",
      slug: "guides",
      name: "Guides",
      description: "",
      position: 1,
      children: [
        {
          type: "doc",
          slug: "faq",
          name: "FAQ",
          description: "",
          position: 0,
          body: "Q and A.",
        },
      ],
    },
    {
      type: "base",
      slug: "vendors",
      name: "Vendors",
      description: "Who we buy from",
      position: 2,
      base: {
        name: "Vendors",
        description: "Who we buy from",
        position: 2,
        reviewPolicy: { kind: "single", requiredApprovals: 1 },
        fields: [
          { slug: "title", name: "Title", type: "text", required: true, position: 0, options: {} },
          {
            slug: "products",
            name: "Products",
            type: "relation",
            required: false,
            position: 1,
            options: { multiple: true, targetBaseSlug: "products", inverseFieldSlug: "vendor" },
          },
        ],
        views: [
          {
            slug: "all",
            name: "All",
            description: "",
            type: "table",
            config: {
              filters: [{ fieldSlug: "title", operator: "not_empty" }],
              sorts: [{ direction: "asc", fieldSlug: "title" }],
            },
          },
        ],
      },
      records: [
        { key: "rec_b", fields: { title: "Beta Supply", products: ["rec_p1"] } },
        { key: "rec_a", fields: { title: "Acme Ltd", products: [] } },
      ],
    },
    {
      type: "base",
      slug: "products",
      name: "Products",
      description: "",
      position: 3,
      base: {
        name: "Products",
        description: "",
        position: 3,
        fields: [
          { slug: "title", name: "Title", type: "text", required: true, position: 0, options: {} },
          {
            slug: "status",
            name: "Status",
            type: "select",
            required: false,
            position: 1,
            options: { choices: [{ id: "live", name: "Live", color: "green" }] },
          },
          {
            slug: "vendor",
            name: "Vendor",
            type: "relation",
            required: false,
            position: 2,
            options: { targetBaseSlug: "vendors", inverseFieldSlug: "products" },
          },
          {
            slug: "summary",
            name: "Summary",
            type: "ai_summary",
            required: false,
            position: 3,
            options: { ai: { model: "haiku", prompt: "Summarize", sourceFieldSlugs: ["title"] } },
          },
        ],
        views: [],
      },
      records: [{ key: "rec_p1", fields: { title: "Widget", status: "live", vendor: ["rec_b"] } }],
    },
    {
      type: "skill",
      slug: "pdf-summarizer",
      name: "PDF Summarizer",
      description: "Summarizes PDFs",
      position: 4,
      files: [
        { path: "SKILL.md", bytes: text("# Skill\n") },
        { path: "scripts/extract.py", bytes: text("print('hi')\n") },
      ],
    },
    {
      type: "drive",
      slug: "brand-assets",
      name: "Brand Assets",
      description: "",
      position: 5,
      files: [{ path: "logo.png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]) }],
    },
    {
      type: "file",
      slug: "quarterly-report",
      name: "Quarterly Report",
      description: "Q3 numbers",
      position: 6,
      fileName: "quarterly-report.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from([0x25, 0x50, 0x44, 0x46]),
    },
  ],
});

/**
 * The normalizations a round trip applies, both from §6.6 determinism: records are
 * written sorted by `key`, and a file-tree node's files sorted by path. They come back
 * sorted regardless of the input order.
 */
const canonicalize = (tree: PackageTree): PackageTree => ({
  ...tree,
  nodes: tree.nodes.map(function sort(node): PackageTree["nodes"][number] {
    if (node.type === "base") {
      return {
        ...node,
        records: [...node.records].sort((a, b) => a.key.localeCompare(b.key, "en")),
      };
    }
    if (node.type === "folder") return { ...node, children: node.children.map(sort) };
    if (node.type === "skill" || node.type === "drive" || node.type === "airapp") {
      return { ...node, files: [...node.files].sort((a, b) => a.path.localeCompare(b.path, "en")) };
    }
    return node;
  }),
});

describe("layout round trip", () => {
  it("write → read reproduces the tree", () => {
    const original = buildFixture();
    const files = renderPackageTree(original);
    const reread = readPackageTree(files);
    expect(reread).toEqual(canonicalize(original));
  });

  it("write → read → write is byte-identical", () => {
    const files = renderPackageTree(buildFixture());
    const rewritten = renderPackageTree(readPackageTree(files));
    expect(toText(rewritten)).toEqual(toText(files));
  });

  it("produces the §6.1 layout", () => {
    const files = renderPackageTree(buildFixture());
    expect([...files.keys()].sort()).toEqual([
      "busabase.json",
      "content/brand-assets/_node.json",
      "content/brand-assets/logo.png",
      "content/getting-started.md",
      "content/guides/_folder.json",
      "content/guides/faq.md",
      "content/pdf-summarizer/SKILL.md",
      "content/pdf-summarizer/_node.json",
      "content/pdf-summarizer/scripts/extract.py",
      "content/products/base.json",
      "content/products/records.ndjson",
      "content/quarterly-report.pdf",
      "content/quarterly-report.pdf.node.json",
      "content/vendors/base.json",
      "content/vendors/records.ndjson",
    ]);
  });
});

describe("determinism (§6.6)", () => {
  it("writing the same tree twice is byte-identical", () => {
    const a = renderPackageTree(buildFixture());
    const b = renderPackageTree(buildFixture());
    expect(toText(b)).toEqual(toText(a));
  });

  it("is stable against the key order of a server-provided options blob", () => {
    // Field `options` are carried verbatim from the server, whose JSONB key order is
    // not a contract — so the writer must deep-sort them or diffs would churn.
    const first = buildFixture();
    const second = buildFixture();
    const target = second.nodes[3];
    if (target.type !== "base") throw new Error("fixture changed");
    target.base.fields[3].options = {
      ai: { sourceFieldSlugs: ["title"], prompt: "Summarize", model: "haiku" },
    };
    expect(toText(renderPackageTree(second))["content/products/base.json"]).toBe(
      toText(renderPackageTree(first))["content/products/base.json"],
    );
  });

  it("sorts records by key, one per line, LF, trailing newline", () => {
    const files = renderPackageTree(buildFixture());
    const ndjson = files.get("content/vendors/records.ndjson")?.toString("utf8") ?? "";
    expect(ndjson).not.toContain("\r");
    expect(ndjson.endsWith("\n")).toBe(true);
    const keys = ndjson
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).key);
    expect(keys).toEqual(["rec_a", "rec_b"]);
  });

  it("indents JSON with 2 spaces and ends every JSON file with a newline", () => {
    const files = renderPackageTree(buildFixture());
    const manifest = files.get("busabase.json")?.toString("utf8") ?? "";
    expect(manifest).toContain('\n  "name": "support-kb"');
    expect(manifest.endsWith("}\n")).toBe(true);
  });

  it("changing one record value diffs as exactly one NDJSON line", () => {
    const before = renderPackageTree(buildFixture());
    const after = buildFixture();
    const target = after.nodes[2];
    if (target.type !== "base") throw new Error("fixture changed");
    target.records[1].fields.title = "Acme Limited";
    const rendered = renderPackageTree(after);

    const changed = [...rendered.keys()].filter(
      (path) => rendered.get(path)?.toString("utf8") !== before.get(path)?.toString("utf8"),
    );
    expect(changed).toEqual(["content/vendors/records.ndjson"]);

    const linesBefore = (before.get(changed[0]) ?? Buffer.alloc(0))
      .toString("utf8")
      .trim()
      .split("\n");
    const linesAfter = (rendered.get(changed[0]) ?? Buffer.alloc(0))
      .toString("utf8")
      .trim()
      .split("\n");
    const differing = linesAfter.filter((line, index) => line !== linesBefore[index]);
    expect(differing).toHaveLength(1);
  });
});

describe("node detection (§6.3)", () => {
  it("refuses a directory holding both _node.json and base.json rather than guessing", () => {
    // `_node.json` matches first, which makes everything below it verbatim content —
    // but `base.json` is reserved at a node's root, so this ambiguous shape is refused
    // instead of silently dropping the base.
    const files: PackageFiles = new Map([
      ["busabase.json", text(JSON.stringify({ format: PACKAGE_FORMAT, name: "p" }))],
      ["content/thing/_node.json", text(JSON.stringify({ type: "drive", name: "Thing" }))],
      ["content/thing/base.json", text(JSON.stringify({ name: "Not a base" }))],
    ]);
    expect(() => readPackageTree(files)).toThrow(/reserved file name/i);
  });

  it("treats a directory with base.json as a base", () => {
    const files: PackageFiles = new Map([
      ["busabase.json", text(JSON.stringify({ format: PACKAGE_FORMAT, name: "p" }))],
      ["content/t/base.json", text(JSON.stringify({ name: "T", fields: [], views: [] }))],
    ]);
    expect(readPackageTree(files).nodes[0].type).toBe("base");
  });

  it("treats any other directory as a folder, defaulting its name from the slug", () => {
    const files: PackageFiles = new Map([
      ["busabase.json", text(JSON.stringify({ format: PACKAGE_FORMAT, name: "p" }))],
      ["content/my-guides/faq.md", text("body")],
    ]);
    const tree = readPackageTree(files);
    expect(tree.nodes[0]).toMatchObject({ type: "folder", slug: "my-guides", name: "My Guides" });
  });

  it("does not interpret reserved names deeper inside a file-tree node", () => {
    const files: PackageFiles = new Map([
      ["busabase.json", text(JSON.stringify({ format: PACKAGE_FORMAT, name: "p" }))],
      ["content/s/_node.json", text(JSON.stringify({ type: "skill", name: "S" }))],
      ["content/s/nested/base.json", text("{}")],
    ]);
    const tree = readPackageTree(files);
    expect(tree.nodes[0]).toMatchObject({ type: "skill" });
    const node = tree.nodes[0];
    if (node.type !== "skill") throw new Error("expected a skill");
    expect(node.files.map((file) => file.path)).toEqual(["nested/base.json"]);
  });
});

describe("validation", () => {
  const withContent = (entries: Record<string, string>): PackageFiles =>
    new Map([
      ["busabase.json", text(JSON.stringify({ format: PACKAGE_FORMAT, name: "p" }))],
      ...Object.entries(entries).map(([path, value]) => [path, text(value)] as [string, Buffer]),
    ]);

  it("rejects a reserved name at a file-tree node's root", () => {
    const files = withContent({
      "content/s/_node.json": JSON.stringify({ type: "skill", name: "S" }),
      "content/s/base.json": "{}",
    });
    expect(() => readPackageTree(files)).toThrow(/reserved file name/i);
  });

  it("suggests a rename for a reserved name", () => {
    const files = withContent({
      "content/s/_node.json": JSON.stringify({ type: "skill", name: "S" }),
      "content/s/records.ndjson": "{}",
    });
    expect(() => readPackageTree(files)).toThrow(/records-file\.ndjson/);
  });

  it("rejects siblings differing only by case", () => {
    const files = withContent({ "content/Faq.md": "a", "content/faq.md": "b" });
    expect(() => readPackageTree(files)).toThrow(/differ only by case/i);
  });

  it("rejects a slug that is not installable", () => {
    const files = withContent({ "content/My Doc.md": "a" });
    expect(() => readPackageTree(files)).toThrow(/invalid slug/i);
  });

  it("suggests a valid slug when one is rejected", () => {
    const files = withContent({ "content/My Doc.md": "a" });
    expect(() => readPackageTree(files)).toThrow(/my-doc/);
  });

  it("refuses a newer format version rather than guess-importing", () => {
    const files: PackageFiles = new Map([
      ["busabase.json", text(JSON.stringify({ format: "busabase-package@2", name: "p" }))],
    ]);
    expect(() => readPackageTree(files)).toThrow(/upgrade busabase-cli/i);
  });

  it("names the exact problem when there is no manifest", () => {
    expect(() => readPackageTree(new Map([["README.md", text("hi")]]))).toThrow(
      /not a busabase package/i,
    );
  });

  it("suggests subdirectory packages when the addressed path has no manifest", () => {
    const files: PackageFiles = new Map([
      ["README.md", text("hi")],
      ["skills/pdf/busabase.json", text("{}")],
    ]);
    expect(() => readPackageTree(files)).toThrow(/tree\/<ref>\/skills\/pdf/);
  });

  it("rejects duplicate record keys", () => {
    const files = withContent({
      "content/t/base.json": JSON.stringify({ name: "T", fields: [], views: [] }),
      "content/t/records.ndjson": '{"key":"a","fields":{}}\n{"key":"a","fields":{}}\n',
    });
    expect(() => readPackageTree(files)).toThrow(/duplicate record key/i);
  });

  it("reports the offending line for malformed NDJSON", () => {
    const files = withContent({
      "content/t/base.json": JSON.stringify({ name: "T", fields: [], views: [] }),
      "content/t/records.ndjson": '{"key":"a","fields":{}}\nnot json\n',
    });
    expect(() => readPackageTree(files)).toThrow(/line 2/);
  });

  it("rejects an unclosed frontmatter block", () => {
    const files = withContent({ "content/faq.md": "---\nname: FAQ\nbody" });
    expect(() => readPackageTree(files)).toThrow(/never closes it/i);
  });
});
