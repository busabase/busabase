import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseDemoRouter } from "../src/router-demo";

const keyOf = (
  item: Awaited<
    ReturnType<
      ReturnType<typeof createRouterClient<typeof busabaseDemoRouter>>["activity"]["listPaged"]
    >
  >["items"][number],
) => {
  if (item.kind === "change_request") return `cr:${item.changeRequest.id}`;
  if (item.kind === "operation") return `op:${item.operationId}`;
  if (item.kind === "record") return `record:${item.record.id}`;
  return `audit:${item.auditEvent.id}`;
};

describe("activity.listPaged (demo mode)", () => {
  const client = createRouterClient(busabaseDemoRouter);

  const pageAll = async (limit: number) => {
    const items: Awaited<ReturnType<typeof client.activity.listPaged>>["items"] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 100; guard++) {
      const page = await client.activity.listPaged({ cursor, limit });
      items.push(...page.items);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return items;
  };

  it("returns every seeded event exactly once across cursor pages", async () => {
    const first = await client.activity.listPaged({ limit: 5 });
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).not.toBeNull();

    const smallPages = await pageAll(7);
    const largePages = await pageAll(100);
    const smallKeys = smallPages.map(keyOf);

    expect(smallKeys.length).toBeGreaterThan(100);
    expect(smallKeys).toEqual(largePages.map(keyOf));
    expect(new Set(smallKeys).size).toBe(smallKeys.length);
  });

  it("pages a record's activity and bounds its review preview in demo mode", async () => {
    const records = await client.records.list({ limit: 100 });
    const record = records.records[0];
    expect(record).toBeDefined();
    const all = await client.activity.listForRecord({ recordId: record.id, limit: 100 });
    const collected: typeof all = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 100; guard++) {
      const page = await client.activity.listForRecordPaged({
        recordId: record.id,
        cursor,
        limit: 1,
      });
      expect(page.items.length).toBeLessThanOrEqual(1);
      collected.push(...page.items);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(collected.map(keyOf)).toEqual(all.map(keyOf));
    const history = await client.records.listChangeRequests({ recordId: record.id });
    const preview = await client.records.listChangeRequests({ recordId: record.id, limit: 1 });
    expect(preview.map((cr) => cr.id)).toEqual(history.slice(0, 1).map((cr) => cr.id));
  });
});
