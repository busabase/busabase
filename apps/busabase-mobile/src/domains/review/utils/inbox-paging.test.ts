import type { ChangeRequestCountsVO, ChangeRequestVO } from "busabase-contract/types";
import { describe, expect, it, vi } from "vitest";
import {
  FIRST_INBOX_PAGE,
  fetchInboxPage,
  type InboxClient,
  type InboxPage,
  inboxBadgeCounts,
  inboxModeFilter,
  nextInboxPageParam,
} from "./inbox-paging";

/**
 * What a server that predates a route actually sends, verified against a
 * running one: an oRPC error carrying the CODE, not merely the wording.
 */
const missingRoute = () =>
  Object.assign(new Error("Not Found"), { code: "NOT_FOUND", status: 404 });

const changeRequest = (id: string, overrides: Partial<ChangeRequestVO> = {}): ChangeRequestVO =>
  ({
    id,
    status: "in_review",
    submittedBy: "usr_kelly",
    updatedAt: "2026-09-13T00:00:00.000Z",
    ...overrides,
  }) as unknown as ChangeRequestVO;

const counts: ChangeRequestCountsVO = {
  review: 7,
  changes: 1,
  created: 3,
  approved: 2,
  merged: 40,
  rejected: 5,
};

const snapshotPage = (overrides: Partial<Omit<InboxPage & { mode: "snapshot" }, "mode">> = {}) => ({
  changeRequests: [changeRequest("cr_1")],
  counts,
  page: 1,
  totalPages: 1,
  ...overrides,
});

const stubClient = (overrides: Partial<InboxClient> = {}): InboxClient => ({
  inboxSnapshot: vi.fn(async () => snapshotPage()),
  list: vi.fn(async () => ({ changeRequests: [changeRequest("cr_legacy")], nextCursor: null })),
  ...overrides,
});

describe("inboxModeFilter", () => {
  it("delegates Mine to the server instead of guessing the acting identity", () => {
    // The bug this pins: the screen filtered locally on
    // `submittedBy ∈ {local-editor, mobile-editor}`. A cloud workspace stamps
    // real actor ids, so Mine was permanently empty — and no id available on
    // this side would have fixed it, because self-hosted `auth.verify()`
    // reports `local-user` while change requests are stamped `local-editor`.
    expect(inboxModeFilter("mine")).toEqual({ mine: true });
  });

  it("sends each tab's statuses to the server rather than narrowing one page", () => {
    expect(inboxModeFilter("review")).toEqual({ status: ["in_review", "approved"] });
    expect(inboxModeFilter("done")).toEqual({ status: ["merged", "rejected"] });
  });

  it("never asks for `mine` on a tab that is not Mine", () => {
    expect(inboxModeFilter("review").mine).toBeUndefined();
    expect(inboxModeFilter("done").mine).toBeUndefined();
  });
});

describe("fetchInboxPage", () => {
  it("carries the tab filter into the snapshot request", async () => {
    const client = stubClient();
    await fetchInboxPage(client, inboxModeFilter("mine"), FIRST_INBOX_PAGE);

    expect(client.inboxSnapshot).toHaveBeenCalledWith({ mine: true, page: 1, pageSize: 50 });
  });

  it("asks for the requested page, not always the first", async () => {
    const client = stubClient();
    await fetchInboxPage(client, inboxModeFilter("review"), { kind: "page", page: 4 });

    expect(client.inboxSnapshot).toHaveBeenCalledWith(expect.objectContaining({ page: 4 }));
  });

  it("falls back to the cursor listing on a server that has no inboxSnapshot", async () => {
    const client = stubClient({
      inboxSnapshot: vi.fn(async () => {
        throw missingRoute();
      }),
    });

    const page = await fetchInboxPage(client, inboxModeFilter("mine"), FIRST_INBOX_PAGE);

    expect(page.mode).toBe("legacy");
    // The filter still goes to the server: `mine` predates `inboxSnapshot` by
    // weeks, so an older server can answer it — and this side cannot.
    expect(client.list).toHaveBeenCalledWith({ mine: true, limit: 50 });
    expect(page.changeRequests.map((cr) => cr.id)).toEqual(["cr_legacy"]);
  });

  it("passes the cursor through on the fallback path's later pages", async () => {
    const client = stubClient();
    await fetchInboxPage(client, inboxModeFilter("review"), { kind: "cursor", cursor: "cur_2" });

    expect(client.list).toHaveBeenCalledWith(expect.objectContaining({ cursor: "cur_2" }));
    expect(client.inboxSnapshot).not.toHaveBeenCalled();
  });

  it("surfaces a real server refusal instead of retrying it on the legacy route", async () => {
    const client = stubClient({
      inboxSnapshot: vi.fn(async () => {
        throw new Error("You do not have access to this space");
      }),
    });

    await expect(
      fetchInboxPage(client, inboxModeFilter("review"), FIRST_INBOX_PAGE),
    ).rejects.toThrow("You do not have access to this space");
    expect(client.list).not.toHaveBeenCalled();
  });

  it("normalizes a legacy response with no cursor field to the end of the list", async () => {
    const client = stubClient({
      inboxSnapshot: vi.fn(async () => {
        throw missingRoute();
      }),
      list: vi.fn(async () => ({ changeRequests: [] })),
    });

    const page = await fetchInboxPage(client, inboxModeFilter("review"), FIRST_INBOX_PAGE);

    expect(nextInboxPageParam(page)).toBeUndefined();
  });
});

describe("nextInboxPageParam", () => {
  it("keeps paging while the snapshot reports more pages", () => {
    // The bug this pins: the screen fetched `limit: 100` once and showed
    // whatever came back, with no way to reach anything past it.
    expect(
      nextInboxPageParam({ mode: "snapshot", ...snapshotPage({ page: 1, totalPages: 3 }) }),
    ).toEqual({ kind: "page", page: 2 });
  });

  it("stops at the last page", () => {
    expect(
      nextInboxPageParam({ mode: "snapshot", ...snapshotPage({ page: 3, totalPages: 3 }) }),
    ).toBeUndefined();
  });

  it("follows the legacy cursor and stops when it runs out", () => {
    expect(nextInboxPageParam({ mode: "legacy", changeRequests: [], nextCursor: "cur_2" })).toEqual(
      { kind: "cursor", cursor: "cur_2" },
    );
    expect(
      nextInboxPageParam({ mode: "legacy", changeRequests: [], nextCursor: null }),
    ).toBeUndefined();
  });
});

describe("inboxBadgeCounts", () => {
  it("counts the whole space, not the rows in hand", () => {
    // One page holds a single row while the space holds far more. The old
    // screen derived its badges from the fetched array, so every badge was
    // capped at whatever one request returned.
    const pages: InboxPage[] = [
      {
        mode: "snapshot",
        ...snapshotPage({ changeRequests: [changeRequest("cr_1")], totalPages: 9 }),
      },
    ];

    expect(inboxBadgeCounts(pages)).toEqual({
      review: counts.review + counts.approved,
      mine: counts.created,
      done: counts.merged + counts.rejected,
    });
  });

  it("reports no counts at all when the server cannot count the space", () => {
    // Absent, not zero and not derived from the page: a badge computed from the
    // rows in hand reads as a total and understates it, while no badge reads
    // as "not counted".
    const pages: InboxPage[] = [
      { mode: "legacy", changeRequests: [changeRequest("cr_1")], nextCursor: null },
    ];

    expect(inboxBadgeCounts(pages)).toBeUndefined();
    expect(inboxBadgeCounts([])).toBeUndefined();
  });
});
