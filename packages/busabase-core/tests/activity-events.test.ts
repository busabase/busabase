import type { ActivityItemVO, RecordVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { buildActivityEventFromItem } from "../src/domains/dashboard/helpers/activity-events";

/**
 * `buildActivityEventFromItem` renders one server-paginated activity descriptor
 * into a feed row. The audit row's href resolves through the descriptor's own
 * `record` (server-resolved) rather than a client-side records map — these tests
 * pin that resolution (correct slug, graceful fallback, CR routing).
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
    base: { slug, name: "My Base", fields: [{ slug: "name", type: "text" }] },
    headCommit: { payload: { name: `title-${id}` } },
  }) as unknown as RecordVO;

const auditItem = (
  id: string,
  recordId: string | null,
  record: RecordVO | null,
  changeRequestId: string | null = null,
): ActivityItemVO =>
  ({
    kind: "audit",
    timestamp: "2026-01-02T00:00:00.000Z",
    auditEvent: {
      id,
      action: "record.viewed",
      actorId: "user1",
      actor: null,
      baseId: "base1",
      recordId,
      changeRequestId,
      operationId: null,
      commitId: null,
      metadata: {},
      createdAt: "2026-01-02T00:00:00.000Z",
    },
    record,
  }) as unknown as ActivityItemVO;

describe("buildActivityEventFromItem", () => {
  it("resolves an audit row's href from the descriptor's record", () => {
    const event = buildActivityEventFromItem(auditItem("a1", "rec1", makeRecord("rec1", "mybase")));
    expect(event?.id).toBe("audit:a1");
    expect(event?.href).toBe("/base/mybase/rec1");
    expect(event?.tone).toBe("audit");
  });

  it("falls back to /base/unknown when the descriptor carries no record", () => {
    const event = buildActivityEventFromItem(auditItem("a2", "missing", null));
    expect(event?.href).toBe("/base/unknown/missing");
  });

  it("routes an audit row with no record to its change request", () => {
    const event = buildActivityEventFromItem(auditItem("a3", null, null, "cr9"));
    expect(event?.href).toBe("/inbox/cr9");
  });

  it("builds a record row from the descriptor's own record", () => {
    const item = {
      kind: "record",
      timestamp: "2026-01-01T00:00:00.000Z",
      record: makeRecord("rec5", "slug5"),
    } as unknown as ActivityItemVO;
    const event = buildActivityEventFromItem(item);
    expect(event?.id).toBe("record:rec5");
    expect(event?.href).toBe("/base/slug5/rec5");
    expect(event?.tone).toBe("record");
  });

  it("shows owner and channel without a credential label when no credential exists", () => {
    const item = {
      kind: "change_request",
      timestamp: "2026-01-01T00:00:00.000Z",
      changeRequest: {
        id: "cr1",
        status: "in_review",
        submittedBy: "usr_1",
        submittedByUser: { id: "usr_1", name: "Kelly", email: null, image: null, role: "owner" },
        sourceAttribution: { displayName: null, ownerName: "Kelly", channel: "web_ui" },
        sourceMeta: {},
        operations: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    } as unknown as ActivityItemVO;

    const event = buildActivityEventFromItem(item);
    expect(event?.actorName).toBe("Kelly");
    expect(event?.provenance?.byline).toBe("via Web UI");
    expect(event?.provenance?.channelLabel).toBe("Web UI");
    expect(event?.provenance?.ownerLabel).toBeUndefined();
  });

  it("uses provenance owner as the actor for user-channel writes", () => {
    const item = {
      kind: "change_request",
      timestamp: "2026-01-01T00:00:00.000Z",
      changeRequest: {
        id: "cr_owner",
        status: "in_review",
        submittedBy: "local-admin",
        submittedByUser: {
          id: "local-admin",
          name: "Local Admin",
          email: null,
          image: null,
          role: "owner",
        },
        sourceAttribution: { displayName: null, ownerName: "Kelly", channel: "cli" },
        sourceMeta: {},
        operations: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    } as unknown as ActivityItemVO;

    const event = buildActivityEventFromItem(item);
    expect(event?.actorName).toBe("Kelly");
    expect(event?.provenance?.byline).toBe("via CLI");
    expect(event?.provenance?.ownerLabel).toBeUndefined();
  });

  it("uses the owner as actor and keeps credential plus channel in a quiet byline", () => {
    const item = {
      kind: "change_request",
      timestamp: "2026-01-01T00:00:00.000Z",
      changeRequest: {
        id: "cr2",
        status: "in_review",
        submittedBy: "usr_1",
        submittedByUser: { id: "usr_1", name: "Kelly", email: null, image: null, role: "owner" },
        sourceAttribution: {
          displayName: "Writer integration",
          ownerName: "Kelly",
          channel: "sdk",
        },
        sourceMeta: {},
        operations: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    } as unknown as ActivityItemVO;

    const event = buildActivityEventFromItem(item);
    expect(event?.actorName).toBe("Kelly");
    expect(event?.provenance?.byline).toBe("via Writer integration · SDK");
    expect(event?.provenance?.channelLabel).toBe("SDK");
    expect(event?.provenance?.credentialLabel).toBe("Writer integration");
    expect(event?.provenance?.ownerLabel).toBeUndefined();
    expect(event?.provenance?.byline).not.toContain("Human");
    expect(event?.provenance?.byline).not.toContain("AI Agent");
    expect(event?.provenance?.byline).not.toContain("API Key:");
  });
});
