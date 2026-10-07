// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SplitSubmitButton } from "./split-submit-button";

/**
 * The dropdown used to be a hand-rolled `absolute`-positioned div
 * toggled by local state. These tests exercise the real, rendered Radix
 * portal content (not just the pure `resolveSubmitActionOrder` policy that
 * `split-submit-button.test.tsx` already covers) so a regression in the
 * actual open/close/click DOM flow has coverage again.
 */
const renderButton = (props: Partial<Parameters<typeof SplitSubmitButton>[0]> = {}) => {
  const onImmediate = vi.fn();
  const onChangeRequest = vi.fn();
  render(
    <CoreI18nProvider locale="en">
      <SplitSubmitButton
        changeRequestAction={{ label: "Change Request", onSubmit: onChangeRequest }}
        immediateAction={{ label: "Save", onSubmit: onImmediate }}
        {...props}
      />
    </CoreI18nProvider>,
  );
  return { onImmediate, onChangeRequest };
};

// Radix opens the dropdown on pointerdown (so it can react before an
// outside-click handler sees the same gesture), not on a synthesized click.
const openDropdown = () =>
  fireEvent.pointerDown(screen.getByRole("button", { name: "More submit options" }), {
    button: 0,
  });

describe("SplitSubmitButton — dropdown", () => {
  afterEach(cleanup);

  it("renders the hint and change-request item inside the portal once opened", async () => {
    renderButton({ hint: "Change requests need review before merging." });

    expect(screen.queryByText("Change requests need review before merging.")).toBeNull();
    openDropdown();

    await waitFor(() => expect(screen.getByRole("menu")).not.toBeNull());
    expect(screen.getByText("Change requests need review before merging.")).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Change Request" })).not.toBeNull();
  });

  it("invokes the secondary action and closes on item select", async () => {
    const { onChangeRequest, onImmediate } = renderButton();
    openDropdown();

    await waitFor(() => expect(screen.getByRole("menu")).not.toBeNull());
    fireEvent.click(screen.getByRole("menuitem", { name: "Change Request" }));

    expect(onChangeRequest).toHaveBeenCalledTimes(1);
    expect(onImmediate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("closes on Escape", async () => {
    renderButton();
    openDropdown();

    await waitFor(() => expect(screen.getByRole("menu")).not.toBeNull());
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("closes on an outside click", async () => {
    renderButton();
    openDropdown();

    await waitFor(() => expect(screen.getByRole("menu")).not.toBeNull());
    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("renders a single plain button with no dropdown for change-request-only permission", () => {
    renderButton({ permissionLevel: "changeRequest" });

    expect(screen.getByRole("button", { name: "Change Request" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "More submit options" })).toBeNull();
  });

  it("renders nothing for read-only permission", () => {
    const { container } = render(
      <CoreI18nProvider locale="en">
        <SplitSubmitButton
          changeRequestAction={{ label: "Change Request", onSubmit: vi.fn() }}
          immediateAction={{ label: "Save", onSubmit: vi.fn() }}
          permissionLevel="read"
        />
      </CoreI18nProvider>,
    );

    expect(container.firstChild).toBeNull();
  });

  it("disables both the primary and dropdown trigger while loading, and the trigger cannot open", async () => {
    renderButton({ immediateAction: { label: "Save", onSubmit: vi.fn(), isLoading: true } });

    expect((screen.getByRole("button", { name: "Working..." }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const trigger = screen.getByRole("button", {
      name: "More submit options",
    }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);

    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("disables both buttons when disabled is passed explicitly", () => {
    renderButton({ disabled: true });

    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "More submit options" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
