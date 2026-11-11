import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, type CoreLocale } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import {
  AirAppEngineSetting,
  FOLLOW_APP,
  resolveAvailableAirAppRunnerKind,
  resolveFollowedAppEngine,
} from "./AirAppEngineSetting";
import type { ResolvedAirAppEnginePlanGate } from "./engine-availability-context";
import type { AirAppRunnerKind } from "./runners/types";

describe("AirAppEngineSetting", () => {
  it("renders the selected deployment-supported engine in node General settings", () => {
    const markup = renderToStaticMarkup(
      <CoreI18nProvider locale="en">
        <AirAppEngineSetting
          availableEngines={["browser", "remote"]}
          onValueChange={vi.fn()}
          value="remote"
        />
      </CoreI18nProvider>,
    );

    expect(markup).toContain("data-airapp-engine-setting");
    expect(markup).toContain("Engine");
    expect(markup).toContain("Cloud sandbox");
    expect(markup).toContain("A temporary cloud machine per run");
  });

  it("still renders with one engine, because it also says whether the app decides", () => {
    // This used to render nothing below two engines, on the reasoning that a
    // one-option dropdown is not a choice. That was right while the control ONLY
    // picked an engine. It now also reports whether this node follows its
    // `airapp.json` or overrides it — which is worth showing even when there is
    // nothing to switch to, and is the one thing that was invisible before.
    const markup = renderToStaticMarkup(
      <CoreI18nProvider locale="en">
        <AirAppEngineSetting
          availableEngines={["browser"]}
          onValueChange={vi.fn()}
          value={FOLLOW_APP}
        />
      </CoreI18nProvider>,
    );

    expect(markup).toContain("Follow the app");
  });

  it("names the engine the app asks for, instead of an unexplained 'follow the app'", () => {
    // Without this the dialog could say "follow the app" while `airapp.json`
    // said `remote` — the screen not matching what will happen, which is the
    // whole defect this control exists to end.
    const markup = renderToStaticMarkup(
      <CoreI18nProvider locale="en">
        <AirAppEngineSetting
          appPreferred="remote"
          availableEngines={["browser", "remote"]}
          onValueChange={vi.fn()}
          value={FOLLOW_APP}
        />
      </CoreI18nProvider>,
    );

    expect(markup).toContain("Follow the app (Cloud sandbox)");
  });

  it("renders a manifest requirement as read-only and ignores a saved override", () => {
    const markup = renderToStaticMarkup(
      <CoreI18nProvider locale="en">
        <AirAppEngineSetting
          appRequired="remote"
          availableEngines={["browser", "remote"]}
          onValueChange={vi.fn()}
          value="browser"
        />
      </CoreI18nProvider>,
    );

    expect(markup).toContain("data-airapp-engine-required");
    expect(markup).toContain("App requires Cloud sandbox");
    expect(markup).toContain("cannot be overridden");
    expect(markup).not.toContain("Follow the app");
    expect(markup).not.toContain("node-settings-airapp-engine");
  });

  it("explains how to enable a required Cloud sandbox when Sandock is unavailable", () => {
    const markup = renderToStaticMarkup(
      <CoreI18nProvider locale="en">
        <AirAppEngineSetting
          appRequired="remote"
          availableEngines={["browser"]}
          onValueChange={vi.fn()}
          value={FOLLOW_APP}
        />
      </CoreI18nProvider>,
    );

    expect(markup).toContain("App requires Cloud sandbox");
    expect(markup).toContain("Sandock is not configured on this deployment.");
    expect(markup).not.toContain("node-settings-airapp-engine");
  });

  it("falls back to a currently available engine when saved configuration is stale", () => {
    expect(resolveAvailableAirAppRunnerKind("remote", ["browser"])).toBe("browser");
    expect(resolveAvailableAirAppRunnerKind("remote", ["browser", "remote"])).toBe("remote");
  });
});

describe("following an app whose preferred engine is out of reach", () => {
  /** Busabase Cloud with the site host and Sandock configured. */
  const FREE_GATE: ResolvedAirAppEnginePlanGate = {
    lockedEngines: ["remote", "site"],
    planLabel: "Plus",
    onUpgrade: vi.fn(),
  };
  const PLUS_GATE: ResolvedAirAppEnginePlanGate = { lockedEngines: [], planLabel: "Plus" };

  const renderFollow = ({
    availableEngines,
    planGate,
    locale = "en",
  }: {
    availableEngines: AirAppRunnerKind[];
    planGate: ResolvedAirAppEnginePlanGate;
    locale?: CoreLocale;
  }) =>
    renderToStaticMarkup(
      <CoreI18nProvider locale={locale}>
        <AirAppEngineSetting
          appPreferred="site"
          availableEngines={availableEngines}
          onValueChange={vi.fn()}
          planGate={planGate}
          value={FOLLOW_APP}
        />
      </CoreI18nProvider>,
    );

  it("names the engine a Free space actually runs, not the Website it cannot have", () => {
    // Observed on 2026-11-06: the dialog said "Follow the app (Website)" while
    // the app was running in the browser.
    const markup = renderFollow({ availableEngines: ["browser"], planGate: FREE_GATE });

    expect(markup).toContain("Follow the app (In browser)");
    expect(markup).not.toContain("Follow the app (Website)");
    expect(markup).toContain('data-airapp-engine-followed="browser"');
    expect(markup).toContain(
      "This app&#x27;s airapp.json prefers Website, which isn&#x27;t available here. Engine in use: In browser.",
    );
    // The way out is still offered, next to it.
    expect(markup).toContain("Website is available on Plus and above.");
    expect(markup).toContain("Upgrade to Plus");
  });

  it("says the same in the viewer's language", () => {
    const markup = renderFollow({
      availableEngines: ["browser"],
      planGate: { ...FREE_GATE, planLabel: "Plus 版" },
      locale: "zh-CN",
    });

    expect(markup).toContain("跟随 App（浏览器内）");
    expect(markup).toContain(
      "该 App 的 airapp.json 首选网站，但这里用不了。实际使用的引擎：浏览器内。",
    );
    expect(markup).toContain("网站仅在 Plus 版及以上套餐中提供。");
  });

  it("is unchanged on Plus, where the app gets the Website it asks for", () => {
    const markup = renderFollow({
      availableEngines: ["browser", "remote", "site"],
      planGate: PLUS_GATE,
    });

    expect(markup).toContain("Follow the app (Website)");
    expect(markup).toContain('data-airapp-engine-followed="site"');
    expect(markup).toContain("This app&#x27;s airapp.json decides.");
    expect(markup).not.toContain("Engine in use");
    expect(markup).not.toContain("Upgrade to Plus");
  });

  it("resolves the way a run does: a Python app never falls back to the browser", () => {
    // The run stops at the upgrade state, so the preference is still the honest name.
    expect(
      resolveFollowedAppEngine({
        appPreferred: "site",
        appRuntime: "python",
        availableEngines: ["browser"],
        lockedEngines: ["remote", "site"],
      }),
    ).toBe("site");
    expect(
      resolveFollowedAppEngine({
        appPreferred: "site",
        availableEngines: ["browser"],
        lockedEngines: ["remote", "site"],
      }),
    ).toBe("browser");
    expect(resolveFollowedAppEngine({ availableEngines: ["browser"] })).toBeUndefined();
  });

  it.each(Object.entries(coreMessagesByLocale))(
    "%s words the fallback with both engines",
    (locale, messages) => {
      const text = messages.airapp.engineFollowAppFallback;
      expect(text).toContain("{preferred}");
      expect(text).toContain("{engine}");
      if (locale !== "en")
        expect(text).not.toBe(coreMessagesByLocale.en.airapp.engineFollowAppFallback);
    },
  );
});
