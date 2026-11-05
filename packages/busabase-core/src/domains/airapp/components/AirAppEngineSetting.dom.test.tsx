// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, type CoreLocale } from "../../../i18n";
import type { AirAppEnginePlanGate } from "../utils/engine-plan-gate";
import { type AirAppEngineChoice, AirAppEngineSetting, FOLLOW_APP } from "./AirAppEngineSetting";
import {
  AirAppEngineAvailabilityProvider,
  useAirAppEngineAvailability,
  useAirAppEnginePlanGate,
  useAirAppEnginesNotConfigured,
} from "./engine-availability-context";
import type { AirAppRunnerKind } from "./runners/types";

// Radix Select reads pointer capture and scrolls the active item into view;
// jsdom implements neither.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

/** What the node settings dialog does: read both hooks, hand them to the field. */
function SettingFromContext({ appRequired }: { appRequired?: AirAppRunnerKind }) {
  const availableEngines = useAirAppEngineAvailability();
  const planGate = useAirAppEnginePlanGate();
  const notConfiguredEngines = useAirAppEnginesNotConfigured();
  const [value, setValue] = useState<AirAppEngineChoice>(FOLLOW_APP);
  return (
    <AirAppEngineSetting
      appRequired={appRequired}
      availableEngines={availableEngines}
      notConfiguredEngines={notConfiguredEngines}
      onValueChange={setValue}
      planGate={planGate}
      value={value}
    />
  );
}

const renderSetting = ({
  engines,
  planGate,
  appRequired,
  locale = "en",
}: {
  engines: AirAppRunnerKind[];
  planGate?: AirAppEnginePlanGate;
  appRequired?: AirAppRunnerKind;
  locale?: CoreLocale;
}) =>
  render(
    <CoreI18nProvider locale={locale}>
      <AirAppEngineAvailabilityProvider engines={engines} planGate={planGate}>
        <SettingFromContext appRequired={appRequired} />
      </AirAppEngineAvailabilityProvider>
    </CoreI18nProvider>,
  );

afterEach(cleanup);

describe("AirAppEngineSetting on a space whose plan locks remote", () => {
  it("shows remote as locked with the upgrade, instead of silently dropping it", () => {
    const onUpgrade = vi.fn();
    renderSetting({
      engines: ["browser", "remote"],
      planGate: { lockedEngines: ["remote"], planLabel: "Plus", onUpgrade },
    });

    expect(screen.getByText("Cloud sandbox is available on Plus and above.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Plus" }));
    expect(onUpgrade).toHaveBeenCalledOnce();

    // Open the picker: remote is listed, named with its plan, and cannot be picked.
    fireEvent.pointerDown(screen.getByRole("combobox"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    const locked = screen.getByRole("option", { name: "Cloud sandbox · Plus and above" });
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    expect(locked.hasAttribute("data-disabled")).toBe(true);
    const browser = screen.getByRole("option", { name: "In browser" });
    expect(browser.hasAttribute("data-disabled")).toBe(false);
  });

  it("turns a locked required engine into the upgrade, not 'Sandock is not configured'", () => {
    // The deployment HAS a Sandock; telling this person it doesn't would be
    // false, and would send them to an operator instead of the upgrade.
    const onUpgrade = vi.fn();
    renderSetting({
      engines: ["browser", "remote"],
      planGate: { lockedEngines: ["remote"], planLabel: "Plus", onUpgrade },
      appRequired: "remote",
    });

    expect(screen.getByText("App requires Cloud sandbox")).toBeTruthy();
    expect(screen.getByText("Cloud sandbox is available on Plus and above.")).toBeTruthy();
    expect(screen.queryByText(/Sandock is not configured/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Plus" }));
    expect(onUpgrade).toHaveBeenCalledOnce();
  });

  it("uses the host's own plan name in the viewer's language", () => {
    renderSetting({
      engines: ["browser", "remote"],
      planGate: { lockedEngines: ["remote"], planLabel: "Plus 版", onUpgrade: vi.fn() },
      locale: "zh-CN",
    });

    expect(screen.getByText("云端沙箱仅在 Plus 版及以上套餐中提供。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "升级到 Plus 版" })).toBeTruthy();
  });
});

describe("AirAppEngineSetting where nothing is locked", () => {
  it("offers remote normally once the plan includes it", () => {
    renderSetting({
      engines: ["browser", "remote"],
      planGate: { lockedEngines: [], planLabel: "Plus", onUpgrade: vi.fn() },
    });

    expect(screen.queryByText(/available on Plus and above/)).toBeNull();
    fireEvent.pointerDown(screen.getByRole("combobox"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    const remote = screen.getByRole("option", { name: "Cloud sandbox" });
    expect(remote.hasAttribute("data-disabled")).toBe(false);
  });

  it("does not advertise an upgrade for an engine the deployment does not have", () => {
    // No Sandock configured: nothing to sell, so no lock and no upsell.
    renderSetting({
      engines: ["browser"],
      planGate: { lockedEngines: ["remote"], planLabel: "Plus", onUpgrade: vi.fn() },
    });

    expect(screen.queryByText(/available on Plus and above/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Upgrade to Plus" })).toBeNull();
  });

  it("is unchanged for a host with no plan gate", () => {
    renderSetting({ engines: ["browser", "remote"] });

    expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    fireEvent.pointerDown(screen.getByRole("combobox"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    expect(screen.getByRole("option", { name: "Cloud sandbox" })).toBeTruthy();
  });
});

describe("engines an operator could still turn on", () => {
  const openPicker = () => fireEvent.click(screen.getByRole("combobox"));
  const renderWith = (props: {
    engines: AirAppRunnerKind[];
    notConfiguredEngines?: AirAppRunnerKind[];
    planGate?: AirAppEnginePlanGate;
  }) =>
    render(
      <CoreI18nProvider locale="en">
        <AirAppEngineAvailabilityProvider
          engines={props.engines}
          notConfiguredEngines={props.notConfiguredEngines}
          planGate={props.planGate}
        >
          <SettingFromContext />
        </AirAppEngineAvailabilityProvider>
      </CoreI18nProvider>,
    );

  it("lists them disabled, with the reason inline, instead of hiding them", () => {
    renderWith({ engines: ["browser"], notConfiguredEngines: ["remote", "site"] });
    openPicker();
    for (const name of ["Cloud sandbox", "Website"]) {
      const option = screen.getByRole("option", {
        name: `${name} · Not configured — ask an administrator`,
      });
      expect(option.getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("does not disable a configured engine", () => {
    renderWith({ engines: ["browser", "remote", "site"], notConfiguredEngines: [] });
    openPicker();
    expect(
      screen.getByRole("option", { name: "Website" }).getAttribute("aria-disabled"),
    ).toBeNull();
    expect(screen.queryByText(/Not configured/)).toBeNull();
  });

  it("keeps an engine this deployment can never offer hidden", () => {
    renderWith({ engines: ["browser"], notConfiguredEngines: ["remote"] });
    openPicker();
    expect(screen.queryByRole("option", { name: /This machine/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Website/ })).toBeNull();
  });

  it("shows a plan-locked site with the plan, not as not configured", () => {
    renderWith({
      engines: ["browser", "site"],
      planGate: { lockedEngines: ["site"], planLabel: "Plus" },
    });
    openPicker();
    expect(
      screen
        .getByRole("option", { name: "Website · Plus and above" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("does not lock a site on a plan that includes it", () => {
    renderWith({
      engines: ["browser", "site"],
      planGate: { lockedEngines: [], planLabel: "Plus" },
    });
    openPicker();
    expect(
      screen.getByRole("option", { name: "Website" }).getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("never offers an upgrade for an engine the deployment does not have", () => {
    renderWith({
      engines: ["browser"],
      notConfiguredEngines: ["site"],
      planGate: { lockedEngines: ["site"], planLabel: "Plus" },
    });
    openPicker();
    expect(
      screen.getByRole("option", { name: "Website · Not configured — ask an administrator" }),
    ).toBeTruthy();
    expect(screen.queryByText(/Plus and above/)).toBeNull();
  });
});
