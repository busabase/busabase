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

/**
 * The two asset kinds resolve against different GitHub hosts, and swapping
 * them is silent: a clip fetched from `raw` returns an LFS pointer file that a
 * `<video>` simply fails to play, with no error anywhere.
 */
describe("listTemplates — asset URLs", () => {
  it("serves the demo clip from the media host, which resolves LFS objects", async () => {
    mockCatalog([{ ...baseEntry, video: "assets/recordings/gated.mp4" }]);
    const result = await listTemplates();
    expect(result.templates[0]?.video).toBe(
      "https://media.githubusercontent.com/media/busabase/templates/main/templates/gated/assets/recordings/gated.mp4",
    );
  });

  it("keeps screenshots on the raw host, which is right for ordinary objects", async () => {
    mockCatalog([
      {
        ...baseEntry,
        screenshots: ["assets/screenshots/cover.webp"],
        video: "assets/recordings/gated.mp4",
      },
    ]);
    const result = await listTemplates();
    expect(result.templates[0]?.screenshots[0]).toBe(
      "https://raw.githubusercontent.com/busabase/templates/main/templates/gated/assets/screenshots/cover.webp",
    );
  });

  it("leaves video undefined when the entry never declares one", async () => {
    mockCatalog([baseEntry]);
    const result = await listTemplates();
    expect(result.templates[0]?.video).toBeUndefined();
  });
});

/**
 * Clip lists resolve like single clips (LFS media host), and a card from a
 * catalog that never heard of `videos` must come out exactly as before.
 */
describe("listTemplates — several clips", () => {
  const MEDIA = "https://media.githubusercontent.com/media/busabase/templates/main/templates/gated";

  it("resolves every clip, with its title, on the media host", async () => {
    mockCatalog([
      {
        ...baseEntry,
        video: "assets/recordings/tour.mp4",
        videos: [
          { src: "assets/recordings/tour.mp4", title: "30-second tour" },
          { src: "assets/recordings/full.mp4", title: "Full walkthrough" },
        ],
        locales: {
          "zh-CN": { videos: [{ src: "assets/recordings/tour-zh-CN.mp4", title: "30 秒看懂" }] },
        },
      },
    ]);
    const [card] = (await listTemplates()).templates;
    expect(card.video).toBe(`${MEDIA}/assets/recordings/tour.mp4`);
    expect(card.videos).toEqual([
      { src: `${MEDIA}/assets/recordings/tour.mp4`, title: "30-second tour" },
      { src: `${MEDIA}/assets/recordings/full.mp4`, title: "Full walkthrough" },
    ]);
    expect(card.locales?.["zh-CN"]?.videos).toEqual([
      { src: `${MEDIA}/assets/recordings/tour-zh-CN.mp4`, title: "30 秒看懂" },
    ]);
  });

  it("derives `video` from the list when a hand-written catalog omits it", async () => {
    mockCatalog([{ ...baseEntry, videos: [{ src: "assets/recordings/tour.mp4" }] }]);
    const [card] = (await listTemplates()).templates;
    expect(card.video).toBe(`${MEDIA}/assets/recordings/tour.mp4`);
  });

  it("carries no `videos` key for a catalog that only has single clips", async () => {
    mockCatalog([{ ...baseEntry, video: "assets/recordings/gated.mp4" }]);
    const [card] = (await listTemplates()).templates;
    expect(card.video).toBe(`${MEDIA}/assets/recordings/gated.mp4`);
    expect(Object.hasOwn(card, "videos")).toBe(false);
  });

  it("drops malformed clips instead of failing the whole catalog", async () => {
    mockCatalog([
      {
        ...baseEntry,
        videos: [null, "bare.mp4", { title: "no src" }, { src: "assets/recordings/ok.mp4" }],
        locales: { "zh-CN": { videos: "assets/recordings/x.mp4" } },
      },
    ]);
    const [card] = (await listTemplates()).templates;
    expect(card.videos).toEqual([{ src: `${MEDIA}/assets/recordings/ok.mp4` }]);
    expect(card.locales).toBeUndefined();
  });
});

/**
 * Per-locale media resolves exactly like the defaults, and — because every
 * deployed catalog predates it — its absence or a malformed value must leave a
 * card byte-for-byte what it was.
 */
describe("listTemplates — localized media", () => {
  const RAW = "https://raw.githubusercontent.com/busabase/templates/main/templates/gated";
  const MEDIA = "https://media.githubusercontent.com/media/busabase/templates/main/templates/gated";

  it("resolves each locale's screenshots on the raw host and its clip on the media host", async () => {
    mockCatalog([
      {
        ...baseEntry,
        screenshots: ["assets/screenshots/cover.webp"],
        video: "assets/recordings/gated.mp4",
        locales: {
          "zh-CN": {
            screenshots: ["assets/screenshots/cover-zh-CN.webp"],
            video: "assets/recordings/gated-zh-CN.mp4",
          },
          ja: { video: "assets/recordings/gated-ja.mp4" },
        },
      },
    ]);
    const [card] = (await listTemplates()).templates;
    expect(card.screenshots).toEqual([`${RAW}/assets/screenshots/cover.webp`]);
    expect(card.video).toBe(`${MEDIA}/assets/recordings/gated.mp4`);
    expect(card.locales).toEqual({
      "zh-CN": {
        screenshots: [`${RAW}/assets/screenshots/cover-zh-CN.webp`],
        video: `${MEDIA}/assets/recordings/gated-zh-CN.mp4`,
      },
      ja: { video: `${MEDIA}/assets/recordings/gated-ja.mp4` },
    });
  });

  it("produces the same card as before for an old-shape catalog with no locales", async () => {
    mockCatalog([{ ...baseEntry, screenshots: ["assets/screenshots/cover.webp"] }]);
    const [card] = (await listTemplates()).templates;
    expect(Object.hasOwn(card, "locales")).toBe(false);
    expect(card).toEqual({
      id: "busabase/templates/templates/gated",
      name: "gated",
      description: "The gated desk.",
      category: "ops",
      tags: [],
      screenshots: [`${RAW}/assets/screenshots/cover.webp`],
      agentPrompts: [],
      stats: baseEntry.stats,
      install: {
        repoUrl: "https://github.com/busabase/templates/tree/main/templates/gated",
        intoFolder: "gated",
      },
      sourceUrl: "https://github.com/busabase/templates/tree/main/templates/gated",
    });
  });

  it("ignores a malformed locales value instead of failing the gallery", async () => {
    mockCatalog([
      { ...baseEntry, subdir: "templates/a", name: "a", locales: "zh-CN" },
      { ...baseEntry, subdir: "templates/b", name: "b", locales: ["cover-zh-CN.webp"] },
      {
        ...baseEntry,
        subdir: "templates/c",
        name: "c",
        locales: { "zh-CN": { screenshots: "cover-zh-CN.webp", video: 7 }, ja: null },
      },
    ]);
    const catalog = await listTemplates();
    expect(catalog.error).toBeUndefined();
    expect(catalog.templates).toHaveLength(3);
    for (const card of catalog.templates) {
      expect(Object.hasOwn(card, "locales")).toBe(false);
    }
  });
});
