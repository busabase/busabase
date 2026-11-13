import { DumpTableSchema } from "busabase-contract/domains/dump/types";
import type { BusabaseClient } from "busabase-sdk";
import { describe, expect, it, vi } from "vitest";
import { captureSqlSnapshot } from "./sql-snapshot.js";

const tables = [...DumpTableSchema.options];
const key = (table: string) =>
  table === "spaceInstructions" || table === "spaceWelcome" ? "spaceId" : "id";
function events(nodes: Record<string, unknown>[] = [{ id: "node-a" }]) {
  const columns = Object.fromEntries(tables.map((table) => [table, [key(table)]]));
  const counts = Object.fromEntries(
    tables.map((table) => [table, table === "nodes" ? nodes.length : 0]),
  );
  const out: Record<string, unknown>[] = [
    {
      type: "start",
      version: 1,
      spaceId: "local",
      startedAt: "2026-11-11T00:00:00.000Z",
      tables,
      columns,
    },
  ];
  for (const table of tables) {
    if (table === "nodes" && nodes.length)
      out.push({ type: "rows", table, rowsJson: JSON.stringify(nodes), count: nodes.length });
    out.push({ type: "tableEnd", table, count: counts[table] });
  }
  out.push({ type: "complete", tables: counts, attachmentDependencies: 0 });
  return out;
}
function iterator(items: unknown[]) {
  return (async function* () {
    for (const item of items) yield item;
  })();
}
function setup(method: (input: unknown) => Promise<AsyncIterable<unknown>>) {
  const seen: Record<string, unknown>[] = [];
  const reset = vi.fn(async () => {
    seen.length = 0;
  });
  const legacy = vi.fn(async () => ({ nodes: 0 }));
  const options = {
    client: { dump: { exportSnapshot: method } } as unknown as BusabaseClient,
    spaceId: "local",
    limit: 500,
    retries: 0,
    retryDelayMs: 0,
    reset,
    rows: vi.fn(async (_table: string, rows: Record<string, unknown>[]) => {
      seen.push(...rows);
    }),
    tableEnd: vi.fn(async () => {}),
    dependency: vi.fn(async () => {}),
    legacy,
    log: vi.fn(),
  };
  return { seen, options, reset, legacy };
}

describe("SQL snapshot capture protocol", () => {
  it("requires the complete ordered registry and records source counts independently", async () => {
    const { options, seen } = setup(async () => iterator(events()));
    expect(await captureSqlSnapshot(options)).toMatchObject({
      mode: "repeatable-read",
      startedAt: "2026-11-11T00:00:00.000Z",
      tables: { nodes: 1 },
    });
    expect(seen).toEqual([{ id: "node-a" }]);
    expect(options.tableEnd).toHaveBeenCalledTimes(35);
  });
  it.each([
    ["duplicate tableEnd", (all) => all.splice(3, 0, all[2])],
    ["missing complete", (all) => all.pop()],
    [
      "wrong count",
      (all) => {
        all[2] = { type: "tableEnd", table: "nodes", count: 9 };
      },
    ],
    [
      "extra column",
      (all) => {
        all[1] = {
          type: "rows",
          table: "nodes",
          rowsJson: JSON.stringify([{ id: "a", futureColumn: true }]),
          count: 1,
        };
      },
    ],
    [
      "missing column",
      (all) => {
        all[1] = { type: "rows", table: "nodes", rowsJson: "[{}]", count: 1 };
      },
    ],
    [
      "duplicate identity",
      (all) => {
        all[1] = {
          type: "rows",
          table: "nodes",
          rowsJson: JSON.stringify([{ id: "a" }, { id: "a" }]),
          count: 2,
        };
      },
    ],
    [
      "wrong space",
      (all) => {
        all[0] = { ...all[0], spaceId: "other" };
      },
    ],
    [
      "rows after complete",
      (all) => all.push({ type: "rows", table: "nodes", rowsJson: '[{"id":"z"}]', count: 1 }),
    ],
    [
      "future table",
      (all) => {
        all[0] = { ...all[0], tables: [...tables, "future"] };
      },
    ],
    [
      "unrequested dependency",
      (all) => {
        all.splice(-1, 0, {
          type: "attachmentDependency",
          dependency: {
            assetId: "a",
            attachmentId: "b",
            downloadUrl: "https://example.invalid",
            materializedAttachment: {},
          },
          foreignMetadata: true,
        });
      },
    ],
    [
      "malformed rowsJson",
      (all) => {
        all[1] = { type: "rows", table: "nodes", rowsJson: "[{", count: 1 };
      },
    ],
    [
      "non-array rowsJson",
      (all) => {
        all[1] = { type: "rows", table: "nodes", rowsJson: '{"id":"a"}', count: 1 };
      },
    ],
    [
      "rows count mismatch",
      (all) => {
        all[1] = { type: "rows", table: "nodes", rowsJson: '[{"id":"a"}]', count: 2 };
      },
    ],
    [
      "old nested rows wire",
      (all) => {
        all[1] = { type: "rows", table: "nodes", rows: [{ id: "a" }] };
      },
    ],
    ["unknown event", (all) => all.splice(1, 0, { type: "heartbeat" })],
  ] as Array<[string, (all: Record<string, unknown>[]) => unknown]>)(
    "rejects %s without legacy fallback",
    async (_name, alter) => {
      const all = events();
      alter(all);
      const { options, legacy } = setup(async () => iterator(all));
      await expect(captureSqlSnapshot(options)).rejects.toThrow();
      expect(legacy).not.toHaveBeenCalled();
    },
  );
  it("uses UTF-8 byte ordering for custom unicode identities", async () => {
    const good = setup(async () => iterator(events([{ id: "\ue000" }, { id: "\u{10000}" }])));
    await expect(captureSqlSnapshot(good.options)).resolves.toMatchObject({ tables: { nodes: 2 } });
    const bad = setup(async () => iterator(events([{ id: "\u{10000}" }, { id: "\ue000" }])));
    await expect(captureSqlSnapshot(bad.options)).rejects.toThrow(/identity/);
  });
  it("restarts every SQL table after a dropped stream and never combines attempts", async () => {
    let attempt = 0;
    const { options, seen, reset } = setup(async () => {
      attempt++;
      if (attempt === 1)
        return (async function* () {
          for (const event of events([{ id: "old" }]).slice(0, 3)) yield event;
          throw new Error("socket disconnected");
        })();
      return iterator(events([{ id: "new" }]));
    });
    options.retries = 1;
    await captureSqlSnapshot(options);
    expect(seen).toEqual([{ id: "new" }]);
    expect(reset).toHaveBeenCalledTimes(2);
  });
  it("only uses old pagination for an explicitly unsupported route before any event", async () => {
    const { options, legacy } = setup(async () => {
      throw Object.assign(new Error("Not found"), { status: 404 });
    });
    expect(await captureSqlSnapshot(options)).toMatchObject({ mode: "legacy-paginated" });
    expect(legacy).toHaveBeenCalledOnce();
    expect(options.log).toHaveBeenCalledWith(expect.stringContaining("not a consistent"));
  });
  it("does not fall back after forbidden access or a previous started stream", async () => {
    const forbidden = setup(async () => {
      throw Object.assign(new Error("Forbidden"), { status: 403 });
    });
    forbidden.options.retries = 2;
    await expect(captureSqlSnapshot(forbidden.options)).rejects.toThrow("Forbidden");
    expect(forbidden.legacy).not.toHaveBeenCalled();
    let attempt = 0;
    const started = setup(async () => {
      if (attempt++ > 0) throw Object.assign(new Error("Not found"), { status: 404 });
      return iterator(events().slice(0, 2));
    });
    started.options.retries = 1;
    await expect(captureSqlSnapshot(started.options)).rejects.toThrow("Not found");
    expect(started.legacy).not.toHaveBeenCalled();
  });
});

it.each(["a/b", "a\\b", "a\0b", ".", ".."])(
  "rejects node identity %s without rewriting it",
  async (id) => {
    const { options, legacy } = setup(async () => iterator(events([{ id }])));
    await expect(captureSqlSnapshot(options)).rejects.toThrow(/safe single segment/);
    expect(legacy).not.toHaveBeenCalled();
  },
);

it("keeps legal special keys and nested JSON scalar values opaque", async () => {
  const nodes = JSON.parse(
    '[{"id":"node-a","metadata":{"__proto__":{"kept":true},"constructor":"saved","toJSON":"literal","array":[{"__proto__":null},"[1,2]",[2,1],null]},"text":"{\\"notParsed\\":true}"}]',
  );
  const all = events(nodes);
  (all[0].columns as Record<string, string[]>).nodes = Object.keys(nodes[0]);
  const { options, seen } = setup(async () => iterator(all));
  await captureSqlSnapshot(options);
  expect(seen).toEqual(nodes);
  expect(Object.hasOwn(seen[0].metadata as object, "__proto__")).toBe(true);
});
