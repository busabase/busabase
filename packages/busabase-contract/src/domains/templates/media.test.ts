import { describe, expect, it } from "vitest";
import { TEMPLATE_VIDEO_LIMIT } from "../package/template";
import {
  declaredVideos,
  parseTemplateLocales,
  parseTemplateVideos,
  pickTemplateMedia,
} from "./media";

const DEFAULT = {
  screenshots: ["cover.webp", "overview.webp"],
  video: "desk.mp4",
};
/** What `DEFAULT` renders: the single `video` becomes a one-entry list. */
const DEFAULT_MEDIA = { screenshots: DEFAULT.screenshots, videos: [{ src: "desk.mp4" }] };

const LOCALIZED = {
  ...DEFAULT,
  locales: {
    "zh-CN": { screenshots: ["cover-zh-CN.webp", "overview-zh-CN.webp"], video: "desk-zh-CN.mp4" },
    "zh-TW": { video: "desk-zh-TW.mp4" },
    ko: { screenshots: ["cover-ko.webp"] },
  },
};

describe("pickTemplateMedia", () => {
  it("gives a viewer their own locale's screenshots and clip", () => {
    expect(pickTemplateMedia(LOCALIZED, "zh-CN")).toEqual({
      screenshots: ["cover-zh-CN.webp", "overview-zh-CN.webp"],
      videos: [{ src: "desk-zh-CN.mp4" }],
    });
  });

  it("falls back to the English defaults for a locale with no entry", () => {
    expect(pickTemplateMedia(LOCALIZED, "ja")).toEqual(DEFAULT_MEDIA);
  });

  it("uses a locale's clip and still the default screenshots when it only re-recorded the clip", () => {
    expect(pickTemplateMedia(LOCALIZED, "zh-TW")).toEqual({
      screenshots: DEFAULT.screenshots,
      videos: [{ src: "desk-zh-TW.mp4" }],
    });
  });

  it("replaces the default list whole rather than merging per index", () => {
    // One localized cover, no localized second shot: the viewer sees ONE image,
    // never "Korean cover, English overview".
    expect(pickTemplateMedia(LOCALIZED, "ko")).toEqual({
      screenshots: ["cover-ko.webp"],
      videos: [{ src: "desk.mp4" }],
    });
  });

  it("returns the defaults unchanged for a template with no locales", () => {
    expect(pickTemplateMedia(DEFAULT, "zh-CN")).toEqual(DEFAULT_MEDIA);
    expect(pickTemplateMedia({ screenshots: [] }, "zh-CN")).toEqual({
      screenshots: [],
      videos: [],
    });
  });

  it("matches exact locale keys only, like iStringParse", () => {
    expect(pickTemplateMedia(LOCALIZED, "zh")).toEqual(DEFAULT_MEDIA);
    expect(pickTemplateMedia(LOCALIZED, undefined)).toEqual(DEFAULT_MEDIA);
  });

  it("treats an empty localized list or clip as undeclared", () => {
    const empty = {
      ...DEFAULT,
      locales: { "zh-CN": { screenshots: [], video: "", videos: [] } },
    };
    expect(pickTemplateMedia(empty, "zh-CN")).toEqual(DEFAULT_MEDIA);
  });

  it("ignores a malformed locales value instead of throwing", () => {
    const malformed = [
      "zh-CN",
      ["cover-zh-CN.webp"],
      { "zh-CN": "cover-zh-CN.webp" },
      { "zh-CN": { screenshots: "cover-zh-CN.webp", video: 42, videos: "desk.mp4" } },
    ];
    for (const locales of malformed) {
      expect(
        pickTemplateMedia({ ...DEFAULT, locales } as unknown as typeof DEFAULT, "zh-CN"),
      ).toEqual(DEFAULT_MEDIA);
    }
  });

  it("never resolves a viewer locale through the object prototype", () => {
    expect(pickTemplateMedia(LOCALIZED, "constructor")).toEqual(DEFAULT_MEDIA);
    expect(pickTemplateMedia(LOCALIZED, "__proto__")).toEqual(DEFAULT_MEDIA);
  });
});

describe("pickTemplateMedia — several clips", () => {
  const TOUR = { src: "tour.mp4", title: "30-second tour" };
  const FULL = { src: "full.mp4", title: "Full walkthrough" };
  const SEVERAL = {
    screenshots: ["cover.webp"],
    video: TOUR.src,
    videos: [TOUR, FULL],
    locales: {
      "zh-CN": { videos: [{ src: "tour-zh-CN.mp4", title: "30 秒看懂" }] },
      "zh-TW": { video: "tour-zh-TW.mp4" },
    },
  };

  it("returns the clips in declared order, titles kept", () => {
    expect(pickTemplateMedia(SEVERAL, "en").videos).toEqual([TOUR, FULL]);
  });

  it("lets the list win over the single video at the same level", () => {
    // The catalog index writes `video` as the first clip for old readers, so the
    // two agreeing is the normal case; when they do not, the list is the truth.
    const disagree = { screenshots: [], video: "old.mp4", videos: [TOUR, FULL] };
    expect(pickTemplateMedia(disagree, "en").videos).toEqual([TOUR, FULL]);
  });

  it("replaces the default clips whole for a locale that declares its own list", () => {
    // Two English clips, one Chinese: the Chinese viewer sees one, never
    // "Chinese tour + English walkthrough".
    expect(pickTemplateMedia(SEVERAL, "zh-CN").videos).toEqual([
      { src: "tour-zh-CN.mp4", title: "30 秒看懂" },
    ]);
  });

  it("lets a locale's single video replace a default list too", () => {
    expect(pickTemplateMedia(SEVERAL, "zh-TW").videos).toEqual([{ src: "tour-zh-TW.mp4" }]);
  });

  it("falls back to the default clips for a locale with no clip entry", () => {
    expect(pickTemplateMedia(SEVERAL, "ja").videos).toEqual([TOUR, FULL]);
  });

  it("renders only the first TEMPLATE_VIDEO_LIMIT clips", () => {
    const many = Array.from({ length: TEMPLATE_VIDEO_LIMIT + 2 }, (_, i) => ({ src: `v${i}.mp4` }));
    const media = pickTemplateMedia({ screenshots: [], videos: many }, "en");
    expect(media.videos).toEqual(many.slice(0, TEMPLATE_VIDEO_LIMIT));
  });

  it("skips malformed clips and keeps the good ones next to them", () => {
    const raw = {
      screenshots: [],
      videos: [
        null,
        "bare.mp4",
        { title: "no src" },
        { src: "" },
        { src: "ok.mp4", title: 7 },
        TOUR,
      ],
    };
    expect(pickTemplateMedia(raw as unknown as typeof SEVERAL, "en").videos).toEqual([
      { src: "ok.mp4" },
      TOUR,
    ]);
  });

  it("falls back to the single video when the list has nothing usable", () => {
    const raw = { screenshots: [], video: "desk.mp4", videos: [{ title: "no src" }] };
    expect(pickTemplateMedia(raw as unknown as typeof SEVERAL, "en").videos).toEqual([
      { src: "desk.mp4" },
    ]);
  });
});

describe("parseTemplateVideos / declaredVideos", () => {
  it("is undefined for anything that is not a list with a usable clip", () => {
    for (const raw of [undefined, null, "a.mp4", 3, {}, [], [null], [{ title: "t" }]]) {
      expect(parseTemplateVideos(raw)).toBeUndefined();
    }
  });

  it("prefers the list, then the single path, then nothing", () => {
    expect(declaredVideos("a.mp4", [{ src: "b.mp4" }])).toEqual([{ src: "b.mp4" }]);
    expect(declaredVideos("a.mp4", undefined)).toEqual([{ src: "a.mp4" }]);
    expect(declaredVideos("", [])).toBeUndefined();
    expect(declaredVideos(undefined, undefined)).toBeUndefined();
  });
});

describe("parseTemplateLocales", () => {
  it("is undefined for an absent or non-object value", () => {
    for (const raw of [undefined, null, "zh-CN", 3, ["a.webp"]]) {
      expect(parseTemplateLocales(raw)).toBeUndefined();
    }
  });

  it("keeps well-formed entries and drops the rest", () => {
    expect(
      parseTemplateLocales({
        "zh-CN": { screenshots: ["cover-zh-CN.webp", 7, ""], video: "desk-zh-CN.mp4" },
        ja: { screenshots: "cover-ja.webp" },
        ko: "cover-ko.webp",
        vi: { video: 9 },
        de: { video: "desk-de.mp4", poster: "ignored.webp" },
        fr: { videos: [{ src: "tour-fr.mp4", title: "Visite" }, { title: "no src" }] },
      }),
    ).toEqual({
      "zh-CN": { screenshots: ["cover-zh-CN.webp"], video: "desk-zh-CN.mp4" },
      de: { video: "desk-de.mp4" },
      fr: { videos: [{ src: "tour-fr.mp4", title: "Visite" }] },
    });
  });

  it("is undefined when no entry survives, so a card carries no empty locales key", () => {
    expect(parseTemplateLocales({ "zh-CN": { screenshots: [] } })).toBeUndefined();
    expect(parseTemplateLocales({ "zh-CN": { videos: [] } })).toBeUndefined();
  });
});
