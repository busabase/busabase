import { beforeEach, describe, expect, it, vi } from "vitest";

const sharedTargets = vi.hoisted(() => new Map<string, string>());
vi.mock("openlib/cache", () => ({
  cache: Promise.resolve({
    set: async (key: string, value: string) => {
      sharedTargets.set(key, value);
    },
    get: async (key: string) => sharedTargets.get(key) ?? null,
    del: async (key: string) => {
      sharedTargets.delete(key);
    },
    deleteIfValue: async (key: string, expected: string) => {
      if (sharedTargets.get(key) !== expected) return false;
      sharedTargets.delete(key);
      return true;
    },
  }),
}));

import {
  getLocalPreviewTarget,
  LOCAL_PREVIEW_OWNER,
  registerLocalPreview,
  unregisterLocalPreview,
} from "./local-preview-registry";

const sharedTargetKey = (nodeId: string, owner: string): string =>
  `busabase:airapp-preview:${Buffer.from(JSON.stringify([owner, nodeId])).toString("base64url")}`;

beforeEach(() => {
  sharedTargets.clear();
});

/**
 * The registry key is load-bearing for two separate things, so both are
 * asserted here rather than assumed from the shape of the key.
 */
describe("local preview registry", () => {
  it("does not surface one owner's running preview to another", async () => {
    // Starting a run requires `write` on the node. Viewing one used to require
    // nothing but the nodeId, because the proxy looked up by nodeId alone.
    await registerLocalPreview("node-a", "user-1", "http://127.0.0.1:4001");

    expect(await getLocalPreviewTarget("node-a", "user-1")).toBe("http://127.0.0.1:4001");
    expect(await getLocalPreviewTarget("node-a", "user-2")).toBeUndefined();
    expect(await getLocalPreviewTarget("node-a", LOCAL_PREVIEW_OWNER)).toBeUndefined();

    await unregisterLocalPreview("node-a", "user-1");
  });

  it("keeps two concurrent runs of the same node from clobbering each other", async () => {
    // The old failure: the second registration overwrote the first, then
    // whichever run ended first unregistered the shared entry and 404'd the
    // other run's preview while it was still serving.
    await registerLocalPreview("node-b", "user-1", "http://127.0.0.1:4101");
    await registerLocalPreview("node-b", "user-2", "http://127.0.0.1:4102");

    expect(await getLocalPreviewTarget("node-b", "user-1")).toBe("http://127.0.0.1:4101");
    expect(await getLocalPreviewTarget("node-b", "user-2")).toBe("http://127.0.0.1:4102");

    await unregisterLocalPreview("node-b", "user-1");

    expect(await getLocalPreviewTarget("node-b", "user-1")).toBeUndefined();
    expect(await getLocalPreviewTarget("node-b", "user-2")).toBe("http://127.0.0.1:4102");

    await unregisterLocalPreview("node-b", "user-2");
  });

  it("keeps different nodes separate for the same owner", async () => {
    await registerLocalPreview("node-c", "user-1", "http://127.0.0.1:4201");
    await registerLocalPreview("node-d", "user-1", "http://127.0.0.1:4202");

    expect(await getLocalPreviewTarget("node-c", "user-1")).toBe("http://127.0.0.1:4201");
    expect(await getLocalPreviewTarget("node-d", "user-1")).toBe("http://127.0.0.1:4202");

    await unregisterLocalPreview("node-c", "user-1");
    await unregisterLocalPreview("node-d", "user-1");
  });

  it("treats shared state as authoritative over a stale module-local target", async () => {
    const nodeId = "node-shared";
    const owner = "user-shared";
    const key = sharedTargetKey(nodeId, owner);
    await registerLocalPreview(nodeId, owner, "https://old-preview.example");

    // Simulate another Next.js module context replacing and then removing the
    // target. The route module must not keep serving its stale process Map.
    sharedTargets.set(key, "https://new-preview.example");
    expect(await getLocalPreviewTarget(nodeId, owner)).toBe("https://new-preview.example");

    sharedTargets.delete(key);
    expect(await getLocalPreviewTarget(nodeId, owner)).toBeUndefined();

    await unregisterLocalPreview(nodeId, owner);
  });

  it("cannot be confused by an owner or node id containing the key separator", async () => {
    // A composite string key is only safe if it cannot be forged. Asserted
    // because the alternative — one owner reaching another's entry by naming
    // it — is exactly the bug this key exists to prevent.
    await registerLocalPreview("b", "a c", "http://127.0.0.1:4301");

    expect(await getLocalPreviewTarget("c b", "a")).toBeUndefined();
    expect(await getLocalPreviewTarget("b", "a c")).toBe("http://127.0.0.1:4301");

    await unregisterLocalPreview("b", "a c");
  });
});
