import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { describe, expect, it } from "vitest";

/**
 * Per-space cache isolation relies on the `keyPrefix` passed to
 * createBusabaseQueryUtils namespacing EVERY generated query key. This pins the
 * mechanism: two spaces produce distinct keys (so one space's cached reads can
 * never be served under another), and omitting the prefix keeps the bare key.
 */
describe("per-space query-key namespacing", () => {
  it("prefixes generated keys with the cache space key, distinctly per space", () => {
    const local = createBusabaseQueryUtils("/api/rpc", {}, "local");
    const spaceA = createBusabaseQueryUtils("/api/rpc", {}, "space-a");

    const localKey = local.records.list.key();
    const spaceAKey = spaceA.records.list.key();

    // Same procedure, different space → different cache entries.
    expect(localKey).not.toEqual(spaceAKey);
    expect(JSON.stringify(localKey)).toContain("local");
    expect(JSON.stringify(spaceAKey)).toContain("space-a");
    // The prefix leads the operation path.
    expect(localKey[0]).toEqual(["local", "records", "list"]);
    expect(spaceAKey[0]).toEqual(["space-a", "records", "list"]);
  });

  it("leaves keys un-prefixed when no space key is given", () => {
    const plain = createBusabaseQueryUtils("/api/rpc");
    expect(plain.records.list.key()[0]).toEqual(["records", "list"]);
  });
});
