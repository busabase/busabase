import type {
  AirAppSiteBlocker,
  AirAppSiteStateVO,
} from "busabase-contract/domains/airapp/contract";
import { describe, expect, it, vi } from "vitest";
import { dashboardDe } from "../../../i18n/de";
import { dashboardEs } from "../../../i18n/es";
import { dashboardFr } from "../../../i18n/fr";
import { dashboardJa } from "../../../i18n/ja";
import { dashboardKo } from "../../../i18n/ko";
import { coreMessagesEn as en } from "../../../i18n/messages";
import { dashboardPt } from "../../../i18n/pt";
import { dashboardVi } from "../../../i18n/vi";
import { dashboardZhCN as zhCN } from "../../../i18n/zh-CN";
import { dashboardZhTW } from "../../../i18n/zh-TW";
import { airAppSiteBlockerMessage, canGoLive, goLiveNote } from "./AirAppSiteControls";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const LOCALES = {
  en,
  de: dashboardDe,
  es: dashboardEs,
  fr: dashboardFr,
  ja: dashboardJa,
  ko: dashboardKo,
  pt: dashboardPt,
  vi: dashboardVi,
  "zh-CN": zhCN,
  "zh-TW": dashboardZhTW,
};

const EVERY_BLOCKER: AirAppSiteBlocker[] = [
  { code: "not-a-site-app" },
  { code: "invalid-manifest", detail: "DETAIL" },
  { code: "python-runtime" },
  { code: "unsafe-path", path: "PATH" },
  { code: "entry-missing", path: "PATH" },
  { code: "entry-not-javascript", path: "PATH" },
  { code: "entry-syntax-error", path: "PATH", detail: "DETAIL" },
  { code: "entry-no-default-export", path: "PATH" },
  { code: "unsupported-import", path: "PATH", specifier: "node:fs" },
  { code: "no-index-page", path: "PATH" },
  { code: "asset-too-large", path: "PATH", size: 30 * 1024 * 1024 },
  { code: "too-many-assets", count: 100001 },
];

describe("site blocker messages", () => {
  describe.each(Object.entries(LOCALES))("%s", (_name, messages) => {
    it.each(EVERY_BLOCKER.map((blocker) => [blocker.code, blocker] as const))(
      "words %s with every value filled in",
      (_code, blocker) => {
        const text = airAppSiteBlockerMessage(messages, blocker);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/\{\w+\}/);
        if ("path" in blocker) expect(text).toContain(blocker.path);
        if ("detail" in blocker) expect(text).toContain(blocker.detail);
        if ("specifier" in blocker) expect(text).toContain(blocker.specifier);
        if ("count" in blocker) expect(text).toContain(String(blocker.count));
      },
    );
  });

  it("is actually translated, not English left in place", () => {
    const blocker: AirAppSiteBlocker = { code: "python-runtime" };
    for (const [name, messages] of Object.entries(LOCALES)) {
      if (name === "en") continue;
      expect(airAppSiteBlockerMessage(messages, blocker)).not.toBe(
        airAppSiteBlockerMessage(en, blocker),
      );
    }
  });
});

describe("engine hints state facts, not a purpose", () => {
  it.each(Object.entries(LOCALES))("%s has a website engine and its reason", (_name, messages) => {
    expect(messages.airapp.engineSite.length).toBeGreaterThan(0);
    expect(messages.airapp.engineSiteHint.length).toBeGreaterThan(0);
    expect(messages.airapp.engineNotConfigured.length).toBeGreaterThan(0);
    expect(messages.airapp.requiredEngineUnavailable.site.length).toBeGreaterThan(0);
  });

  it("does not claim development, preview, or internal use", () => {
    expect(en.airapp.engineSiteHint).not.toMatch(/develop|preview|internal/i);
    expect(zhCN.airapp.engineSiteHint).not.toMatch(/开发|预览|内部/);
  });
});

const state = (overrides: Partial<AirAppSiteStateVO> = {}): AirAppSiteStateVO => ({
  engine: "available",
  address: "https://site-x.sites.test",
  publication: "not-live",
  isPublic: false,
  previewUrl: "/api/airapp-preview/n/",
  previewVersion: "v1",
  liveVersion: null,
  currentVersion: "v1",
  previewStale: false,
  previewDeployedAt: null,
  liveDeployedAt: null,
  blockers: [],
  ...overrides,
});

describe("canGoLive", () => {
  it("is on for a fresh preview that has not gone live", () => {
    expect(canGoLive(state())).toBe(true);
  });

  it("is on for a new version of a live site", () => {
    expect(canGoLive(state({ liveVersion: "v0", isPublic: true }))).toBe(true);
  });

  it("is on to bring a version back after the switch was turned off", () => {
    expect(canGoLive(state({ liveVersion: "v1", isPublic: false }))).toBe(true);
  });

  it("is off when there is no preview, or it is stale, or it is already live", () => {
    expect(canGoLive(state({ previewVersion: null }))).toBe(false);
    expect(canGoLive(state({ previewStale: true }))).toBe(false);
    expect(canGoLive(state({ liveVersion: "v1", isPublic: true }))).toBe(false);
  });

  it("is off on a plan that leaves the engine out", () => {
    expect(canGoLive(state({ engine: "locked" }))).toBe(false);
  });
});

describe("goLiveNote", () => {
  it("tells the person to run it again once the files have changed", () => {
    expect(goLiveNote(en, state({ previewStale: true }))).toBe(en.airapp.site.previewStale);
  });

  it("tells them to run it first when there is no preview", () => {
    expect(goLiveNote(en, state({ previewVersion: null }))).toBe(en.airapp.site.noPreview);
  });

  it("says nothing when Go live is ready", () => {
    expect(goLiveNote(en, state())).toBeNull();
  });

  it("leaves blockers to their own message", () => {
    expect(
      goLiveNote(en, state({ blockers: [{ code: "python-runtime" }], previewStale: true })),
    ).toBeNull();
  });
});
