// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BaseFieldVO } from "busabase-contract/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordFindState } from "../helpers/record-find-url";
import { useRecordFind } from "../hooks/use-record-find";
import { isRecordFindShortcut } from "../hooks/use-record-find-shortcut";
import { RecordFind } from "./record-find-control";
import { ViewConfigToolbar } from "./view-config-editor";

// Radix menus use pointer capture, which jsdom does not implement.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

afterEach(cleanup);
const fields = [
  { id: "fld_name", slug: "name", name: "Customer", type: "text", options: {} },
  { id: "fld_json", slug: "config", name: "Config", type: "json", options: {} },
  { id: "fld_date", slug: "date", name: "Due", type: "date", options: {} },
] as BaseFieldVO[];

const openFieldMenu = () =>
  fireEvent.pointerDown(screen.getByTestId("base-record-find-field-trigger"), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
const fieldOption = (fieldId: string) => {
  const option = screen
    .getAllByTestId("base-record-find-field-option")
    .find((item) => item.getAttribute("data-field-id") === fieldId);
  if (!option) throw new Error(`No find field option ${fieldId}`);
  return option;
};
const chooseField = (fieldId: string) => {
  openFieldMenu();
  fireEvent.click(fieldOption(fieldId));
};
const findInput = () => screen.getByTestId("base-record-find-input") as HTMLInputElement;

function Harness({
  value = { query: "", fieldId: "" },
  visibleSlugs = ["name"],
  onCommit = vi.fn(),
}: {
  value?: RecordFindState;
  visibleSlugs?: string[];
  onCommit?: (value: RecordFindState) => void;
}) {
  const control = useRecordFind({ value, scope: "base:view", onCommit });
  return <RecordFind control={control} fields={fields} visibleSlugs={visibleSlugs} />;
}

describe("record find toolbar", () => {
  it("orders visible fields like the view columns and keeps other fields in Base order", () => {
    const { rerender } = render(<Harness visibleSlugs={["date", "name"]} />);
    const optionIds = () =>
      screen
        .getAllByTestId("base-record-find-field-option")
        .map((option) => option.getAttribute("data-field-id"));
    openFieldMenu();
    expect(optionIds()).toEqual(["", "fld_date", "fld_name", "fld_json"]);
    expect(fieldOption("").textContent).toBe("Visible fields");
    expect(fieldOption("").getAttribute("aria-checked")).toBe("true");

    rerender(<Harness visibleSlugs={["config"]} />);
    expect(optionIds()).toEqual(["", "fld_json", "fld_name", "fld_date"]);
    expect(screen.getByRole("menuitemradio", { name: "Config" })).toBeTruthy();
    expect(
      screen.getByRole("menuitemradio", { name: /Customer.*Not shown in this view/ }),
    ).toBeTruthy();
    expect(screen.queryByText(/Common fields/)).toBeNull();
  });

  it("keeps the chosen field and keyword when its column moves or becomes hidden", () => {
    const commits = vi.fn();
    vi.useFakeTimers();
    const value = { query: "Acme", fieldId: "fld_name" };
    try {
      const { rerender } = render(
        <Harness onCommit={commits} value={value} visibleSlugs={["name", "config"]} />,
      );
      const input = findInput();
      input.focus();
      rerender(<Harness onCommit={commits} value={value} visibleSlugs={["config", "date"]} />);
      act(() => vi.advanceTimersByTime(1000));

      expect(screen.getByTestId("base-record-find-field-chip").textContent).toBe("In:Customer");
      expect(input.value).toBe("Acme");
      expect(document.activeElement).toBe(input);
      expect(commits).not.toHaveBeenCalled();
      openFieldMenu();
      expect(fieldOption("fld_name").getAttribute("aria-checked")).toBe("true");
      expect(fieldOption("").getAttribute("aria-checked")).toBe("false");
      expect(
        screen.getByRole("menuitemradio", { name: /Customer.*Not shown in this view/ }),
      ).toBeTruthy();
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
    function ToolbarHarness() {
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
    render(<ToolbarHarness />);
    const toolbar = screen.getByTestId("view-control-toolbar");
    expect(toolbar.contains(screen.getByTestId("base-record-find"))).toBe(true);
    expect(toolbar.contains(screen.getByTestId("view-control-fields"))).toBe(true);
    const trigger = screen.getByTestId("base-record-find-field-trigger");
    expect(toolbar.contains(trigger)).toBe(true);
    expect(trigger.getAttribute("aria-label")).toBe("Find in field");
    const hint = "Searches the fields shown in this view. To search a hidden field, pick it here.";
    expect(
      document.getElementById(trigger.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe(hint);
    // No field choice by default: no chip, nothing in front of the input.
    expect(screen.queryByTestId("base-record-find-field-chip")).toBeNull();
    openFieldMenu();
    expect(
      screen
        .getByRole("menuitemradio", { name: /Config.*Not shown in this view/ })
        .getAttribute("aria-disabled"),
    ).toBeNull();
    expect(
      screen.getByRole("menuitemradio", { name: /Due.*Use filters/ }).getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      screen.getByRole("menu").querySelector("p")?.textContent,
      "the hint stays readable at the bottom of the menu",
    ).toBe(hint);
  });

  it("keeps the idle search icon and announcement when selecting a field without a keyword", () => {
    const commits = vi.fn();
    vi.useFakeTimers();
    try {
      render(<Harness onCommit={commits} />);
      chooseField("fld_json");
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByTestId("base-record-find-field-chip").textContent).toBe("In:Config");
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
    try {
      render(<Harness onCommit={commits} />);
      const input = findInput();
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: "huaxing" } });
      vi.advanceTimersByTime(1000);
      expect(commits).not.toHaveBeenCalled();
      fireEvent.compositionEnd(input, { target: { value: "华星" } });
      expect((input as HTMLInputElement).value).toBe("华星");
      chooseField("fld_name");
      act(() => vi.advanceTimersByTime(0));
      fireEvent.click(screen.getByRole("button", { name: "Clear find" }));
      expect(commits).toHaveBeenCalledWith({ query: "", fieldId: "fld_name" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("record find field choice", () => {
  it("shows the chosen field as a chip whose clear goes back to visible fields", async () => {
    render(<Harness value={{ query: "Acme", fieldId: "" }} />);
    chooseField("fld_json");
    const chip = screen.getByTestId("base-record-find-field-chip");
    expect(chip.textContent).toBe("In:Config");
    expect(chip.getAttribute("title")).toBe("In: Config");
    await waitFor(() => expect(document.activeElement).toBe(findInput()));

    const clear = screen.getByTestId("base-record-find-field-chip-clear");
    expect(clear.getAttribute("aria-label")).toBe("Search visible fields again");
    screen.getByTestId("base-record-find-field-trigger").focus();
    fireEvent.click(clear);
    expect(screen.queryByTestId("base-record-find-field-chip")).toBeNull();
    expect(document.activeElement).toBe(findInput());
    expect(findInput().value).toBe("Acme");
    openFieldMenu();
    expect(fieldOption("").getAttribute("aria-checked")).toBe("true");
  });

  it("names a removed field choice in the chip instead of a field", () => {
    render(<Harness value={{ query: "Acme", fieldId: "fld_deleted" }} />);
    const chip = screen.getByTestId("base-record-find-field-chip");
    expect(chip.textContent).toBe("Choose a field again");
    fireEvent.click(screen.getByTestId("base-record-find-field-chip-clear"));
    expect(screen.queryByTestId("base-record-find-field-chip")).toBeNull();
  });

  it("keeps a narrow find open while a field is chosen from its menu", async () => {
    render(<Harness value={{ query: "Acme", fieldId: "" }} />);
    const find = screen.getByTestId("base-record-find");
    const isOpen = () => find.className.includes("@max-[480px]/view-controls:absolute");
    expect(isOpen()).toBe(false);
    fireEvent.click(screen.getByTestId("base-record-find-open"));
    await waitFor(() => expect(document.activeElement).toBe(findInput()));
    expect(isOpen()).toBe(true);

    openFieldMenu();
    const menu = await screen.findByRole("menu");
    // The menu renders in a portal; focus moving into it left the find box.
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    expect(find.contains(menu)).toBe(false);
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(document.activeElement ?? menu, { key: "ArrowDown" });
    expect(isOpen()).toBe(true);

    fireEvent.click(fieldOption("fld_json"));
    await waitFor(() => expect(document.activeElement).toBe(findInput()));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(isOpen()).toBe(true);
    expect(screen.getByTestId("base-record-find-field-chip").textContent).toBe("In:Config");

    // Leaving the find box still folds it, keeping the query and the field.
    act(() => findInput().blur());
    expect(isOpen()).toBe(false);
    expect(findInput().value).toBe("Acme");
    expect(screen.getByTestId("base-record-find-field-chip")).toBeTruthy();
  });
});

describe("Cmd/Ctrl+F", () => {
  const press = (target: Element, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(target, { key: "f", code: "KeyF", ctrlKey: true, ...init });

  it("matches plain Cmd+F on Apple platforms and plain Ctrl+F elsewhere", () => {
    const event = (init: Partial<KeyboardEvent>) =>
      ({
        key: "f",
        code: "KeyF",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        isComposing: false,
        ...init,
      }) as KeyboardEvent;
    expect(isRecordFindShortcut(event({ metaKey: true }), true)).toBe(true);
    expect(isRecordFindShortcut(event({ ctrlKey: true }), true)).toBe(false);
    expect(isRecordFindShortcut(event({ ctrlKey: true }), false)).toBe(true);
    expect(isRecordFindShortcut(event({ metaKey: true }), false)).toBe(false);
    expect(isRecordFindShortcut(event({ ctrlKey: true, key: "F" }), false)).toBe(true);
    expect(isRecordFindShortcut(event({ metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isRecordFindShortcut(event({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isRecordFindShortcut(event({ ctrlKey: true, metaKey: true }), false)).toBe(false);
    expect(isRecordFindShortcut(event({ ctrlKey: true, isComposing: true }), false)).toBe(false);
    // A non-Latin layout reports its own letter; the physical F key still finds.
    expect(isRecordFindShortcut(event({ ctrlKey: true, key: "а" }), false)).toBe(true);
    // Dvorak's F is elsewhere: the key at the QWERTY F position types "u".
    expect(isRecordFindShortcut(event({ ctrlKey: true, key: "u" }), false)).toBe(false);
  });

  it("focuses the find box and selects its query", () => {
    render(
      <>
        <button type="button">Elsewhere</button>
        <Harness value={{ query: "Acme", fieldId: "" }} />
      </>,
    );
    const input = findInput();
    expect(input.getAttribute("aria-keyshortcuts")).toBe("Control+F Meta+F");
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();
    expect(press(elsewhere)).toBe(false);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);

    // A second press, from the find box itself, reaches the browser's own find.
    expect(press(input)).toBe(true);
    expect(press(document.body, { shiftKey: true })).toBe(true);
  });

  it("opens a folded narrow find before focusing it", async () => {
    render(<Harness value={{ query: "Acme", fieldId: "" }} />);
    const find = screen.getByTestId("base-record-find");
    expect(find.className).toContain("@max-[480px]/view-controls:hidden");
    expect(press(document.body)).toBe(false);
    expect(find.className).toContain("@max-[480px]/view-controls:absolute");
    await waitFor(() => expect(document.activeElement).toBe(findInput()));
  });

  it("stays out of the way while typing elsewhere or inside a dialog", () => {
    render(
      <>
        <textarea aria-label="Notes" />
        <div contentEditable data-testid="editor" suppressContentEditableWarning>
          Draft
        </div>
        <div role="dialog" aria-label="Record">
          <button type="button">Inside dialog</button>
        </div>
        <Harness value={{ query: "Acme", fieldId: "" }} />
      </>,
    );
    const input = findInput();
    const notes = screen.getByRole("textbox", { name: "Notes" });
    notes.focus();
    expect(press(notes)).toBe(true);
    expect(document.activeElement).toBe(notes);

    const editor = screen.getByTestId("editor");
    editor.focus();
    expect(press(editor)).toBe(true);
    expect(document.activeElement).not.toBe(input);

    const inDialog = screen.getByRole("button", { name: "Inside dialog" });
    inDialog.focus();
    expect(press(inDialog)).toBe(true);
    expect(document.activeElement).toBe(inDialog);
  });

  it("leaves an event another handler already claimed", () => {
    render(<Harness value={{ query: "Acme", fieldId: "" }} />);
    const claim = (event: KeyboardEvent) => event.preventDefault();
    document.body.addEventListener("keydown", claim);
    try {
      press(document.body);
      expect(document.activeElement).not.toBe(findInput());
    } finally {
      document.body.removeEventListener("keydown", claim);
    }
  });
});
