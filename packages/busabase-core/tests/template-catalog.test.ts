/**
 * The Template Center catalog: caching, and the one way past it.
 *
 * The refresh button exists because a user who can see the gallery is stale
 * must have a way to fix that. It only works if `refresh: true` reaches the
 * SERVER — react-query refetching the same cached answer looks identical to the
 * user and changes nothing. That is the invariant these tests hold: the cache
 * is real (so a gallery opened three times costs one round trip), and the flag
 * genuinely bypasses it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetTemplateCatalogCache, listTemplates } from "../src/domains/templates/logic/catalog";

const CATALOG = {
  format: "busabase-template-index@1",
  repo: "busabase/templates",
  ref: "main",
  templates: [
    {
      subdir: "busa-email",
      name: "busa-email",
      description: "An approval-first email desk.",
      category: "email",
      tags: ["inbox"],
      screenshots: ["assets/screenshots/overview.webp"],
      agentPrompts: ["Triage this morning's mail."],
      version: "0.3.0",
      license: "MIT",
      stats: { folders: 1, docs: 0, bases: 3, records: 7, files: 41, airapps: 1, skill: true },
    },
  ],
};

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetTemplateCatalogCache();
  fetchMock = vi.fn(async () => jsonResponse(CATALOG));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetTemplateCatalogCache();
});

describe("listTemplates", () => {
  it("serves a second reader from cache instead of GitHub", async () => {
    await listTemplates();
    await listTemplates();
    await listTemplates({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches when the caller asks to bypass the cache", async () => {
    await listTemplates();
    const refreshed = await listTemplates({ refresh: true });

    // The whole point of the refresh button: it must reach past the server's
    // own cache, not merely re-read it.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshed.templates).toHaveLength(1);
  });

  it("re-primes the cache from the refreshed answer", async () => {
    await listTemplates({ refresh: true });
    await listTemplates();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves screenshots against the catalog's own repo and ref", async () => {
    const catalog = await listTemplates();

    expect(catalog.templates[0].screenshots).toEqual([
      "https://raw.githubusercontent.com/busabase/templates/main/busa-email/assets/screenshots/overview.webp",
    ]);
    expect(catalog.templates[0].install.repoUrl).toBe(
      "https://github.com/busabase/templates/tree/main/busa-email",
    );
  });

  it("says why it is empty when the catalog cannot be reached", async () => {
    fetchMock.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));

    const catalog = await listTemplates();

    expect(catalog.templates).toEqual([]);
    expect(catalog.error).toContain("getaddrinfo ENOTFOUND");
  });

  it("does not cache a failure — the next reader tries again", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    await listTemplates();
    const second = await listTemplates();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.error).toBeUndefined();
    expect(second.templates).toHaveLength(1);
  });

  it("refuses a file that is not a Busabase template catalog", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hello: "world" }));

    const catalog = await listTemplates();

    expect(catalog.templates).toEqual([]);
    expect(catalog.error).toContain("not a Busabase template catalog");
  });
});
