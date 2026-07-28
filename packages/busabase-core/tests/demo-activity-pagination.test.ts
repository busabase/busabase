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
});
