import { describe, expect, it } from "vitest";
import {
  getLocalPreviewTarget,
  LOCAL_PREVIEW_OWNER,
  registerLocalPreview,
  unregisterLocalPreview,
} from "./local-preview-registry";

/**
 * The registry key is load-bearing for two separate things, so both are
 * asserted here rather than assumed from the shape of the key.
 */
describe("local preview registry", () => {
  it("does not surface one owner's running preview to another", () => {
    // Starting a run requires `write` on the node. Viewing one used to require
    // nothing but the nodeId, because the proxy looked up by nodeId alone.
    registerLocalPreview("node-a", "user-1", "http://127.0.0.1:4001");

    expect(getLocalPreviewTarget("node-a", "user-1")).toBe("http://127.0.0.1:4001");
    expect(getLocalPreviewTarget("node-a", "user-2")).toBeUndefined();
    expect(getLocalPreviewTarget("node-a", LOCAL_PREVIEW_OWNER)).toBeUndefined();

    unregisterLocalPreview("node-a", "user-1");
  });

  it("keeps two concurrent runs of the same node from clobbering each other", () => {
    // The old failure: the second registration overwrote the first, then
    // whichever run ended first unregistered the shared entry and 404'd the
    // other run's preview while it was still serving.
    registerLocalPreview("node-b", "user-1", "http://127.0.0.1:4101");
    registerLocalPreview("node-b", "user-2", "http://127.0.0.1:4102");

    expect(getLocalPreviewTarget("node-b", "user-1")).toBe("http://127.0.0.1:4101");
    expect(getLocalPreviewTarget("node-b", "user-2")).toBe("http://127.0.0.1:4102");

    unregisterLocalPreview("node-b", "user-1");

    expect(getLocalPreviewTarget("node-b", "user-1")).toBeUndefined();
    expect(getLocalPreviewTarget("node-b", "user-2")).toBe("http://127.0.0.1:4102");

    unregisterLocalPreview("node-b", "user-2");
  });

  it("keeps different nodes separate for the same owner", () => {
    registerLocalPreview("node-c", "user-1", "http://127.0.0.1:4201");
    registerLocalPreview("node-d", "user-1", "http://127.0.0.1:4202");

    expect(getLocalPreviewTarget("node-c", "user-1")).toBe("http://127.0.0.1:4201");
    expect(getLocalPreviewTarget("node-d", "user-1")).toBe("http://127.0.0.1:4202");

    unregisterLocalPreview("node-c", "user-1");
    unregisterLocalPreview("node-d", "user-1");
  });

  it("cannot be confused by an owner or node id containing the key separator", () => {
    // A composite string key is only safe if it cannot be forged. Asserted
    // because the alternative — one owner reaching another's entry by naming
    // it — is exactly the bug this key exists to prevent.
    registerLocalPreview("b", "a c", "http://127.0.0.1:4301");

    expect(getLocalPreviewTarget("c b", "a")).toBeUndefined();
    expect(getLocalPreviewTarget("b", "a c")).toBe("http://127.0.0.1:4301");

    unregisterLocalPreview("b", "a c");
  });
});
