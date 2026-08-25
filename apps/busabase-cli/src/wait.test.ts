import { describe, expect, it, vi } from "vitest";
import { findChangeRequestId, waitForChangeRequest } from "./wait";

describe("findChangeRequestId", () => {
  it("finds the change request when the command returns it directly", () => {
    expect(findChangeRequestId({ id: "crq_1", status: "in_review" })).toBe("crq_1");
  });

  it("finds it when the command wraps it", () => {
    expect(
      findChangeRequestId({
        materialized: false,
        changeRequest: { id: "crq_2", status: "in_review" },
      }),
    ).toBe("crq_2");
  });

  it("finds it by a plain id field", () => {
    expect(findChangeRequestId({ ok: true, changeRequestId: "crq_3" })).toBe("crq_3");
  });

  it("finds the first of a batch", () => {
    expect(findChangeRequestId({ changeRequests: [{ id: "crq_4", status: "in_review" }] })).toBe(
      "crq_4",
    );
  });

  it("does not mistake a merged result for a proposal", () => {
    // `--auto-merge` returns the materialized node, not a change request.
    expect(findChangeRequestId({ node: { id: "nod_1" }, materialized: true })).toBeUndefined();
  });

  it("does not mistake another entity's id for a change request id", () => {
    expect(findChangeRequestId({ id: "rec_1", status: "active" })).toBeUndefined();
  });
});

describe("waitForChangeRequest", () => {
  const harness = (statuses: string[]) => {
    let call = 0;
    const slept: number[] = [];
    let clock = 0;
    return {
      slept,
      read: vi.fn(async (id: string) => ({
        id,
        status: statuses[Math.min(call++, statuses.length - 1)],
      })),
      sleep: async (ms: number) => {
        slept.push(ms);
        clock += ms;
      },
      now: () => clock,
    };
  };

  it("returns as soon as the change request settles", async () => {
    const h = harness(["in_review", "in_review", "merged"]);
    const outcome = await waitForChangeRequest({
      changeRequestId: "crq_1",
      read: h.read,
      timeoutMs: 60_000,
      pollMs: 1_000,
      sleep: h.sleep,
      now: h.now,
    });
    expect(outcome).toMatchObject({ kind: "settled", status: "merged" });
    expect(h.read).toHaveBeenCalledTimes(3);
  });

  it("reports a rejection as settled, not as an error to retry", async () => {
    const h = harness(["rejected"]);
    const outcome = await waitForChangeRequest({
      changeRequestId: "crq_1",
      read: h.read,
      timeoutMs: 60_000,
      sleep: h.sleep,
      now: h.now,
    });
    expect(outcome).toMatchObject({ kind: "settled", status: "rejected" });
  });

  it("gives up on budget and says what it was still waiting on", async () => {
    const h = harness(["in_review"]);
    const outcome = await waitForChangeRequest({
      changeRequestId: "crq_1",
      read: h.read,
      timeoutMs: 5_000,
      pollMs: 2_000,
      sleep: h.sleep,
      now: h.now,
    });
    expect(outcome).toMatchObject({ kind: "timeout", status: "in_review" });
  });

  it("never sleeps past the deadline", async () => {
    const h = harness(["in_review"]);
    await waitForChangeRequest({
      changeRequestId: "crq_1",
      read: h.read,
      timeoutMs: 5_000,
      pollMs: 2_000,
      sleep: h.sleep,
      now: h.now,
    });
    expect(h.slept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(5_000);
  });
});
