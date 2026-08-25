import { describe, expect, it, vi } from "vitest";
import { recordBulkUpdateTask } from "./record-bulk-update";
import type { BusabaseTaskClient } from "./types";

describe("recordBulkUpdateTask", () => {
  it("maps requireReview to autoMerge false and passes the batch to the Base procedure", async () => {
    const createBulkUpdateChangeRequest = vi.fn(async (input: unknown) => input);
    const client = {
      bases: { createBulkUpdateChangeRequest },
    } as unknown as BusabaseTaskClient;

    await recordBulkUpdateTask.execute(client, {
      baseId: "bas_1",
      updates: [{ recordId: "rec_1", fields: { status: "published" } }],
      message: "Publish reviewed records",
      idempotencyKey: "publish-v1",
      requireReview: true,
    });

    expect(createBulkUpdateChangeRequest).toHaveBeenCalledWith({
      baseId: "bas_1",
      updates: [{ recordId: "rec_1", fields: { status: "published" } }],
      message: "Publish reviewed records",
      idempotencyKey: "publish-v1",
      autoMerge: false,
    });
  });

  it("rejects a non-array updates value before calling the API", async () => {
    const client = {
      bases: { createBulkUpdateChangeRequest: vi.fn() },
    } as unknown as BusabaseTaskClient;
    await expect(
      recordBulkUpdateTask.execute(client, { baseId: "bas_1", updates: {} }),
    ).rejects.toThrow("must be a JSON array");
  });
});
