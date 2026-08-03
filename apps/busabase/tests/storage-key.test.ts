import { describe, expect, it } from "vitest";
import { isSafeStorageKey } from "~/lib/storage-key";

/**
 * `/api/dev/upload` and `/api/dev/attachment/[...key]` are un-gated in
 * production for this app (self-hosted Busabase runs a production build and
 * serves every local attachment through them). The openlib handlers hand the
 * key straight to the storage adapter, which does `path.join(rootDir, key)` —
 * so this guard is what stops a traversal key from reading or writing outside
 * the storage root. These assertions are that safety property, not style.
 */
describe("isSafeStorageKey", () => {
  it("accepts the keys the asset pipeline actually mints", () => {
    expect(isSafeStorageKey("attachments/blobs/sha256/ab/deadbeef.png")).toBe(true);
    expect(isSafeStorageKey("logo.svg")).toBe(true);
  });

  it("rejects traversal, absolute and Windows-shaped keys", () => {
    expect(isSafeStorageKey("../../etc/passwd")).toBe(false);
    expect(isSafeStorageKey("attachments/../../../etc/passwd")).toBe(false);
    expect(isSafeStorageKey("..")).toBe(false);
    expect(isSafeStorageKey("ok/./escape")).toBe(false);
    expect(isSafeStorageKey("/etc/passwd")).toBe(false);
    expect(isSafeStorageKey("C:/Windows/system32/config/sam")).toBe(false);
    expect(isSafeStorageKey("a\\..\\..\\b")).toBe(false);
  });

  it("rejects empty, control-byte and absurdly long keys", () => {
    expect(isSafeStorageKey("")).toBe(false);
    expect(isSafeStorageKey("a\u0000b")).toBe(false);
    expect(isSafeStorageKey(`${"a".repeat(513)}.png`)).toBe(false);
  });
});
