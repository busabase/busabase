// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BaseFieldVO } from "busabase-contract/types";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, coreMessagesLoader } from "../../../i18n";
import { dashboardZhCN } from "../../../i18n/zh-CN";
import { ChoiceFieldEditor } from "./choice-field";

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (scrollIntoViewDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

const choices = [
  { id: "a", name: "Alpha team", color: "red" },
  { id: "b", name: "Beta team", color: "blue" },
  { id: "c", name: "中文选项", color: "green" },
];
const baseField = {
  id: "status",
  slug: "status",
  type: "select",
  options: { choices },
} as BaseFieldVO;

function mount({
  initial = "" as unknown,
  multiple = false,
  required = false,
  options = choices,
  locale = "en",
} = {}) {
  const changed = vi.fn();
  const submitted = vi.fn();
  function Harness() {
    const [draft, setDraft] = useState(initial);
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted();
        }}
      >
        <ChoiceFieldEditor
          ariaDescribedBy="status-help"
          field={{
            ...baseField,
            required,
            type: multiple ? "multiselect" : "select",
            options: { choices: options },
          }}
          fieldName="Status"
          inputId="status"
          onChange={(next) => {
            changed(next);
            setDraft(next);
          }}
          value={draft}
        />
        <span id="status-help">Choose the record status</span>
        <input aria-label="Next field" />
        <output data-testid="value">{JSON.stringify(draft)}</output>
        <button type="submit">Save</button>
      </form>
    );
  }
  render(
    <CoreI18nProvider locale={locale}>
      <Harness />
    </CoreI18nProvider>,
  );
  return { changed, submitted };
}
const open = () => fireEvent.click(screen.getByRole("button", { name: "Status" }));
const search = () => screen.getByLabelText("Search options — Status") as HTMLInputElement;
const value = () => screen.getByTestId("value").textContent;
const pick = (name: string) => fireEvent.click(screen.getByRole("option", { name }));

describe("ChoiceFieldEditor", () => {
  it("selects a single ID, closes, restores focus and never submits the surrounding form", async () => {
    const { changed, submitted } = mount();
    const trigger = screen.getByRole("button", { name: "Status" });
    expect(trigger.getAttribute("aria-describedby")).toBe("status-help status-selection");
    expect(screen.getByText("Select an option…", { selector: ".sr-only" })).toBeTruthy();
    open();
    expect(screen.getByRole("dialog", { name: "Status" })).toBeTruthy();
    expect(document.activeElement).toBe(search());
    pick("Beta team");
    expect(changed).toHaveBeenLastCalledWith("b");
    expect(value()).toBe('"b"');
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.getByText("1 selected: Beta team", { selector: ".sr-only" })).toBeTruthy();
    expect(submitted).not.toHaveBeenCalled();
  });

  it("toggles multiple options without modifiers and preserves query, scroll and configured order", () => {
    const { submitted } = mount({ multiple: true, initial: ["a"] });
    open();
    fireEvent.change(search(), { target: { value: " team " } });
    const list = screen.getByRole("listbox");
    list.scrollTop = 85;
    pick("Beta team");
    expect(value()).toBe('["a","b"]');
    expect(search().value).toBe(" team ");
    expect(list.scrollTop).toBe(85);
    expect(screen.getAllByRole("option").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Alpha team",
      "Beta team",
    ]);
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    expect(within(list).queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("option", { name: "Beta team" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    pick("Alpha team");
    expect(value()).toBe('["b"]');
    expect(submitted).not.toHaveBeenCalled();
  });

  it("supports case-insensitive, trimmed and Chinese substring search and keeps spaces editable", () => {
    mount({ multiple: true });
    open();
    fireEvent.change(search(), { target: { value: " ALPHA TEAM " } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Alpha team" })).toBeTruthy();
    expect(fireEvent.keyDown(search(), { key: " " })).toBe(true);
    fireEvent.change(search(), { target: { value: "文选" } });
    expect(screen.getByRole("option", { name: "中文选项" })).toBeTruthy();
    pick("中文选项");
    fireEvent.change(search(), { target: { value: "missing" } });
    expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toBe(
      "No matching options",
    );
    expect(value()).toBe('["c"]');
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search().value).toBe("");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(value()).toBe('["c"]');
  });

  it("keeps single keyboard focus on combobox, scrolls active choices and Enter selects", () => {
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    const { changed, submitted } = mount();
    open();
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "Beta team" }).id,
    );
    expect(document.activeElement).toBe(input);
    expect(changed).not.toHaveBeenCalled();
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(value()).toBe('"b"');
    expect(submitted).not.toHaveBeenCalled();
  });

  it("moves multi search focus into listbox, Home/End navigate and Space toggles", () => {
    const { changed, submitted } = mount({ multiple: true });
    open();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Search options — Status" })).toBe(search());
    expect(fireEvent.keyDown(search(), { key: "Home" })).toBe(true);
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    expect(document.activeElement).toBe(list);
    fireEvent.keyDown(list, { key: "End" });
    expect(list.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "中文选项" }).id,
    );
    fireEvent.keyDown(list, { key: " " });
    expect(value()).toBe('["c"]');
    fireEvent.keyDown(list, { key: "Home" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(changed).toHaveBeenLastCalledWith(["c", "a"]);
    expect(submitted).not.toHaveBeenCalled();
  });

  it("does not select or submit while confirming an IME composition", () => {
    const { changed, submitted } = mount();
    open();
    fireEvent.compositionStart(search());
    expect(fireEvent.keyDown(search(), { key: "Enter", isComposing: true, keyCode: 229 })).toBe(
      false,
    );
    expect(changed).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.compositionEnd(search());
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(changed).toHaveBeenCalledWith("a");
  });

  it("resolves historical unique names but preserves raw draft on open, search and Escape", async () => {
    const { changed } = mount({ multiple: true, initial: ["Alpha team", "retired"] });
    expect(screen.getByRole("button", { name: "Remove Alpha team" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove retired" })).toBeTruthy();
    open();
    expect(screen.getByRole("option", { name: "Alpha team" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.change(search(), { target: { value: "Beta" } });
    fireEvent.keyDown(search(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(value()).toBe('["Alpha team","retired"]');
    expect(changed).not.toHaveBeenCalled();
    open();
    pick("Beta team");
    expect(changed).toHaveBeenLastCalledWith(["a", "retired", "b"]);
  });

  it("flags ambiguous historical names and unavailable IDs, preserving them during unrelated edits", () => {
    mount({
      multiple: true,
      initial: ["Same", "deleted"],
      options: [
        { id: "a", name: "Same", color: "blue" },
        { id: "b", name: "Same", color: "red" },
        { id: "c", name: "Other", color: "green" },
      ],
    });
    expect(screen.getByText("(Ambiguous option)")).toBeTruthy();
    expect(screen.getByText("(Unavailable option)")).toBeTruthy();
    open();
    expect(screen.getByRole("option", { name: "Same — a" }).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(screen.getByRole("option", { name: "Same — b" }).getAttribute("aria-selected")).toBe(
      "false",
    );
    pick("Other");
    expect(value()).toBe('["Same","deleted","c"]');
  });

  it("distinguishes clearing selections from search and supports independent tag removal", async () => {
    const { submitted } = mount({ multiple: true, initial: ["a", "b"] });
    const remove = screen.getByRole("button", { name: "Remove Alpha team" });
    expect(remove.parentElement?.closest("button")).toBeNull();
    fireEvent.click(remove);
    expect(value()).toBe('["b"]');
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    fireEvent.change(search(), { target: { value: "Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(value()).toBe("[]");
    expect(search().value).toBe("Alpha");
    expect(document.activeElement).toBe(search());
    expect(submitted).not.toHaveBeenCalled();
  });

  it("allows clearing optional single values, suppresses clear for required ones and distinguishes empty configuration", () => {
    mount({ initial: "a" });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(value()).toBe('""');
    cleanup();
    mount({ initial: "a", required: true });
    open();
    expect(screen.queryByRole("button", { name: "Clear selection" })).toBeNull();
    cleanup();
    mount({ options: [] });
    open();
    expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toBe(
      "No options configured",
    );
  });

  it("closing on outside focus does not steal focus from the next field or discard draft", async () => {
    mount({ multiple: true });
    open();
    pick("Beta team");
    const next = screen.getByRole("textbox", { name: "Next field" });
    await act(async () => {
      next.focus();
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(next);
    expect(value()).toBe('["b"]');
  });

  it("uses a mobile sheet that follows the visual viewport and Done retains the draft", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const viewport = new EventTarget();
    Object.assign(viewport, { height: 400, offsetTop: 50 });
    vi.stubGlobal("visualViewport", viewport);
    mount({ multiple: true });
    open();
    const dialog = screen.getByRole("dialog", { name: "Status" });
    expect(dialog.style.bottom).toBe(`${Math.max(0, window.innerHeight - 450)}px`);
    expect(dialog.style.maxHeight).toBe("340px");
    expect(dialog.style.translate).toBe("none");
    pick("Alpha team");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(value()).toBe('["a"]');
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Status" }));
  });

  it("localizes search and control labels in the active host locale", () => {
    coreMessagesLoader.prime("zh-CN", dashboardZhCN);
    mount({ locale: "zh-CN", multiple: true, initial: ["a"] });
    open();
    expect(screen.getByLabelText("搜索选项 — Status")).toBeTruthy();
    expect(screen.getByRole("button", { name: "移除 Alpha team" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "清空已选" })).toBeTruthy();
  });
});
