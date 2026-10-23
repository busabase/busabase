/**
 * Which screenshots and demo clip a template shows to a given viewer (pure,
 * isomorphic — imported by the server catalog, the Dashboard, the marketing
 * site and the mobile app alike).
 *
 * The rule is the one App Store and Google Play use for localized screenshots,
 * and it is the same fallback `iStringParse` gives a template's text:
 *
 *   1. The viewer's locale has an entry in `locales` → use its `screenshots`
 *      and/or `video`. A locale's `screenshots` list REPLACES the default list
 *      whole; it is never merged index by index, because "cover in Chinese,
 *      second shot in English" is a gallery nobody designed.
 *   2. Anything that entry leaves out — and every locale with no entry at all —
 *      falls back to the top-level `screenshots` / `video` / `videos`, which are
 *      the English/default set.
 *
 * Clips follow the same whole-list rule as screenshots: a locale's `videos`
 * (or its single `video`) replaces the default clips, it is never merged with
 * them. `videos` wins over `video` within one level, and at most
 * `TEMPLATE_VIDEO_LIMIT` are returned, so a list over the limit renders its
 * first three rather than failing.
 *
 * Exact locale keys only, mirroring `iStringParse`: `"zh"` does not match
 * `"zh-CN"`. The callers pass the same resolved locale they already hand to
 * `iStringParse`, so text and pictures can never disagree about the language.
 *
 * Spec: `apps/busabase/content/spec/template-center.md` §16.
 */
import {
  TEMPLATE_VIDEO_LIMIT,
  type TemplateLocaleMedia,
  type TemplateLocales,
  type TemplateVideo,
} from "../package/template";

/**
 * What a surface renders: one gallery and its clips (at most
 * `TEMPLATE_VIDEO_LIMIT`, in display order), already chosen.
 */
export interface TemplateMedia {
  screenshots: string[];
  videos: TemplateVideo[];
}

/** Anything carrying the default media plus optional per-locale overrides. */
export interface TemplateMediaSource {
  screenshots: readonly string[];
  video?: string;
  videos?: readonly TemplateVideo[];
  locales?: Readonly<Record<string, TemplateLocaleMedia | undefined>>;
}

const nonEmptyStrings = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === "string" && item !== "");
  return list.length > 0 ? list : undefined;
};

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Normalize an untrusted clip list, or `undefined` when nothing usable is left.
 * Entries without a string `src` are dropped, a non-string `title` is ignored —
 * one bad clip must not hide the good ones next to it.
 */
export const parseTemplateVideos = (raw: unknown): TemplateVideo[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const videos: TemplateVideo[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const src = nonEmptyString(item.src);
    if (!src) continue;
    const title = nonEmptyString(item.title);
    videos.push({ src, ...(title ? { title } : {}) });
  }
  return videos.length > 0 ? videos : undefined;
};

/**
 * The clips one level declares: `videos` when it has any, else its single
 * `video` as a one-entry list, else `undefined` ("declares none" — the caller
 * falls back a level). The one place the shorthand and the list meet.
 */
export const declaredVideos = (video: unknown, videos: unknown): TemplateVideo[] | undefined => {
  const list = parseTemplateVideos(videos);
  if (list) return list;
  const single = nonEmptyString(video);
  return single ? [{ src: single }] : undefined;
};

/**
 * Normalize an untrusted `locales` value, or `undefined` when nothing usable is
 * left.
 *
 * Never throws — the catalog is fetched JSON from a repository the server does
 * not control, and one malformed entry must not blank the gallery for every
 * other card. A non-object `locales`, a non-object entry, a non-array
 * `screenshots` or a non-string `video` is ignored, and the viewer gets the
 * defaults. An empty `screenshots: []` or `video: ""` counts as "not declared":
 * a locale that ships no gallery should see the default one, not a placeholder.
 */
export const parseTemplateLocales = (raw: unknown): TemplateLocales | undefined => {
  if (!isPlainObject(raw)) return undefined;
  const locales: TemplateLocales = {};
  for (const [locale, entry] of Object.entries(raw)) {
    if (!locale || !isPlainObject(entry)) continue;
    const screenshots = nonEmptyStrings(entry.screenshots);
    const video = nonEmptyString(entry.video);
    const videos = parseTemplateVideos(entry.videos);
    if (!screenshots && !video && !videos) continue;
    locales[locale] = {
      ...(screenshots ? { screenshots } : {}),
      ...(video ? { video } : {}),
      ...(videos ? { videos } : {}),
    };
  }
  return Object.keys(locales).length > 0 ? locales : undefined;
};

/**
 * The media `locale` sees for `template` — see the module comment for the rule.
 *
 * Tolerant of a malformed `locales` for the same reason `parseTemplateLocales`
 * is: a card from an older server has no `locales` at all, and one from a
 * misbehaving catalog may have garbage in it. Both render the defaults.
 */
export const pickTemplateMedia = (
  template: TemplateMediaSource,
  locale: string | undefined,
): TemplateMedia => {
  const locales = isPlainObject(template.locales) ? template.locales : undefined;
  // Own keys only — a viewer locale must never resolve to `Object.prototype`
  // (`"constructor"`), which a plain `locales[locale]` lookup would.
  const own =
    locale && locales ? Object.entries(locales).find(([key]) => key === locale)?.[1] : undefined;
  const entry = isPlainObject(own) ? own : undefined;
  const screenshots = nonEmptyStrings(entry?.screenshots) ?? [...template.screenshots];
  const videos =
    declaredVideos(entry?.video, entry?.videos) ??
    declaredVideos(template.video, template.videos) ??
    [];
  return { screenshots, videos: videos.slice(0, TEMPLATE_VIDEO_LIMIT) };
};
