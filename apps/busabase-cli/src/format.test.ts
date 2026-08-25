import { describe, expect, it } from "vitest";
import { render, slim } from "./format";

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

describe("paginated envelopes", () => {
  const page = {
    records: [
      { id: "rec_1", status: "active" },
      { id: "rec_2", status: "active" },
    ],
    nextCursor: "cur_2",
  };

  it("renders the rows as a table instead of `[2 items]`", () => {
    const out = render(page, "text");
    expect(out).toContain("rec_1");
    expect(out).toContain("rec_2");
    expect(out).not.toContain("[2 items]");
  });

  it("keeps the cursor visible so a caller knows there is more", () => {
    expect(render(page, "text")).toContain("nextCursor  cur_2");
  });

  it("names the empty case after the payload", () => {
    expect(render({ records: [], nextCursor: null }, "text")).toBe("(no records)");
  });

  it("does the same in table mode", () => {
    expect(render(page, "table")).toContain("rec_1");
  });

  it("leaves a multi-part result alone — `whoami` is a record with an array in it", () => {
    const whoami = { space: { id: "org_1" }, user: { id: "usr_1" }, spaces: [{ id: "org_1" }] };
    const out = render(whoami, "text");
    expect(out).toContain("space");
    expect(out).toContain("user");
    expect(out).toContain("[1 items]");
  });
});

describe("slim", () => {
  it("drops a hydrated parent and keeps the id that points at it", () => {
    const row = {
      id: "rec_1",
      baseId: "bse_1",
      base: { id: "bse_1", name: "Contracts", fields: [{ slug: "title" }] },
      createdBy: "usr_1",
      createdByUser: { id: "usr_1", name: "Leon" },
    };
    expect(slim(row)).toEqual({ id: "rec_1", baseId: "bse_1", createdBy: "usr_1" });
  });

  it("never drops a payload-bearing object — that is where field values live", () => {
    const row = {
      id: "rec_1",
      headCommitId: "cmt_1",
      headCommit: {
        id: "cmt_1",
        payload: { title: "Hello" },
        author: "usr_1",
        authorUser: { id: "usr_1", name: "Leon" },
      },
    };
    expect(slim(row)).toEqual({
      id: "rec_1",
      headCommitId: "cmt_1",
      // the commit survives; its own hydrated author does not
      headCommit: { id: "cmt_1", payload: { title: "Hello" }, author: "usr_1" },
    });
  });

  it("keeps a hydration whose id sibling is null, or the id would be lost with it", () => {
    const row = { id: "crq_1", baseId: null, base: { id: "bse_1", name: "Contracts" } };
    expect(slim(row)).toEqual(row);
  });

  it("leaves content that no sibling id names — a Base's fields, a node's children", () => {
    const row = { id: "bse_1", slug: "contracts", fields: [{ slug: "title" }] };
    expect(slim(row)).toEqual(row);
  });

  it("walks into arrays and envelopes", () => {
    const page = { records: [{ id: "rec_1", baseId: "bse_1", base: { id: "bse_1" } }] };
    expect(slim(page)).toEqual({ records: [{ id: "rec_1", baseId: "bse_1" }] });
  });
});
