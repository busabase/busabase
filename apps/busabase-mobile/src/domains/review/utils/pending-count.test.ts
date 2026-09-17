import type { ChangeRequestCountsVO, ChangeRequestVO } from "busabase-contract/types";
import { describe, expect, it, vi } from "vitest";
import {
  fetchPendingCountOrNull,
  fetchPendingSnapshot,
  PENDING_PREVIEW_LIMIT,
  type PendingCountClient,
} from "./pending-count";

/**
 * What a server that predates a route actually sends, verified against a
 * running one: an oRPC error carrying the CODE, not merely the wording.
 */
const missingRoute = () =>
  Object.assign(new Error("Not Found"), { code: "NOT_FOUND", status: 404 });

const cr = (id: string, status: ChangeRequestVO["status"] = "in_review"): ChangeRequestVO =>
  ({
    id,
    status,
    submittedBy: "local-editor",
    updatedAt: "2026-09-14T00:00:00.000Z",
  }) as unknown as ChangeRequestVO;

const countsFixture: ChangeRequestCountsVO = {
  review: 116,
  changes: 0,
  created: 114,
  approved: 3,
  merged: 40,
  rejected: 5,
};

const stub = (overrides: Partial<PendingCountClient> = {}): PendingCountClient => ({
  counts: vi.fn(async () => countsFixture),
  list: vi.fn(async () => ({ changeRequests: [cr("cr_1"), cr("cr_2")] })),
  ...overrides,
});

describe("fetchPendingCountOrNull", () => {
  it("answers with the server's whole-space in_review count", async () => {
    const counts = vi.fn(async () => ({ ...countsFixture, review: 116 }));
    await expect(fetchPendingCountOrNull({ counts })).resolves.toBe(116);
  });

  it("returns null — not a guess — when the server predates the route", async () => {
    // Every caller renders this as a total: a screen badge, or the app icon
    // badge on a home screen. Null lets each decide whether to fall back or
    // show nothing; inventing a number here would put the original defect back.
    const counts = vi.fn(async () => {
      throw missingRoute();
    });
    await expect(fetchPendingCountOrNull({ counts })).resolves.toBeNull();
  });

  it("does not swallow a real refusal", async () => {
    const counts = vi.fn(async () => {
      throw Object.assign(new Error("You do not have access"), {
        code: "FORBIDDEN",
        status: 403,
      });
    });
    await expect(fetchPendingCountOrNull({ counts })).rejects.toThrow("You do not have access");
  });
});

describe("fetchPendingSnapshot", () => {
  it("counts the whole space, not the rows it fetched", async () => {
    // The bug this pins: Home fetched `limit: 100` and the sidebar fetched the
    // default 50, then each counted what came back — so the badge reported the
    // page size as the total ("100 pending" and "50" against a real 116).
    const client = stub();

    const snapshot = await fetchPendingSnapshot(client);

    expect(snapshot.count).toBe(116);
    expect(snapshot.preview).toHaveLength(2);
    expect(snapshot.capped).toBe(false);
  });

  it("only fetches enough rows to preview", async () => {
    // Asserted against a literal ceiling rather than against
    // PENDING_PREVIEW_LIMIT itself: pinning it to the constant would let the
    // constant drift back to the 100 this change exists to remove, and the
    // test would happily follow it. Home previews 4 cards; anything near 100
    // means someone reintroduced fetch-the-queue-to-count-it.
    const client = stub();
    await fetchPendingSnapshot(client);

    const [input] = vi.mocked(client.list).mock.calls[0] ?? [];
    expect(input?.limit).toBeLessThanOrEqual(25);
    expect(input?.limit).toBeGreaterThanOrEqual(4);
  });

  it("excludes approved requests, which need no decision", async () => {
    // `counts.review` must stay aligned with `selectPendingChangeRequests`:
    // an approved request is already decided and only awaits a merge, so
    // counting it would claim a decision is needed when none is.
    const client = stub({
      list: vi.fn(async () => ({
        changeRequests: [cr("cr_open"), cr("cr_done", "approved"), cr("cr_merged", "merged")],
      })),
    });

    const snapshot = await fetchPendingSnapshot(client);

    expect(snapshot.preview.map((c) => c.id)).toEqual(["cr_open"]);
  });

  it("falls back to counting the page on a server with no counts route", async () => {
    const client = stub({
      counts: vi.fn(async () => {
        throw missingRoute();
      }),
    });

    const snapshot = await fetchPendingSnapshot(client);

    expect(snapshot.count).toBe(2);
    // Short page: the count is complete even though it was computed here.
    expect(snapshot.capped).toBe(false);
  });

  it("admits the count is capped when the fallback page was full", async () => {
    // A full page means there may be more behind it, and the caller must be
    // able to decline to render a number it cannot stand behind.
    const client = stub({
      counts: vi.fn(async () => {
        throw missingRoute();
      }),
      list: vi.fn(async () => ({
        changeRequests: Array.from({ length: PENDING_PREVIEW_LIMIT }, (_, i) => cr(`cr_${i}`)),
      })),
    });

    const snapshot = await fetchPendingSnapshot(client);

    expect(snapshot.capped).toBe(true);
  });

  it("surfaces a real server refusal instead of reporting zero", async () => {
    const client = stub({
      counts: vi.fn(async () => {
        throw Object.assign(new Error("You do not have access"), {
          code: "FORBIDDEN",
          status: 403,
        });
      }),
    });

    await expect(fetchPendingSnapshot(client)).rejects.toThrow("You do not have access");
  });
});
