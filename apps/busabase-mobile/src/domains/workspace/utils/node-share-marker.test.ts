import { describe, expect, it } from "vitest";
import { resolveNodeShareMarker } from "./node-share-marker";

describe("resolveNodeShareMarker", () => {
  it("is null for a node that is neither shared nor restricted", () => {
    expect(
      resolveNodeShareMarker({ shared: false, sharedViaAncestor: false, explicitVisibility: null }),
    ).toBeNull();
  });

  it("marks a node's own live public share with the default-tone globe", () => {
    expect(
      resolveNodeShareMarker({ shared: true, sharedViaAncestor: false, explicitVisibility: null }),
    ).toEqual({ icon: "globe", tone: "default", labelKey: "sharedMarker" });
  });

  it("marks exposure inherited from a shared ancestor with the muted-tone globe", () => {
    expect(
      resolveNodeShareMarker({ shared: false, sharedViaAncestor: true, explicitVisibility: null }),
    ).toEqual({ icon: "globe", tone: "muted", labelKey: "sharedViaAncestorMarker" });
  });

  it("marks an explicitly restricted node with the lock", () => {
    expect(
      resolveNodeShareMarker({
        shared: false,
        sharedViaAncestor: false,
        explicitVisibility: "private",
      }),
    ).toEqual({ icon: "lock", tone: "default", labelKey: "restrictedMarker" });
  });

  it("prefers the own-share globe over an inherited one", () => {
    expect(
      resolveNodeShareMarker({ shared: true, sharedViaAncestor: true, explicitVisibility: null }),
    ).toEqual({ icon: "globe", tone: "default", labelKey: "sharedMarker" });
  });

  it("prefers either globe over the restricted lock — the exposure must survive", () => {
    expect(
      resolveNodeShareMarker({
        shared: true,
        sharedViaAncestor: false,
        explicitVisibility: "private",
      }),
    ).toEqual({ icon: "globe", tone: "default", labelKey: "sharedMarker" });
    expect(
      resolveNodeShareMarker({
        shared: false,
        sharedViaAncestor: true,
        explicitVisibility: "private",
      }),
    ).toEqual({ icon: "globe", tone: "muted", labelKey: "sharedViaAncestorMarker" });
  });
});
