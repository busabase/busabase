/**
 * Every response shape a write can come back in, normalized. The shapes are the
 * contract's: `materializedRecordSchema` / `pendingChangeRequestSchema` for the
 * single-record writes, `changeRequestSchema` for the bulk ones.
 */
import { describe, expect, it, vi } from "vitest";

import {
  AIRAPP_WRITE_MESSAGES,
  airAppWriteMessage,
  isAirAppWriteQueued,
  resolveAirAppWriteLocale,
  toAirAppWriteOutcome,
} from "./airapp-write-outcome";

const operation = (overrides: Record<string, unknown>) => ({
  targetRecordId: null,
  mergedRecordId: null,
  ...overrides,
});

describe("toAirAppWriteOutcome", () => {
  it("saved: the materialized record of a single create or update", () => {
    expect(toAirAppWriteOutcome({ id: "rec_1", status: "active", materialized: true })).toEqual({
      status: "saved",
      recordId: "rec_1",
    });
  });

  it("queued: the pending ChangeRequest of a single create", () => {
    const pending = {
      id: "crq_1",
      status: "in_review",
      materialized: false,
      operations: [operation({})],
      primaryOperation: operation({}),
    };
    expect(toAirAppWriteOutcome(pending)).toEqual({ status: "queued", changeRequestId: "crq_1" });
  });

  it("queued: the pending ChangeRequest of a single update names its record", () => {
    const pending = {
      id: "crq_2",
      status: "in_review",
      materialized: false,
      operations: [operation({ targetRecordId: "rec_9" })],
      primaryOperation: operation({ targetRecordId: "rec_9" }),
    };
    expect(toAirAppWriteOutcome(pending)).toEqual({
      status: "queued",
      recordId: "rec_9",
      changeRequestId: "crq_2",
    });
  });

  it("saved: a merged bulk ChangeRequest, with every record it produced", () => {
    const merged = {
      id: "crq_3",
      status: "merged",
      operations: [operation({ mergedRecordId: "rec_a" }), operation({ mergedRecordId: "rec_b" })],
      primaryOperation: operation({ mergedRecordId: "rec_a" }),
    };
    expect(toAirAppWriteOutcome(merged)).toEqual({
      status: "saved",
      recordIds: ["rec_a", "rec_b"],
      changeRequestId: "crq_3",
    });
  });

  it("saved: a merged bulk ChangeRequest of one record also names it singly", () => {
    const merged = {
      id: "crq_4",
      status: "merged",
      operations: [operation({ mergedRecordId: "rec_a" })],
      primaryOperation: null,
    };
    expect(toAirAppWriteOutcome(merged)).toMatchObject({ recordId: "rec_a", recordIds: ["rec_a"] });
  });

  it("queued: a bulk ChangeRequest still in review (no `materialized` on that endpoint)", () => {
    const pending = {
      id: "crq_5",
      status: "in_review",
      operations: [operation({}), operation({})],
    };
    expect(toAirAppWriteOutcome(pending)).toEqual({ status: "queued", changeRequestId: "crq_5" });
  });

  it("never reports saved for a ChangeRequest that did not merge", () => {
    for (const status of ["changes_requested", "approved", "conflict", "rejected", "abandoned"]) {
      expect(toAirAppWriteOutcome({ id: "crq_6", status, operations: [] }).status).toBe("queued");
    }
  });

  it("saved: a bare record from an older server", () => {
    expect(toAirAppWriteOutcome({ id: "rec_old", status: "active" })).toEqual({
      status: "saved",
      recordId: "rec_old",
    });
  });
});

describe("isAirAppWriteQueued", () => {
  it("is the templates' predicate, verbatim", () => {
    expect(isAirAppWriteQueued({ materialized: false })).toBe(true);
    expect(isAirAppWriteQueued({ status: "in_review" })).toBe(true);
    expect(isAirAppWriteQueued({ materialized: true })).toBe(false);
    expect(isAirAppWriteQueued({ status: "merged" })).toBe(false);
    expect(isAirAppWriteQueued(undefined)).toBe(false);
  });
});

describe("airAppWriteMessage", () => {
  it("says what happened and, when queued, why and what happens next", () => {
    expect(airAppWriteMessage({ status: "saved" }, { locale: "en" })).toBe("Saved.");
    expect(airAppWriteMessage({ status: "queued" }, { locale: "en" })).toBe(
      "Sent for review. You don't have write access here, so this waits until someone who does approves it.",
    );
    expect(airAppWriteMessage({ status: "queued" }, { locale: "zh-CN" })).toBe(
      "已提交审核。你在这里没有写权限，需要有写权限的人批准后才会生效。",
    );
  });

  it("lets the app override either sentence", () => {
    expect(
      airAppWriteMessage({ status: "queued" }, { locale: "en", messages: { queued: "Waiting." } }),
    ).toBe("Waiting.");
    expect(
      airAppWriteMessage({ status: "saved" }, { locale: "en", messages: { queued: "Waiting." } }),
    ).toBe("Saved.");
  });

  it("falls back to the browser's language, then English", () => {
    vi.stubGlobal("navigator", { language: "ja-JP" });
    try {
      expect(airAppWriteMessage({ status: "saved" })).toBe(AIRAPP_WRITE_MESSAGES.ja.saved);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(airAppWriteMessage({ status: "saved" }, { locale: "de-DE" })).toBe("Saved.");
  });

  it("ships every locale with both sentences", () => {
    for (const [locale, table] of Object.entries(AIRAPP_WRITE_MESSAGES)) {
      expect(table.saved, locale).toBeTruthy();
      expect(table.queued, locale).toBeTruthy();
    }
  });
});

describe("resolveAirAppWriteLocale", () => {
  it("maps Chinese by script and region", () => {
    expect(resolveAirAppWriteLocale("zh")).toBe("zh-CN");
    expect(resolveAirAppWriteLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(resolveAirAppWriteLocale("zh-HK")).toBe("zh-TW");
    expect(resolveAirAppWriteLocale("zh-Hant")).toBe("zh-TW");
    expect(resolveAirAppWriteLocale("ja")).toBe("ja");
    expect(resolveAirAppWriteLocale("en-GB")).toBe("en");
    expect(resolveAirAppWriteLocale(undefined)).toBe("en");
  });
});
