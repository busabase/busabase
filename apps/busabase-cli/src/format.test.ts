import { describe, expect, it } from "vitest";
import { render } from "./format";

/**
 * `render` is what the skill actually reads back — every command prints through
 * it. `--output json` must stay machine-parseable (agents pipe it), and the
 * default text/table renderers must survive the awkward shapes real API results have: empty
 * lists, primitive lists, nested objects, and rows with uneven keys.
 */

describe("render json", () => {
  it("pretty-prints so piped output stays diff-friendly and parseable", () => {
    const out = render({ id: "rec_1", tags: ["a", "b"] }, "json");
    expect(out).toBe('{\n  "id": "rec_1",\n  "tags": [\n    "a",\n    "b"\n  ]\n}');
    expect(JSON.parse(out)).toEqual({ id: "rec_1", tags: ["a", "b"] });
  });

  it("keeps an empty array as [] (not the table's placeholder)", () => {
    expect(render([], "json")).toBe("[]");
  });
});

describe("render text", () => {
  it("prints Busabase nodes as a terminal-friendly tree by default", () => {
    const out = render(
      [
        {
          id: "nod_root",
          type: "folder",
          slug: "workspace",
          name: "Workspace",
          baseId: null,
          children: [
            {
              id: "nod_blog",
              type: "base",
              slug: "blog",
              name: "Blog Posts",
              baseId: "bse_blog",
              children: [],
            },
            {
              id: "nod_docs",
              type: "doc",
              slug: "handbook",
              name: "Handbook",
              baseId: null,
              children: [],
            },
          ],
        },
      ],
      "text",
    );

    expect(out).toContain("[folder] Workspace /workspace  (folder, id=nod_root)");
    expect(out).toContain("├─ [base] Blog Posts /blog  (base base=bse_blog, id=nod_blog)");
    expect(out).toContain("└─ [doc] Handbook /handbook  (doc, id=nod_docs)");
    expect(out).not.toContain('"children"');
  });

  it("keeps flat lists readable in text mode", () => {
    const out = render(
      [
        { slug: "blog", name: "Blog", fields: [{ slug: "title" }] },
        { slug: "newsletter", name: "Newsletter", fields: [{ slug: "subject" }] },
      ],
      "text",
    );
    expect(out).toContain("slug");
    expect(out).toContain("[1 items]");
    expect(out).not.toContain('{"slug":"title"}');
  });
});

describe("render table", () => {
  it("prints a header, separator, and one aligned row per object", () => {
    const out = render(
      [
        { slug: "blog", name: "Blog" },
        { slug: "newsletter", name: "Newsletter" },
      ],
      "table",
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("slug        name");
    expect(lines[1]).toBe("----------  ----------");
    expect(lines[2]).toBe("blog        Blog");
    expect(lines[3]).toBe("newsletter  Newsletter");
  });

  it("unions columns across rows with different keys", () => {
    const out = render([{ a: "1" }, { b: "2" }], "table");
    expect(out.split("\n")[0]).toBe("a  b");
    // Missing cells render blank, not `undefined`.
    expect(out).not.toContain("undefined");
  });

  it("shows an explicit placeholder for an empty result set", () => {
    expect(render([], "table")).toBe("(no rows)");
  });

  it("renders a primitive list one item per line", () => {
    expect(render(["blog", "newsletter"], "table")).toBe("blog\nnewsletter");
  });

  it("summarizes nested object/array cells instead of dumping JSON or [object Object]", () => {
    const out = render([{ id: "r1", fields: { title: "Hi" } }], "table");
    expect(out).toContain("{title}");
    expect(out).not.toContain('{"title":"Hi"}');
    expect(out).not.toContain("[object Object]");
  });

  it("blanks null and undefined cells", () => {
    const out = render([{ id: "r1", note: null, extra: undefined }], "table");
    const rowLine = out.split("\n")[2];
    expect(rowLine).toBe("r1");
  });
});

describe("render scalars", () => {
  it("stringifies a bare value in table mode", () => {
    expect(render(42, "table")).toBe("42");
    expect(render(null, "table")).toBe("null");
  });

  it("aligns key/value pairs for a single object", () => {
    const out = render({ id: "rec_1", status: "in_review" }, "table");
    expect(out).toBe("id      rec_1\nstatus  in_review");
  });
});
