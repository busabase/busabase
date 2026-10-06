import type { BaseVO, RecordVO, ViewConfigVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { applyViewConfigToRecords } from "./view-records";

const base: BaseVO = {
  id: "base-1",
  nodeId: "node-1",
  slug: "items",
  name: "Items",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-01-01T00:00:00.000Z",
  fields: [
    {
      id: "name",
      baseId: "base-1",
      slug: "name",
      name: "Name",
      type: "text",
      required: true,
      position: 0,
      options: {},
    },
    {
      id: "status",
      baseId: "base-1",
      slug: "status",
      name: "Status",
      type: "select",
      required: false,
      position: 1,
      options: { choices: [{ id: "needs-review", name: "Needs review" }] },
    },
  ],
};

const record = (id: string, name: string, status?: string): RecordVO =>
  ({
    id,
    baseId: base.id,
    headCommitId: `commit-${id}`,
    parentRecordId: null,
    parentCommitId: null,
    status: "active",
    createdBy: "test",
    createdByUser: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    base,
    headCommit: { payload: { name, status } },
  }) as unknown as RecordVO;

describe("applyViewConfigToRecords", () => {
  it("filters a select by its displayed label and sorts the complete result", () => {
    const records = [
      record("1", "Item 2", "needs-review"),
      record("2", "Item 10", "needs-review"),
      record("3", "Item 1", "done"),
    ];
    const config: ViewConfigVO = {
      filters: [{ fieldSlug: "status", operator: "equals", value: "needs-review" }],
      sorts: [{ fieldSlug: "name", direction: "desc" }],
    };

    expect(applyViewConfigToRecords(records, config).map((item) => item.id)).toEqual(["2", "1"]);
  });

  it("treats false, null and missing checkbox values as false", () => {
    const checkboxBase: BaseVO = {
      ...base,
      fields: [
        ...base.fields,
        {
          id: "ready",
          baseId: base.id,
          slug: "ready",
          name: "Ready",
          type: "checkbox",
          required: false,
          position: 2,
          options: {},
        },
      ],
    };
    const records = [record("1", "A"), record("2", "B"), record("3", "C")].map((item, index) => ({
      ...item,
      base: checkboxBase,
      headCommit: {
        ...item.headCommit,
        payload: {
          ...item.headCommit.payload,
          ...(index === 0 ? { ready: false } : index === 1 ? { ready: null } : {}),
        },
      },
    }));

    expect(
      applyViewConfigToRecords(records, {
        filters: [{ fieldSlug: "ready", operator: "is_false" }],
        sorts: [],
      }),
    ).toHaveLength(3);
  });

  it("uses the same human actor labels as dashboard cells", () => {
    const actorBase: BaseVO = {
      ...base,
      fields: [
        ...base.fields,
        {
          id: "created-by",
          baseId: base.id,
          slug: "created_by",
          name: "Created by",
          type: "created_by",
          required: false,
          position: 2,
          options: {},
        },
      ],
    };
    const item = record("1", "A");
    const withActor = {
      ...item,
      base: actorBase,
      headCommit: {
        ...item.headCommit,
        payload: { ...item.headCommit.payload, created_by: "local-editor" },
      },
    };

    expect(
      applyViewConfigToRecords([withActor], {
        filters: [{ fieldSlug: "created_by", operator: "equals", value: "local-editor" }],
        sorts: [],
      }),
    ).toHaveLength(1);
  });

  describe("date fields", () => {
    const dateBase = (options: BaseVO["fields"][number]["options"]): BaseVO => ({
      ...base,
      fields: [
        ...base.fields,
        {
          id: "due",
          baseId: base.id,
          slug: "due",
          name: "Due",
          type: "date",
          required: false,
          position: 2,
          options,
        },
      ],
    });
    const withDue = (id: string, due: unknown, fieldBase: BaseVO) => {
      const item = record(id, id);
      return {
        ...item,
        base: fieldBase,
        headCommit: { ...item.headCommit, payload: { ...item.headCommit.payload, due } },
      } as RecordVO;
    };

    it("sorts chronologically, not by localized text, across day and legacy forms", () => {
      const dayBase = dateBase({});
      // As M/D/YYYY text, "10/2/2026" sorts before "9/30/2026".
      const records = [
        withDue("oct", "2026-10-02", dayBase),
        withDue("sep", "2026-09-30T00:00:00.000Z", dayBase),
        withDue("jan", "2027-01-05", dayBase),
      ];
      expect(
        applyViewConfigToRecords(records, {
          filters: [],
          sorts: [{ fieldSlug: "due", direction: "asc" }],
        }).map((item) => item.id),
      ).toEqual(["sep", "oct", "jan"]);
    });

    it("equals a picked day matches the same day in any stored form", () => {
      const dayBase = dateBase({});
      const records = [
        withDue("plain", "2026-10-02", dayBase),
        withDue("legacy", "2026-10-02T00:00:00.000Z", dayBase),
        withDue("other", "2026-10-03", dayBase),
      ];
      expect(
        applyViewConfigToRecords(records, {
          filters: [{ fieldSlug: "due", operator: "equals", value: "2026-10-02" }],
          sorts: [],
        })
          .map((item) => item.id)
          .sort(),
      ).toEqual(["legacy", "plain"]);
    });

    it("equals a picked day matches a time-of-day value on that day in the field's zone", () => {
      const timeBase = dateBase({ date: { includeTime: true, timezone: "Asia/Shanghai" } });
      const records = [
        // 01:00 in Shanghai on Oct 2 is still Oct 1 in UTC — the field's zone decides.
        withDue("early", "2026-10-02T01:00:00+08:00", timeBase),
        withDue("evening", "2026-10-02T18:00:00+08:00", timeBase),
        withDue("next", "2026-10-03T09:00:00+08:00", timeBase),
      ];
      expect(
        applyViewConfigToRecords(records, {
          filters: [{ fieldSlug: "due", operator: "equals", value: "2026-10-02" }],
          sorts: [{ fieldSlug: "due", direction: "desc" }],
        }).map((item) => item.id),
      ).toEqual(["evening", "early"]);
    });
  });
});
