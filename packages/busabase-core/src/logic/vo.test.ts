import { describe, expect, it } from "vitest";
import type { BaseFieldPO, BasePO } from "../db/schema";
import { toBaseVO } from "./vo";

const basePO = (overrides: Partial<BasePO> = {}): BasePO => ({
  id: "bse_1",
  spaceId: "spc_1",
  nodeId: "nod_1",
  slug: "customer-support-tickets",
  name: "Customer Support Tickets",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  archivedAt: null,
  deletedAt: null,
  ...overrides,
});

describe("toBaseVO", () => {
  it("carries the owning node's metadata through onto BaseVO.metadata", () => {
    const nodeMetadata = { agentPrompts: [{ key: "custom", label: "Custom", body: "{target}" }] };

    const vo = toBaseVO(basePO(), [], nodeMetadata);

    expect(vo.metadata).toBe(nodeMetadata);
  });

  it("defaults to an empty object when the caller has no node metadata to offer", () => {
    const vo = toBaseVO(basePO(), [], {});

    expect(vo.metadata).toEqual({});
  });

  it("still maps every other BaseVO field the same way it always has", () => {
    const fields: BaseFieldPO[] = [
      {
        id: "fld_2",
        spaceId: "spc_1",
        baseId: "bse_1",
        slug: "second",
        name: "Second",
        type: "text",
        required: false,
        position: 1,
        options: {},
        deletedAt: null,
      } as BaseFieldPO,
      {
        id: "fld_1",
        spaceId: "spc_1",
        baseId: "bse_1",
        slug: "first",
        name: "First",
        type: "text",
        required: false,
        position: 0,
        options: {},
        deletedAt: null,
      } as BaseFieldPO,
    ];

    const vo = toBaseVO(basePO(), fields, {});

    expect(vo.id).toBe("bse_1");
    expect(vo.nodeId).toBe("nod_1");
    expect(vo.slug).toBe("customer-support-tickets");
    expect(vo.createdAt).toBe("2026-01-01T00:00:00.000Z");
    // Sorted by position, same as before `metadata` existed.
    expect(vo.fields.map((field) => field.slug)).toEqual(["first", "second"]);
  });
});
