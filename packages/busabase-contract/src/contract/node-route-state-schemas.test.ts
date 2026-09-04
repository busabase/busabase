import { describe, expect, it } from "vitest";
import { NODE_TYPES } from "../domains/registry";
import { NodeRouteStateVOSchema } from "./node-route-state-schemas";

describe("NodeRouteStateVO", () => {
  it("accepts active, unavailable, and every registered archived node type", () => {
    expect(NodeRouteStateVOSchema.parse({ status: "active", nodeId: "nod_active" })).toEqual({
      status: "active",
      nodeId: "nod_active",
    });
    expect(NodeRouteStateVOSchema.parse({ status: "unavailable" })).toEqual({
      status: "unavailable",
    });

    for (const type of NODE_TYPES) {
      expect(
        NodeRouteStateVOSchema.parse({
          status: "archived",
          nodeId: `nod_${type}`,
          type,
          name: `${type} name`,
          slug: `${type}-slug`,
          archivedAt: "2026-09-03T00:00:00.000Z",
          canRestore: false,
        }),
      ).toMatchObject({ status: "archived", type });
    }
  });

  it("does not admit content into an archived tombstone", () => {
    const parsed = NodeRouteStateVOSchema.parse({
      status: "archived",
      nodeId: "nod_doc",
      type: "doc",
      name: "Archived doc",
      slug: "archived-doc",
      archivedAt: "2026-09-03T00:00:00.000Z",
      canRestore: true,
      body: "must not cross the route-state boundary",
    });
    expect(parsed).not.toHaveProperty("body");
  });
});
