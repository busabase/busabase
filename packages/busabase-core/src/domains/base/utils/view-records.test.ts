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
    headCommit: { fields: { name, status } },
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
        fields: {
          ...item.headCommit.fields,
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
        fields: { ...item.headCommit.fields, created_by: "local-editor" },
      },
    };

    expect(
      applyViewConfigToRecords([withActor], {
        filters: [{ fieldSlug: "created_by", operator: "equals", value: "local-editor" }],
        sorts: [],
      }),
    ).toHaveLength(1);
  });
});
