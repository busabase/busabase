/**
 * The catalog fetch is untrusted, cross-origin JSON — this covers the one
 * field that would otherwise throw all the way through oRPC's `.output()`
 * validation if a fetched `templates.json` carried a bad value: `risk` must
 * normalize to `undefined` rather than crash the whole gallery for every
 * other card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetTemplateCatalogCache, listTemplates } from "./catalog";

const baseEntry = {
  subdir: "templates/gated",
  name: "gated",
  description: "The gated desk.",
  category: "ops",
  stats: { folders: 0, docs: 0, bases: 1, records: 0, files: 1, airapps: 1, skill: true },
};

const mockCatalog = (templates: unknown[]) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ repo: "busabase/templates", ref: "main", templates }), {
          status: 200,
        }),
    ),
  );

beforeEach(() => {
  __resetTemplateCatalogCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listTemplates — risk normalization", () => {
  it("passes through a recognized risk level", async () => {
    mockCatalog([{ ...baseEntry, risk: "gated-write" }]);
    const catalog = await listTemplates();
    expect(catalog.templates[0].risk).toBe("gated-write");
  });

  it("drops an unrecognized risk value instead of throwing", async () => {
    mockCatalog([{ ...baseEntry, risk: "review-first" }]);
    const catalog = await listTemplates();
    expect(catalog.error).toBeUndefined();
    expect(catalog.templates).toHaveLength(1);
    expect(catalog.templates[0].risk).toBeUndefined();
  });

  it("leaves risk undefined when the entry never declares one", async () => {
    mockCatalog([baseEntry]);
    const catalog = await listTemplates();
    expect(catalog.templates[0].risk).toBeUndefined();
  });
});

describe("listTemplates — description is iString", () => {
  it("passes through a plain-string description unchanged", async () => {
    mockCatalog([baseEntry]);
    const catalog = await listTemplates();
    expect(catalog.templates[0].description).toBe("The gated desk.");
  });

  it("does not throw oRPC's .output() validation on a locale-keyed description", async () => {
    mockCatalog([
      { ...baseEntry, description: { en: "The gated desk.", "zh-CN": "受限工作台。" } },
    ]);
    const catalog = await listTemplates();
    expect(catalog.error).toBeUndefined();
    expect(catalog.templates[0].description).toEqual({
      en: "The gated desk.",
      "zh-CN": "受限工作台。",
    });
  });
});

describe("listTemplates — displayName is optional iString", () => {
  it("is absent when the entry never declares one", async () => {
    mockCatalog([baseEntry]);
    const catalog = await listTemplates();
    expect(catalog.templates[0].displayName).toBeUndefined();
  });

  it("passes through a locale-keyed displayName without throwing", async () => {
    mockCatalog([{ ...baseEntry, displayName: { en: "Gated Desk", "zh-CN": "受限工作台" } }]);
    const catalog = await listTemplates();
    expect(catalog.error).toBeUndefined();
    expect(catalog.templates[0].displayName).toEqual({
      en: "Gated Desk",
      "zh-CN": "受限工作台",
    });
  });
});
