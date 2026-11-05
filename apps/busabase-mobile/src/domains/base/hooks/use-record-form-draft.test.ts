// @vitest-environment jsdom

import type { BaseFieldVO } from "busabase-contract/types";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useRecordFormDraft } from "./use-record-form-draft";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const roots: Root[] = [];
const title = { id: "field-title", slug: "title", type: "text", options: {} } as BaseFieldVO;
const note = { id: "field-note", slug: "note", type: "text", options: {} } as BaseFieldVO;
const fields = [title, note];

const mountDraft = (initial: Parameters<typeof useRecordFormDraft>[0]) => {
  let props = initial;
  let current!: ReturnType<typeof useRecordFormDraft>;
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const Harness = () => {
    current = useRecordFormDraft(props);
    return null;
  };
  const render = () => act(() => root.render(createElement(Harness)));
  render();
  return {
    get current() {
      return current;
    },
    update(next: Parameters<typeof useRecordFormDraft>[0]) {
      props = next;
      render();
    },
  };
};

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
});

describe("record form draft recovery", () => {
  it("keeps the user's typed title while refreshing untouched fields and sends only that edit", () => {
    const draft = mountDraft({
      identity: "space-a:record-a",
      fields,
      source: { title: "Original title", note: "Original note" },
    });
    act(() => draft.current.setValue("title", "My unsaved title"));
    draft.update({
      identity: "space-a:record-a",
      fields,
      source: { title: "Someone else's title", note: "Someone else's note" },
    });

    expect(draft.current.values).toEqual({
      title: "My unsaved title",
      note: "Someone else's note",
    });
    expect(draft.current.changedValues).toEqual({ title: "My unsaved title" });
    expect(draft.current.hasChanges).toBe(true);
    expect(draft.current.schemaChanged).toBe(false);
  });

  it("updates a pristine form when the server sends a newer record", () => {
    const draft = mountDraft({
      identity: "space-a:record-a",
      fields,
      source: { title: "Before", note: "Before" },
    });
    draft.update({
      identity: "space-a:record-a",
      fields,
      source: { title: "After", note: "After" },
    });

    expect(draft.current.values.title).toBe("After");
    expect(draft.current.hasChanges).toBe(false);
    expect(draft.current.changedValues).toEqual({});
  });

  it("keeps a new record's draft through refreshed Base metadata", () => {
    const draft = mountDraft({ identity: "space-a:new:base-a", fields });
    act(() => draft.current.setValue("title", "New record draft"));
    draft.update({
      identity: "space-a:new:base-a",
      fields: [{ ...title, name: "Renamed title label" }, note],
    });

    expect(draft.current.values.title).toBe("New record draft");
    expect(draft.current.hasChanges).toBe(true);
    expect(draft.current.schemaChanged).toBe(false);
  });

  it("starts a separate draft when the record or workspace changes", () => {
    const draft = mountDraft({
      identity: "space-a:record-a",
      fields,
      source: { title: "Before", note: "" },
    });
    act(() => draft.current.setValue("title", "Unsaved in A"));
    draft.update({
      identity: "space-b:record-a",
      fields,
      source: { title: "Space B title", note: "" },
    });

    expect(draft.current.values.title).toBe("Space B title");
    expect(draft.current.hasChanges).toBe(false);
  });

  it("retains edited values and exposes a save-blocking state if their field is removed", () => {
    const draft = mountDraft({
      identity: "space-a:record-a",
      fields,
      source: { title: "Before", note: "" },
    });
    act(() => draft.current.setValue("title", "My draft"));
    draft.update({
      identity: "space-a:record-a",
      fields: [note],
      source: { note: "After" },
    });

    expect(draft.current.values.title).toBe("My draft");
    expect(draft.current.fields).toContain(title);
    expect(draft.current.schemaChanged).toBe(true);
    expect(draft.current.hasChanges).toBe(true);
  });

  it("does not silently convert an edited text field into another type after recovery", () => {
    const draft = mountDraft({
      identity: "space-a:record-a",
      fields,
      source: { title: "Before", note: "" },
    });
    act(() => draft.current.setValue("title", "Keep this text"));
    draft.update({
      identity: "space-a:record-a",
      fields: [{ ...title, type: "number" }, note],
      source: { title: 25, note: "" },
    });

    expect(draft.current.values.title).toBe("Keep this text");
    expect(draft.current.fields[0].type).toBe("text");
    expect(draft.current.schemaChanged).toBe(true);
  });

  it("treats a server update matching the local edit as clean", () => {
    const draft = mountDraft({
      identity: "space-a:record-a",
      fields,
      source: { title: "Before", note: "" },
    });
    act(() => draft.current.setValue("title", "Same update"));
    draft.update({
      identity: "space-a:record-a",
      fields,
      source: { title: "Same update", note: "" },
    });

    expect(draft.current.values.title).toBe("Same update");
    expect(draft.current.hasChanges).toBe(false);
    expect(draft.current.changedValues).toEqual({});
  });
});
