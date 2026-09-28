import type { RecordVO, ViewConfigVO } from "busabase-contract/types";
import { describe, expect, it, vi } from "vitest";
import {
  FIRST_RECORD_PAGE,
  fetchRecordPage,
  nextRecordPageParam,
  RECORDS_PAGE_SIZE,
  type RecordPage,
  type RecordPagingClient,
  recordCountCaption,
  recordsForDisplay,
  recordTotalFromPages,
} from "./record-pagination";

/**
 * What a server that predates a route actually sends, verified against a
 * running one: an oRPC error carrying the CODE, not merely the wording.
 */
const missingRoute = () =>
  Object.assign(new Error("Not Found"), { code: "NOT_FOUND", status: 404 });

/**
 * The real shape: a record's values live under `headCommit.payload`, and the
 * record carries its Base's field definitions — which the view matcher needs to
 * turn a stored choice id into the name a View filters by.
 */
const textStage = { slug: "stage", name: "Stage", type: "text", options: {} };
const selectStage = {
  slug: "stage",
  name: "Stage",
  type: "select",
  options: {
    choices: [
      { id: "a", name: "Open" },
      { id: "d", name: "Won" },
    ],
  },
};
const record = (id: string, stage: string, stageField: object = textStage): RecordVO =>
  ({
    id,
    baseId: "base_1",
    updatedAt: "2026-09-26T00:00:00.000Z",
    base: { id: "base_1", fields: [stageField] },
    headCommit: { payload: { stage } },
  }) as unknown as RecordVO;

const doneOnly = {
  filters: [{ fieldSlug: "stage", operator: "equals", value: "Done" }],
  sorts: [],
} as unknown as ViewConfigVO;

const stub = (overrides: Partial<RecordPagingClient> = {}): RecordPagingClient => ({
  listPage: vi.fn(async () => ({
    records: [record("r1", "Done")],
    total: 5,
    totalPages: 1,
    page: 1,
  })),
  list: vi.fn(async () => ({
    records: [record("r1", "Active"), record("r2", "Done")],
    nextCursor: null,
  })),
  ...overrides,
});

describe("fetchRecordPage", () => {
  it("asks the server to apply the saved View", async () => {
    // The bug this pins: the screen fetched an unfiltered page and narrowed it
    // here. Measured against a running server — a Base of 95 records with a
    // View matching 5 returned 50 rows for page 1, of which the client kept 0.
    // The user saw an empty screen.
    const client = stub();
    await fetchRecordPage(client, "base_1", "view_1", FIRST_RECORD_PAGE);

    expect(client.listPage).toHaveBeenCalledWith({
      baseId: "base_1",
      viewId: "view_1",
      page: 1,
      pageSize: RECORDS_PAGE_SIZE,
    });
    expect(client.list).not.toHaveBeenCalled();
  });

  it("omits viewId when no View is active rather than sending a blank one", async () => {
    const client = stub();
    await fetchRecordPage(client, "base_1", null, FIRST_RECORD_PAGE);

    expect(client.listPage).toHaveBeenCalledWith({
      baseId: "base_1",
      page: 1,
      pageSize: RECORDS_PAGE_SIZE,
    });
  });

  it("asks for the requested page, not always the first", async () => {
    const client = stub();
    await fetchRecordPage(client, "base_1", "view_1", { kind: "page", page: 3 });
    expect(client.listPage).toHaveBeenCalledWith(expect.objectContaining({ page: 3 }));
  });

  it("falls back to the cursor listing on a server without listPage", async () => {
    const client = stub({
      listPage: vi.fn(async () => {
        throw missingRoute();
      }),
    });

    const page = await fetchRecordPage(client, "base_1", "view_1", FIRST_RECORD_PAGE);

    expect(page.mode).toBe("legacy");
    expect(client.list).toHaveBeenCalledWith({ baseId: "base_1", limit: RECORDS_PAGE_SIZE });
  });

  it("surfaces a real refusal instead of quietly degrading", async () => {
    const client = stub({
      listPage: vi.fn(async () => {
        throw Object.assign(new Error("You do not have access"), {
          code: "FORBIDDEN",
          status: 403,
        });
      }),
    });

    await expect(fetchRecordPage(client, "base_1", "view_1", FIRST_RECORD_PAGE)).rejects.toThrow(
      "You do not have access",
    );
    expect(client.list).not.toHaveBeenCalled();
  });
});

describe("nextRecordPageParam", () => {
  it("keeps paging while the server reports more pages", () => {
    const page: RecordPage = { mode: "view", records: [], page: 1, totalPages: 4, total: 200 };
    expect(nextRecordPageParam(page)).toEqual({ kind: "page", page: 2 });
  });

  it("stops at the last page", () => {
    const page: RecordPage = { mode: "view", records: [], page: 4, totalPages: 4, total: 200 };
    expect(nextRecordPageParam(page)).toBeUndefined();
  });

  it("follows the legacy cursor and stops when it runs out", () => {
    expect(nextRecordPageParam({ mode: "legacy", records: [], nextCursor: "c2" })).toEqual({
      kind: "cursor",
      cursor: "c2",
    });
    expect(nextRecordPageParam({ mode: "legacy", records: [], nextCursor: null })).toBeUndefined();
  });
});

describe("recordsForDisplay", () => {
  it("does not re-filter what the server already filtered", () => {
    // Re-running the matcher over an authoritative page would at best be a
    // no-op and at worst disagree with the paging the server just computed.
    const pages: RecordPage[] = [
      {
        mode: "view",
        records: [record("r1", "Done"), record("r2", "Active")],
        page: 1,
        totalPages: 1,
        total: 2,
      },
    ];

    expect(recordsForDisplay(pages, doneOnly).map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("still narrows on the legacy path, which is all an old server can do", () => {
    const pages: RecordPage[] = [
      { mode: "legacy", records: [record("r1", "Done"), record("r2", "Active")], nextCursor: null },
    ];

    expect(recordsForDisplay(pages, doneOnly).map((r) => r.id)).toEqual(["r1"]);
  });

  it("narrows when ANY page came from the legacy path", () => {
    // A session that fell back mid-scroll must not render a mix of filtered
    // and unfiltered rows.
    const pages: RecordPage[] = [
      { mode: "view", records: [record("r1", "Done")], page: 1, totalPages: 2, total: 2 },
      { mode: "legacy", records: [record("r2", "Active")], nextCursor: null },
    ];

    expect(recordsForDisplay(pages, doneOnly).map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("recordsForDisplay on the legacy path — select fields", () => {
  // Mirrors the live data exactly: `stage` is a select, the record stores the
  // choice ID, and the View (as written by the filter editor or an agent)
  // names the choice.
  const wonDeals = {
    filters: [{ fieldSlug: "stage", operator: "equals", value: "Won" }],
    sorts: [],
  } as unknown as ViewConfigVO;

  it("matches a select value stored as a choice id against a filter naming the choice", () => {
    const shown = recordsForDisplay(
      [
        {
          mode: "legacy",
          records: [record("won", "d", selectStage), record("open", "a", selectStage)],
          nextCursor: null,
        },
      ],
      wonDeals,
    );
    // The copy this replaced compared "d" with "won" and kept nothing — every
    // select-filtered View on an old server was empty however much was loaded.
    expect(shown.map((r) => r.id)).toEqual(["won"]);
  });

  it("agrees with the server when the filter names the choice by id instead", () => {
    const byId = {
      filters: [{ fieldSlug: "stage", operator: "equals", value: "d" }],
      sorts: [],
    } as unknown as ViewConfigVO;
    const shown = recordsForDisplay(
      [
        {
          mode: "legacy",
          records: [record("won", "d", selectStage), record("open", "a", selectStage)],
          nextCursor: null,
        },
      ],
      byId,
    );
    expect(shown.map((r) => r.id)).toEqual(["won"]);
  });
});

describe("recordTotalFromPages", () => {
  it("reports what the server said the Base holds, not what is loaded", () => {
    const pages: RecordPage[] = [
      { mode: "view", records: [], page: 1, totalPages: 2, total: 95 },
      { mode: "view", records: [], page: 2, totalPages: 2, total: 95 },
    ];
    expect(recordTotalFromPages(pages)).toBe(95);
  });

  it("says nothing rather than something false on a server with no total", () => {
    // A cursor listing has no total, and inventing one from the loaded rows is
    // exactly the bug this whole change is about.
    expect(recordTotalFromPages([{ mode: "legacy", records: [], nextCursor: "c" }])).toBeNull();
  });

  it("has no total before the first page arrives", () => {
    expect(recordTotalFromPages([])).toBeNull();
  });
});

describe("recordCountCaption", () => {
  it("says how many of how many while more is still coming", () => {
    // The screen that started this: 95 records, 50 loaded. "50" alone reads as
    // the size of the table.
    expect(recordCountCaption(50, 95)).toBe("50 of 95");
  });

  it("says just the number once everything is on screen", () => {
    expect(recordCountCaption(5, 5)).toBe("5");
  });

  it("falls back to the loaded count when the server reports no total", () => {
    expect(recordCountCaption(50, null)).toBe("50");
    expect(recordCountCaption(50, undefined)).toBe("50");
  });
});
