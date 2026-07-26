import { describe, expect, it, vi } from "vitest";
import { readCmsOrFallback } from "../src/fallback";

describe("readCmsOrFallback", () => {
  it("returns the fallback without calling anything when operation is null/undefined", async () => {
    await expect(readCmsOrFallback(null, [], "list posts")).resolves.toEqual([]);
    await expect(readCmsOrFallback(undefined, "default", "get post")).resolves.toBe("default");
  });

  it("returns the operation's result when it succeeds", async () => {
    await expect(readCmsOrFallback(async () => [1, 2, 3], [], "list posts")).resolves.toEqual([
      1, 2, 3,
    ]);
  });

  it("falls back and logs a warning when the operation throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      readCmsOrFallback(
        async () => {
          throw new Error("network down");
        },
        "fallback-value",
        "get post /blog/x",
      ),
    ).resolves.toBe("fallback-value");
    expect(warn).toHaveBeenCalledWith(
      "[busabase-cms] get post /blog/x failed; using bundled content",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
