// @vitest-environment jsdom
// Where a Function step's code runs: offered as a sandbox exactly when an
// AirApp's remote engine is, locked by plan with the way to upgrade, or
// explained when the server has none.
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { AirAppRunnerKind } from "busabase-contract/domains/airapp/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { AirAppEngineAvailabilityProvider } from "../../airapp/components/engine-availability-context";
import { WorkflowFunctionRunIn, type WorkflowFunctionRunInValue } from "./workflow-function-run-in";

const copy = coreMessagesByLocale.en.richNodes;

const server: WorkflowFunctionRunInValue = {
  runIn: "server",
  language: "javascript",
  packages: "",
};

const renderRunIn = (
  value: WorkflowFunctionRunInValue,
  onChange = vi.fn(),
  engines: AirAppRunnerKind[] = ["browser", "remote"],
  planGate?: { lockedEngines: AirAppRunnerKind[]; planLabel: string; onUpgrade?: () => void },
) =>
  render(
    <CoreI18nProvider locale="en">
      <AirAppEngineAvailabilityProvider engines={engines} planGate={planGate}>
        <WorkflowFunctionRunIn onChange={onChange} value={value} />
      </AirAppEngineAvailabilityProvider>
    </CoreI18nProvider>,
  );

const option = (container: HTMLElement, value: string) =>
  container.querySelector<HTMLOptionElement>(`[data-workflow-run-in] option[value="${value}"]`);

afterEach(cleanup);

describe("run on", () => {
  it("offers a sandbox where the remote engine runs, then asks for language and packages", () => {
    const onChange = vi.fn();
    const { container, rerender } = renderRunIn(server, onChange);
    expect(option(container, "sandbox")?.disabled).toBe(false);
    expect(container.querySelector("[data-workflow-sandbox-language]")).toBeNull();

    fireEvent.change(container.querySelector("[data-workflow-run-in]") as HTMLSelectElement, {
      target: { value: "sandbox" },
    });
    expect(onChange).toHaveBeenCalledWith({ runIn: "sandbox" });

    rerender(
      <CoreI18nProvider locale="en">
        <AirAppEngineAvailabilityProvider engines={["browser", "remote"]}>
          <WorkflowFunctionRunIn
            onChange={onChange}
            value={{ runIn: "sandbox", language: "python", packages: "" }}
          />
        </AirAppEngineAvailabilityProvider>
      </CoreI18nProvider>,
    );
    expect(container.textContent).toContain(copy.runInSandboxHint);
    expect(container.textContent).toContain(copy.sandboxPackagesHintPython);
    fireEvent.change(
      container.querySelector("[data-workflow-sandbox-packages]") as HTMLInputElement,
      { target: { value: "requests" } },
    );
    expect(onChange).toHaveBeenLastCalledWith({ packages: "requests" });
  });

  it("shows the sandbox locked by plan, with the way to upgrade", () => {
    const onUpgrade = vi.fn();
    const { container } = renderRunIn(server, vi.fn(), ["browser", "remote"], {
      lockedEngines: ["remote"],
      planLabel: "Plus",
      onUpgrade,
    });
    expect(option(container, "sandbox")?.disabled).toBe(true);
    const locked = container.querySelector("[data-workflow-run-in-locked]");
    expect(locked?.textContent).toContain("needs the Plus plan");
    fireEvent.click(locked?.querySelector("button") as HTMLButtonElement);
    expect(onUpgrade).toHaveBeenCalled();
  });

  it("explains a server with no sandbox, and keeps a step saved as sandbox readable", () => {
    const { container } = renderRunIn(
      { runIn: "sandbox", language: "javascript", packages: "dayjs" },
      vi.fn(),
      ["browser"],
    );
    expect(container.querySelector("[data-workflow-run-in-unavailable]")?.textContent).toBe(
      copy.runInSandboxNotConfigured,
    );
    expect(option(container, "sandbox")?.disabled).toBe(false);
    expect(
      (container.querySelector("[data-workflow-sandbox-packages]") as HTMLInputElement).value,
    ).toBe("dayjs");
  });
});
