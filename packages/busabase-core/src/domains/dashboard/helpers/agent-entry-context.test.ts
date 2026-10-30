import { describe, expect, it } from "vitest";
import { nextAgentEntryContext } from "./agent-entry-context";

const node = { id: "nod-a", type: "doc" as const, name: "Source", slug: "source" };
const initial = nextAgentEntryContext(null, {
  path: "/doc/source",
  scopeKey: "workspace:actor",
  node,
});

describe("explicit Agent entry context", () => {
  it("preserves the immediate source across Agent list, detail and new routes", () => {
    let state = initial;
    for (const path of ["/agents", "/agents/test", "/agents/new", "/agents/test"]) {
      state = nextAgentEntryContext(state, { path, scopeKey: initial.scopeKey, node: null });
      expect(state.origin).toEqual(node);
      expect(state.node).toBeNull();
    }
  });
  it("never falls back to a node visited before Home or settings", () => {
    for (const path of ["/home", "/settings"]) {
      const nonNode = nextAgentEntryContext(initial, {
        path,
        scopeKey: initial.scopeKey,
        node: null,
      });
      expect(
        nextAgentEntryContext(nonNode, {
          path: "/agents/test",
          scopeKey: initial.scopeKey,
          node: null,
        }).origin,
      ).toBeNull();
    }
  });
  it("does not carry context across workspace/actor changes or a direct Agent load", () => {
    expect(
      nextAgentEntryContext(initial, { path: "/agents/test", scopeKey: "other", node: null })
        .origin,
    ).toBeNull();
    expect(
      nextAgentEntryContext(null, { path: "/agents/test", scopeKey: initial.scopeKey, node: null })
        .origin,
    ).toBeNull();
  });
});
