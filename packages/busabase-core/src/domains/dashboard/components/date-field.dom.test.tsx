// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { DateFieldInput, DateFieldOptionsEditor, DateFieldValue } from "./date-field";
import { DayTimePicker } from "./day-time-picker";

afterEach(cleanup);

describe("DateFieldInput", () => {
  it("a day field shows legacy ISO days in the UI locale and writes YYYY-MM-DD", () => {
    const onChange = vi.fn();
    render(
      <DateFieldInput
        ariaLabel="Due"
        className=""
        id="due"
        onChange={onChange}
        value="2026-10-02T00:00:00.000Z"
      />,
    );
    const trigger = screen.getByLabelText("Due");
    // Not a native <input type="date">: the browser draws that in its own language.
    expect(trigger.tagName).toBe("BUTTON");
    // Used to render blank: an ISO value is not a valid <input type="date"> value.
    expect(trigger.getAttribute("data-value")).toBe("2026-10-02");
    expect(trigger.textContent).toBe("Fri, Oct 2, 2026");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: /October 5th, 2026/ }));
    expect(onChange).toHaveBeenCalledWith("2026-10-05");
  });

  it("an empty day field invites a pick and offers no Clear", () => {
    render(<DateFieldInput ariaLabel="Due" className="" id="due" onChange={vi.fn()} value="" />);
    const trigger = screen.getByLabelText("Due");
    expect(trigger.textContent).toBe("Pick a date");
    fireEvent.click(trigger);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("Clear empties a set day", () => {
    const onChange = vi.fn();
    render(
      <DateFieldInput
        ariaLabel="Due"
        className=""
        id="due"
        onChange={onChange}
        value="2026-10-02"
      />,
    );
    fireEvent.click(screen.getByLabelText("Due"));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("an include-time field edits wall time in its zone and stores that zone's offset", () => {
    const onChange = vi.fn();
    render(
      <DateFieldInput
        ariaLabel="Due"
        className=""
        id="due"
        onChange={onChange}
        options={{ includeTime: true, timezone: "Asia/Shanghai" }}
        value="2026-10-02T10:00:00.000Z"
      />,
    );
    const trigger = screen.getByLabelText("Due");
    expect(trigger.getAttribute("data-value")).toBe("2026-10-02T18:00");
    fireEvent.click(trigger);
    const time = screen.getByTestId("date-field-time") as HTMLInputElement;
    expect(time.value).toBe("18:00");
    fireEvent.change(time, { target: { value: "9:30" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-10-02T09:30:00+08:00");
    fireEvent.click(screen.getByRole("button", { name: /October 3rd, 2026/ }));
    // The day keeps the time already on the value (the parent has not re-rendered).
    expect(onChange).toHaveBeenLastCalledWith("2026-10-03T09:30:00+08:00");
    expect(screen.getByText(/Time zone: Asia\/Shanghai/)).toBeTruthy();
  });

  it("an unfinished time is not written", () => {
    const onChange = vi.fn();
    render(
      <DateFieldInput
        ariaLabel="Due"
        className=""
        id="due"
        onChange={onChange}
        options={{ includeTime: true, timezone: "Asia/Shanghai" }}
        value="2026-10-02T10:00:00.000Z"
      />,
    );
    fireEvent.click(screen.getByLabelText("Due"));
    fireEvent.change(screen.getByTestId("date-field-time"), { target: { value: "25:" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("speaks the UI locale, not the browser's", async () => {
    render(
      <CoreI18nProvider locale="zh-CN">
        <DateFieldInput
          ariaLabel="截止"
          className=""
          id="due"
          onChange={vi.fn()}
          value="2026-10-02"
        />
      </CoreI18nProvider>,
    );
    const trigger = await screen.findByLabelText("截止");
    expect(trigger.textContent).toContain("2026年10月2日");
    fireEvent.click(trigger);
    expect(screen.getByRole("grid", { name: "2026年10月" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "10月" })).toBeTruthy();
    // Weeks start on Monday in zh-CN (Sunday-first would start "27 28 29 30 1 2 3").
    expect(screen.getByRole("row", { name: "28 29 30 1 2 3 4" })).toBeTruthy();
  });
});

describe("DateFieldValue", () => {
  it("renders a day in the UI locale with no day-shift badge", () => {
    render(
      <CoreI18nProvider locale="en">
        <DateFieldValue value="2026-10-02" />
      </CoreI18nProvider>,
    );
    expect(screen.getByText("Fri, Oct 2, 2026")).toBeTruthy();
    expect(screen.queryByText("+1")).toBeNull();
  });
});

describe("DateFieldOptionsEditor", () => {
  it("offers the zone picker only once include-time is on, defaulting to each viewer's zone", () => {
    const onChange = vi.fn();
    const { rerender } = render(<DateFieldOptionsEditor onChange={onChange} value={{}} />);
    expect(screen.queryByTestId("date-field-timezone")).toBeNull();
    fireEvent.click(screen.getByTestId("date-field-include-time"));
    expect(onChange).toHaveBeenLastCalledWith({ includeTime: true });

    rerender(<DateFieldOptionsEditor onChange={onChange} value={{ includeTime: true }} />);
    const select = screen.getByTestId("date-field-timezone") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.options[0]?.textContent).toBe("Each viewer's local time");
  });
});

describe("DayTimePicker", () => {
  it("cannot pick a day before minDay, and picks a day with a time", () => {
    const onPick = vi.fn();
    render(
      <DayTimePicker
        ariaLabel="Expires"
        className=""
        day=""
        id="expires"
        includeTime
        minDay="2026-10-10"
        onPick={onPick}
        text={null}
        time=""
      />,
    );
    fireEvent.click(screen.getByLabelText("Expires"));
    const earlier = document.querySelector('[data-day="2026-10-09"] button') as HTMLButtonElement;
    expect(earlier.disabled).toBe(true);
    fireEvent.click(document.querySelector('[data-day="2026-10-12"] button') as HTMLButtonElement);
    expect(onPick).toHaveBeenLastCalledWith("2026-10-12", "00:00");
  });
});
