import type { AuditEventVO, RecordVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { buildActivityEvents } from "../src/domains/dashboard/helpers/activity-events";

/**
 * `buildActivityEvents` merges change-requests, records and audit events into one
 * time-sorted feed. An audit event that references a record resolves its link via
 * the records list — this used to be an O(audit × records) `records.find()` per
 * event and is now an O(1) Map lookup. These tests lock the resolution behaviour
 * (correct slug, graceful fallback) so the optimisation can't silently regress.
 */

const makeRecord = (id: string, slug: string): RecordVO =>
  ({
    id,
    baseId: "base1",
    headCommitId: "commit1",
    parentRecordId: null,
    parentCommitId: null,
    status: "active",
    createdBy: "user1",
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    base: {
      slug,
      name: "My Base",
      fields: [{ slug: "name", type: "text" }],
    },
    headCommit: { fields: { name: `title-${id}` } },
  }) as unknown as RecordVO;

const makeAudit = (id: string, recordId: string | null): AuditEventVO =>
  ({
    id,
    action: "record.viewed",
    actorId: "user1",
    actor: null,
    baseId: "base1",
    recordId,
    changeRequestId: null,
    operationId: null,
    commitId: null,
    metadata: {},
    createdAt: "2026-01-02T00:00:00.000Z",
  }) as unknown as AuditEventVO;

describe("buildActivityEvents — audit href record resolution", () => {
  it("resolves an audit event's record href via the records map", () => {
    const events = buildActivityEvents(
      [],
      [makeRecord("rec1", "mybase")],
      [makeAudit("a1", "rec1")],
    );
    const auditEvent = events.find((event) => event.id === "audit:a1");
    expect(auditEvent?.href).toBe("/base/mybase/rec1");
  });

  it("falls back to /base/unknown when the referenced record is absent", () => {
    const events = buildActivityEvents([], [], [makeAudit("a2", "missing")]);
    const auditEvent = events.find((event) => event.id === "audit:a2");
    expect(auditEvent?.href).toBe("/base/unknown/missing");
  });

  it("routes an audit event with no record to its change request", () => {
    const audit = { ...makeAudit("a3", null), changeRequestId: "cr9" } as AuditEventVO;
    const events = buildActivityEvents([], [], [audit]);
    const auditEvent = events.find((event) => event.id === "audit:a3");
    expect(auditEvent?.href).toBe("/inbox/cr9");
  });

  it("resolves every event to its own record's slug at scale (O(1) lookup guard)", () => {
    const records = Array.from({ length: 200 }, (_, index) =>
      makeRecord(`rec${index}`, `slug${index}`),
    );
    const audits = Array.from({ length: 200 }, (_, index) => makeAudit(`a${index}`, `rec${index}`));
    const events = buildActivityEvents([], records, audits);
    for (let index = 0; index < 200; index++) {
      const auditEvent = events.find((event) => event.id === `audit:a${index}`);
      expect(auditEvent?.href).toBe(`/base/slug${index}/rec${index}`);
    }
  });
});
