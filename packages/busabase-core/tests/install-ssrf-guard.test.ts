import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SSRF guard on the install path, tested where it is actually load-bearing.
 *
 * `install-from-github.test.ts` shows that a non-GitHub URL is refused — but that
 * refusal comes from `parseGithubUrl`'s host check, which fires first. Deleting
 * `checkUrlIsSafeToFetch` from the install domain does not fail a single one of
 * those tests (verified by mutation). They prove defense in depth exists; they do
 * not prove the SSRF guard is wired in.
 *
 * This file closes that gap. The guard's distinct job is not "is the string
 * GitHub?" but "where does that name RESOLVE?" — a host allowlist never leaves
 * the string and is blind to a poisoned or rebound DNS answer. So DNS itself is
 * mocked: `codeload.github.com` resolves to the cloud metadata address, an URL
 * that passes every string-level check. If the guard is removed, install happily
 * proceeds to fetch it.
 */

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup }));

const GITHUB_URL = "https://github.com/acme/test-kb";

describe("install SSRF guard", () => {
  beforeEach(() => {
    lookup.mockReset();
  });

  it("refuses a legitimate github.com URL whose download host resolves to the metadata IP", async () => {
    // Every string-level check passes: the URL is github.com, the constructed
    // download URL is codeload.github.com. Only the resolved address is hostile.
    lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    const { runWithBusabaseContext } = await import("../src/context");
    const { busabaseRouter } = await import("../src/router");
    const { createRouterClient } = await import("@orpc/server");
    const client = createRouterClient(busabaseRouter);

    const fetchSpy = vi.spyOn(global, "fetch");
    try {
      await expect(
        runWithBusabaseContext({ spaceId: "space_install_ssrf_dns" }, () =>
          client.install.planFromGithub({ repoUrl: GITHUB_URL }),
        ),
      ).rejects.toThrow(/private\/internal address|Refusing to fetch/i);
      // And it refused BEFORE the request left.
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("refuses an RFC1918 resolution too, not just the metadata address", async () => {
    lookup.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);

    const { runWithBusabaseContext } = await import("../src/context");
    const { busabaseRouter } = await import("../src/router");
    const { createRouterClient } = await import("@orpc/server");
    const client = createRouterClient(busabaseRouter);

    await expect(
      runWithBusabaseContext({ spaceId: "space_install_ssrf_dns" }, () =>
        client.install.planFromGithub({ repoUrl: GITHUB_URL }),
      ),
    ).rejects.toThrow(/private\/internal address|Refusing to fetch/i);
  });

  // ── the allowlist half, exercised directly ────────────────────────────────
  //
  // `assertUrlIsFetchable` also guards every URL `downloadGithubZip` constructs
  // (public codeload, then the token-authenticated API), where `parseGithubUrl`
  // is no longer in the way. Tested as a unit because that is the only way to
  // reach the branch without mutating the downloader.
  it.each([
    ["a non-GitHub host", "https://evil.example.com/acme/test-kb.zip"],
    ["a lookalike host", "https://codeload.github.com.evil.example/acme/test-kb.zip"],
    ["plain http on an allowed host", "http://codeload.github.com/acme/test-kb/zip/HEAD"],
  ])("assertUrlIsFetchable rejects %s", async (_label, url) => {
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const { assertUrlIsFetchable } = await import("../src/domains/install/logic/github-source");
    await expect(assertUrlIsFetchable(url)).rejects.toThrow(/Refusing to fetch/i);
  });

  it("assertUrlIsFetchable accepts a real codeload URL that resolves publicly", async () => {
    lookup.mockResolvedValue([{ address: "140.82.116.10", family: 4 }]);
    const { assertUrlIsFetchable } = await import("../src/domains/install/logic/github-source");
    await expect(
      assertUrlIsFetchable("https://codeload.github.com/acme/test-kb/zip/HEAD"),
    ).resolves.toBeUndefined();
  });
});
