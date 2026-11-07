import { describe, expect, it, vi } from "vitest";
import { BusabaseCmsError, CmsUnavailableError, isCmsUnavailableError } from "../src/errors";
import { readCmsOrFallback, requireCmsRead } from "../src/fallback";

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

describe("requireCmsRead", () => {
  it("unwraps a successful read", () => {
    expect(requireCmsRead({ status: "ok", data: null }, "a post")).toBeNull();
  });

  it("throws a typed outage error, keeping the message callers match on", () => {
    let thrown: unknown;
    try {
      requireCmsRead({ status: "unavailable" }, "blog post /blog/x");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CmsUnavailableError);
    expect(thrown).toBeInstanceOf(BusabaseCmsError);
    expect((thrown as Error).name).toBe("CmsUnavailableError");
    expect((thrown as Error).message).toBe(
      "Busabase CMS unreachable while rendering blog post /blog/x",
    );
  });
});

describe("isCmsUnavailableError", () => {
  it("recognises the class, and an outage error from another copy of the package by name", () => {
    expect(isCmsUnavailableError(new CmsUnavailableError("down"))).toBe(true);
    const fromAnotherCopy = Object.assign(new Error("down"), { name: "CmsUnavailableError" });
    expect(isCmsUnavailableError(fromAnotherCopy)).toBe(true);
  });

  it("rejects every other failure", () => {
    expect(isCmsUnavailableError(new Error("Busabase CMS unreachable"))).toBe(false);
    expect(isCmsUnavailableError(new BusabaseCmsError("drift"))).toBe(false);
    expect(isCmsUnavailableError({ name: "CmsUnavailableError" })).toBe(false);
    expect(isCmsUnavailableError(undefined)).toBe(false);
  });
});
