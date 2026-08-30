import { describe, expect, it, vi } from "vitest";
import { changeRequestQueryTask } from "./change-request";
import type { BusabaseTaskClient } from "./types";

describe("changeRequestQueryTask", () => {
  it("passes affectsNodeId through, so an MCP caller can scope the check to one node", async () => {
    const list = vi.fn(async (input: unknown) => input);
    const client = { changeRequests: { list } } as unknown as BusabaseTaskClient;

    await changeRequestQueryTask.execute(client, {
      status: "in_review",
      affectsNodeId: "nod_123",
      limit: 1,
    });

    expect(list).toHaveBeenCalledWith({
      status: "in_review",
      affectsNodeId: "nod_123",
      limit: 1,
    });
  });

  it("omits affectsNodeId when it was not asked for", async () => {
    const list = vi.fn(async (input: unknown) => input);
    const client = { changeRequests: { list } } as unknown as BusabaseTaskClient;

    await changeRequestQueryTask.execute(client, { status: "in_review" });

    expect(list).toHaveBeenCalledWith({ status: "in_review" });
  });

  // The counts endpoint aggregates over the whole space, so a node filter would
  // narrow nothing while implying it had — the param is declared as unavailable
  // there and must not silently reach a different procedure.
  it("ignores affectsNodeId on the counts variant rather than mis-scoping it", async () => {
    const counts = vi.fn(async () => ({}));
    const list = vi.fn();
    const client = { changeRequests: { counts, list } } as unknown as BusabaseTaskClient;

    await changeRequestQueryTask.execute(client, {
      countsOnly: true,
      affectsNodeId: "nod_123",
    });

    expect(counts).toHaveBeenCalledWith();
    expect(list).not.toHaveBeenCalled();
  });

  it("declares affectsNodeId as a tool parameter", () => {
    expect(changeRequestQueryTask.params.map((param) => param.name)).toContain("affectsNodeId");
  });
});
