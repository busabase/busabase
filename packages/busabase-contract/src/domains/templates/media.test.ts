import { describe, expect, it } from "vitest";
import { parseTemplateLocales, pickTemplateMedia } from "./media";

const DEFAULT = {
  screenshots: ["cover.webp", "overview.webp"],
  video: "desk.mp4",
};

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
      video: "desk-zh-CN.mp4",
    });
  });

  it("falls back to the English defaults for a locale with no entry", () => {
    expect(pickTemplateMedia(LOCALIZED, "ja")).toEqual(DEFAULT);
  });

  it("uses a locale's clip and still the default screenshots when it only re-recorded the clip", () => {
    expect(pickTemplateMedia(LOCALIZED, "zh-TW")).toEqual({
      screenshots: DEFAULT.screenshots,
      video: "desk-zh-TW.mp4",
    });
  });

  it("replaces the default list whole rather than merging per index", () => {
    // One localized cover, no localized second shot: the viewer sees ONE image,
    // never "Korean cover, English overview".
    expect(pickTemplateMedia(LOCALIZED, "ko")).toEqual({
      screenshots: ["cover-ko.webp"],
      video: "desk.mp4",
    });
  });

  it("returns the defaults unchanged for a template with no locales", () => {
    expect(pickTemplateMedia(DEFAULT, "zh-CN")).toEqual(DEFAULT);
    expect(pickTemplateMedia({ screenshots: [] }, "zh-CN")).toEqual({ screenshots: [] });
  });

  it("matches exact locale keys only, like iStringParse", () => {
    expect(pickTemplateMedia(LOCALIZED, "zh")).toEqual(DEFAULT);
    expect(pickTemplateMedia(LOCALIZED, undefined)).toEqual(DEFAULT);
  });

  it("treats an empty localized list or clip as undeclared", () => {
    const empty = { ...DEFAULT, locales: { "zh-CN": { screenshots: [], video: "" } } };
    expect(pickTemplateMedia(empty, "zh-CN")).toEqual(DEFAULT);
  });

  it("ignores a malformed locales value instead of throwing", () => {
    const malformed = [
      "zh-CN",
      ["cover-zh-CN.webp"],
      { "zh-CN": "cover-zh-CN.webp" },
      { "zh-CN": { screenshots: "cover-zh-CN.webp", video: 42 } },
    ];
    for (const locales of malformed) {
      expect(
        pickTemplateMedia({ ...DEFAULT, locales } as unknown as typeof DEFAULT, "zh-CN"),
      ).toEqual(DEFAULT);
    }
  });

  it("never resolves a viewer locale through the object prototype", () => {
    expect(pickTemplateMedia(LOCALIZED, "constructor")).toEqual(DEFAULT);
    expect(pickTemplateMedia(LOCALIZED, "__proto__")).toEqual(DEFAULT);
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
      }),
    ).toEqual({
      "zh-CN": { screenshots: ["cover-zh-CN.webp"], video: "desk-zh-CN.mp4" },
      de: { video: "desk-de.mp4" },
    });
  });

  it("is undefined when no entry survives, so a card carries no empty locales key", () => {
    expect(parseTemplateLocales({ "zh-CN": { screenshots: [] } })).toBeUndefined();
  });
});
