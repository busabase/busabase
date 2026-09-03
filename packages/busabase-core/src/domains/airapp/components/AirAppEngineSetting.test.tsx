import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import {
  AirAppEngineSetting,
  FOLLOW_APP,
  resolveAvailableAirAppRunnerKind,
} from "./AirAppEngineSetting";

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
    expect(markup).toContain("Remote machine");
    expect(markup).toContain("Provisioned per run");
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

    expect(markup).toContain("Follow the app (Remote machine)");
  });

  it("falls back to a currently available engine when saved configuration is stale", () => {
    expect(resolveAvailableAirAppRunnerKind("remote", ["browser"])).toBe("browser");
    expect(resolveAvailableAirAppRunnerKind("remote", ["browser", "remote"])).toBe("remote");
  });
});
