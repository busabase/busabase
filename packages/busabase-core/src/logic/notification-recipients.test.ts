import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_IMMEDIATE_RECIPIENT_CAP,
  rankNotificationRecipients,
  resolveEffectiveSubscribers,
  selectNotificationRecipients,
} from "./notification-recipients";

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 2, 12, 0) - minutesAgo * 60_000);

describe("resolveEffectiveSubscribers", () => {
  const chain = ["doc", "folder", "root"];

  it("collects subscriptions on the node and every ancestor", () => {
    const result = resolveEffectiveSubscribers(chain, [
      { nodeId: "doc", actorId: "a", mutedAt: null, lastInteractedAt: at(1) },
      { nodeId: "folder", actorId: "b", mutedAt: null, lastInteractedAt: at(2) },
      { nodeId: "root", actorId: "c", mutedAt: null, lastInteractedAt: at(3) },
    ]);
    expect(result.map((s) => [s.actorId, s.viaNodeId]).sort()).toEqual([
      ["a", "doc"],
      ["b", "folder"],
      ["c", "root"],
    ]);
  });

  it("lets a nearer mute override a farther folder subscription", () => {
    const result = resolveEffectiveSubscribers(chain, [
      { nodeId: "folder", actorId: "a", mutedAt: null, lastInteractedAt: at(1) },
      { nodeId: "doc", actorId: "a", mutedAt: at(0), lastInteractedAt: at(1) },
    ]);
    expect(result).toEqual([]);
  });

  it("lets a nearer subscription override a farther mute", () => {
    const result = resolveEffectiveSubscribers(chain, [
      { nodeId: "folder", actorId: "a", mutedAt: at(5), lastInteractedAt: at(5) },
      { nodeId: "doc", actorId: "a", mutedAt: null, lastInteractedAt: at(1) },
    ]);
    expect(result).toEqual([{ actorId: "a", viaNodeId: "doc", lastInteractedAt: at(1) }]);
  });

  it("ignores rows on nodes outside the current chain (a moved node's old folder)", () => {
    const result = resolveEffectiveSubscribers(chain, [
      { nodeId: "old-folder", actorId: "a", mutedAt: null, lastInteractedAt: at(1) },
    ]);
    expect(result).toEqual([]);
  });
});

describe("rankNotificationRecipients", () => {
  it("excludes the actor and deduplicates, keeping the latest interaction", () => {
    const ranked = rankNotificationRecipients({
      candidates: [
        { actorId: "actor", lastInteractedAt: at(0) },
        { actorId: "x", lastInteractedAt: at(30) },
        { actorId: "x", lastInteractedAt: at(1) },
        { actorId: "y", lastInteractedAt: at(10) },
      ],
      excludeActorIds: ["actor"],
    });
    expect(ranked).toEqual(["x", "y"]);
  });

  it("orders pinned first, then the creator, then by most recent interaction", () => {
    const ranked = rankNotificationRecipients({
      candidates: [
        { actorId: "old", lastInteractedAt: at(100) },
        { actorId: "creator", lastInteractedAt: at(500) },
        { actorId: "recent", lastInteractedAt: at(1) },
        { actorId: "never", lastInteractedAt: null },
      ],
      pinnedActorIds: ["submitter"],
      creatorActorId: "creator",
    });
    expect(ranked).toEqual(["submitter", "creator", "recent", "old", "never"]);
  });

  it("only promotes the creator when they are already a candidate", () => {
    const ranked = rankNotificationRecipients({
      candidates: [{ actorId: "a", lastInteractedAt: at(1) }],
      creatorActorId: "creator",
    });
    expect(ranked).toEqual(["a"]);
  });

  it("never lets a pinned actor through when they caused the event", () => {
    const ranked = rankNotificationRecipients({
      candidates: [{ actorId: "a", lastInteractedAt: at(1) }],
      pinnedActorIds: ["submitter"],
      excludeActorIds: ["submitter"],
    });
    expect(ranked).toEqual(["a"]);
  });

  it("breaks interaction-time ties by id so the order is stable", () => {
    const ranked = rankNotificationRecipients({
      candidates: [
        { actorId: "b", lastInteractedAt: at(1) },
        { actorId: "a", lastInteractedAt: at(1) },
      ],
    });
    expect(ranked).toEqual(["a", "b"]);
  });
});

describe("selectNotificationRecipients (cap)", () => {
  const candidates = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      actorId: `u${String(index).padStart(3, "0")}`,
      lastInteractedAt: at(index),
    }));

  it.each([20, 21, 300])("caps %i eligible people at 20, creator first", (count) => {
    const selected = selectNotificationRecipients({
      candidates: candidates(count),
      creatorActorId: `u${String(count - 1).padStart(3, "0")}`,
    });
    expect(NOTIFICATION_IMMEDIATE_RECIPIENT_CAP).toBe(20);
    expect(selected).toHaveLength(20);
    // The creator is the LEAST recent interaction here, and still goes first.
    expect(selected[0]).toBe(`u${String(count - 1).padStart(3, "0")}`);
    // Then the most recent interactions, in order.
    expect(selected.slice(1, 4)).toEqual(["u000", "u001", "u002"]);
  });

  it("keeps the pinned submitter ahead of the creator inside the cap", () => {
    const selected = selectNotificationRecipients({
      candidates: candidates(300),
      creatorActorId: "u299",
      pinnedActorIds: ["submitter"],
    });
    expect(selected.slice(0, 2)).toEqual(["submitter", "u299"]);
    expect(selected).toHaveLength(20);
  });
});
