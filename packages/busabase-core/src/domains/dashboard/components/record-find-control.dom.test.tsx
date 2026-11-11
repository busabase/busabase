// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BaseFieldVO } from "busabase-contract/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRecordFind } from "../hooks/use-record-find";
import { RecordFind } from "./record-find-control";
import { ViewConfigToolbar } from "./view-config-editor";

afterEach(cleanup);
const fields = [
  { id: "fld_name", slug: "name", name: "Customer", type: "text", options: {} },
  { id: "fld_json", slug: "config", name: "Config", type: "json", options: {} },
  { id: "fld_date", slug: "date", name: "Due", type: "date", options: {} },
] as BaseFieldVO[];

describe("record find toolbar", () => {
  it("orders visible fields like the view columns and keeps other fields in Base order", () => {
    function Harness({ visibleSlugs }: { visibleSlugs: string[] }) {
      const control = useRecordFind({
        value: { query: "", fieldId: "" },
        scope: "base:view",
        onCommit: vi.fn(),
      });
      return <RecordFind control={control} fields={fields} visibleSlugs={visibleSlugs} />;
    }
    const { rerender } = render(<Harness visibleSlugs={["date", "name"]} />);
    const optionValues = () =>
      screen.getAllByRole("option").map((option) => (option as HTMLOptionElement).value);
    expect(optionValues()).toEqual(["", "fld_date", "fld_name", "fld_json"]);

    rerender(<Harness visibleSlugs={["config"]} />);
    expect(optionValues()).toEqual(["", "fld_json", "fld_name", "fld_date"]);
    expect(screen.getByRole("option", { name: "Config" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Customer.*Not shown in this view/ })).toBeTruthy();
  });

  it("keeps the chosen field and keyword when its column moves or becomes hidden", () => {
    const commits = vi.fn();
    vi.useFakeTimers();
    function Harness({ visibleSlugs }: { visibleSlugs: string[] }) {
      const control = useRecordFind({
        value: { query: "Acme", fieldId: "fld_name" },
        scope: "base:view",
        onCommit: commits,
      });
      return <RecordFind control={control} fields={fields} visibleSlugs={visibleSlugs} />;
    }
    try {
      const { rerender } = render(<Harness visibleSlugs={["name", "config"]} />);
      const input = screen.getByTestId("base-record-find-input") as HTMLInputElement;
      input.focus();
      rerender(<Harness visibleSlugs={["config", "date"]} />);
      act(() => vi.advanceTimersByTime(1000));

      expect((screen.getByTestId("base-record-find-field") as HTMLSelectElement).value).toBe(
        "fld_name",
      );
      expect(input.value).toBe("Acme");
      expect(document.activeElement).toBe(input);
      expect(commits).not.toHaveBeenCalled();
      expect(screen.getByRole("option", { name: /Customer.*Not shown in this view/ })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("names each toolbar icon with its setting count and opens the matching control", () => {
    const onOpen = vi.fn();
    render(
      <ViewConfigToolbar
        config={{ visibleFieldSlugs: ["name"], filters: [], sorts: [] }}
        fields={fields}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fields: 1/3" }));
    fireEvent.click(screen.getByRole("button", { name: "Filter: 0" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort: 0" }));
    expect(onOpen.mock.calls).toEqual([["fields"], ["filters"], ["sorts"]]);
  });

  it("keeps find in the existing fields/filter/sort toolbar and disables unsupported options", () => {
    function Harness() {
      const control = useRecordFind({
        value: { query: "", fieldId: "" },
        scope: "base:view",
        onCommit: vi.fn(),
      });
      return (
        <ViewConfigToolbar
          config={{ filters: [], sorts: [] }}
          fields={fields}
          onOpen={vi.fn()}
          trailingControl={<RecordFind control={control} fields={fields} visibleSlugs={["name"]} />}
        />
      );
    }
    render(<Harness />);
    const toolbar = screen.getByTestId("view-control-toolbar");
    expect(toolbar.contains(screen.getByTestId("base-record-find"))).toBe(true);
    expect(toolbar.contains(screen.getByTestId("view-control-fields"))).toBe(true);
    expect(
      (screen.getByRole("option", { name: /Config.*Not shown in this view/ }) as HTMLOptionElement)
        .disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("option", { name: /Due.*Use filters/ }) as HTMLOptionElement).disabled,
    ).toBe(true);
    const fieldSelect = screen.getByTestId("base-record-find-field");
    const fieldHint = document.getElementById(fieldSelect.getAttribute("aria-describedby") ?? "");
    expect(fieldHint?.textContent).toBe(
      "Fields not shown in this view can be searched without showing their columns.",
    );
    expect(fieldSelect.getAttribute("title")).toBe(fieldHint?.textContent);
  });

  it("keeps the idle search icon and announcement when selecting a field without a keyword", () => {
    const commits = vi.fn();
    vi.useFakeTimers();
    function Harness() {
      const control = useRecordFind({
        value: { query: "", fieldId: "" },
        scope: "base:view",
        onCommit: commits,
      });
      return <RecordFind control={control} fields={fields} visibleSlugs={["name"]} />;
    }
    try {
      render(<Harness />);
      const fieldSelect = screen.getByTestId("base-record-find-field") as HTMLSelectElement;
      fireEvent.change(fieldSelect, { target: { value: "fld_json" } });
      act(() => vi.advanceTimersByTime(1000));
      expect(fieldSelect.value).toBe("fld_json");
      expect(commits).not.toHaveBeenCalled();
      expect(screen.getByTestId("base-record-find").querySelector(".animate-spin")).toBeNull();
      expect(screen.queryByText("Finding records…")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("connects composition events, field selection, and the accessible clear action", () => {
    const commits = vi.fn();
    vi.useFakeTimers();
    function Harness() {
      const control = useRecordFind({
        value: { query: "", fieldId: "" },
        scope: "base:view",
        onCommit: commits,
      });
      return <RecordFind control={control} fields={fields} visibleSlugs={["name"]} />;
    }
    try {
      render(<Harness />);
      const input = screen.getByTestId("base-record-find-input");
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: "huaxing" } });
      vi.advanceTimersByTime(1000);
      expect(commits).not.toHaveBeenCalled();
      fireEvent.compositionEnd(input, { target: { value: "华星" } });
      expect((input as HTMLInputElement).value).toBe("华星");
      fireEvent.change(screen.getByTestId("base-record-find-field"), {
        target: { value: "fld_name" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Clear find" }));
      expect(commits).toHaveBeenCalledWith({ query: "", fieldId: "fld_name" });
    } finally {
      vi.useRealTimers();
    }
  });
});
