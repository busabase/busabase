import { describe, expect, it, vi } from "vitest";
import { paginateAll, readPage } from "./paginate";

const collect = () => {
  const lines: string[] = [];
  const notices: string[] = [];
  return {
    lines,
    notices,
    write: (line: string) => lines.push(line),
    notify: (message: string) => notices.push(message),
    rows: () => lines.map((line) => JSON.parse(line)),
  };
};

describe("readPage", () => {
  it("reads the envelope protocol", () => {
    expect(readPage({ records: [{ id: "a" }], nextCursor: "cur" }, undefined)).toEqual({
      rows: [{ id: "a" }],
      nextCursor: "cur",
    });
  });

  it("treats a null nextCursor as the end", () => {
    expect(readPage({ records: [], nextCursor: null }, undefined)?.nextCursor).toBeNull();
  });

  it("reads the bare-array protocol, paging by the last row's id while pages are full", () => {
    expect(readPage([{ id: "a" }, { id: "b" }], 2)).toEqual({
      rows: [{ id: "a" }, { id: "b" }],
      nextCursor: "b",
    });
  });

  it("stops on a short page, which is how the bare-array protocol signals the end", () => {
    expect(readPage([{ id: "a" }], 2)?.nextCursor).toBeNull();
  });

  it("never pages a bare array the caller did not bound", () => {
    expect(readPage([{ id: "a" }, { id: "b" }], undefined)?.nextCursor).toBeNull();
  });

  it("declines a shape that is not a listing at all", () => {
    expect(readPage({ space: { id: "org_1" } }, undefined)).toBeUndefined();
  });
});

describe("paginateAll", () => {
  it("follows the cursor to the end and streams one row per line", async () => {
    const out = collect();
    const pages: Record<string, unknown> = {
      first: { records: [{ id: "a" }, { id: "b" }], nextCursor: "c2" },
      c2: { records: [{ id: "c" }], nextCursor: null },
    };
    const written = await paginateAll({
      fetchPage: async (cursor) => pages[cursor ?? "first"],
      limit: 2,
      maxItems: undefined,
      write: out.write,
      notify: out.notify,
    });
    expect(written).toBe(3);
    expect(out.rows().map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(out.notices).toEqual([]);
  });

  it("announces a cap rather than returning a short answer that looks complete", async () => {
    const out = collect();
    const written = await paginateAll({
      fetchPage: async () => ({ records: [{ id: "a" }, { id: "b" }], nextCursor: "next" }),
      limit: 2,
      maxItems: 3,
      write: out.write,
      notify: out.notify,
    });
    expect(written).toBe(3);
    expect(out.notices.join()).toContain("--max-items 3 reached");
  });

  it("stops when a server repeats a cursor instead of looping forever", async () => {
    const out = collect();
    const fetchPage = vi.fn(async () => ({ records: [{ id: "a" }], nextCursor: "same" }));
    const written = await paginateAll({
      fetchPage,
      limit: 1,
      maxItems: undefined,
      write: out.write,
      notify: out.notify,
    });
    expect(written).toBe(2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(out.notices.join()).toContain("same cursor twice");
  });

  it("emits a non-paginated result once instead of pretending it paged", async () => {
    const out = collect();
    const written = await paginateAll({
      fetchPage: async () => ({ space: { id: "org_1" } }),
      limit: undefined,
      maxItems: undefined,
      write: out.write,
      notify: out.notify,
    });
    expect(written).toBe(1);
    expect(out.rows()).toEqual([{ space: { id: "org_1" } }]);
  });
});
