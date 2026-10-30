// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BaseFieldVO, ViewConfigVO, ViewVO } from "busabase-contract/types";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { ViewConfigEditorDialog, ViewFieldsEditor } from "./view-config-editor";

const fields: BaseFieldVO[] = [
  {
    id: "fld_title",
    baseId: "bas_test",
    slug: "title",
    name: "Title",
    type: "text",
    required: true,
    position: 0,
    options: {},
  },
  {
    id: "fld_status",
    baseId: "bas_test",
    slug: "status",
    name: "Status",
    type: "select",
    required: false,
    position: 1,
    options: {},
  },
  {
    id: "fld_owner",
    baseId: "bas_test",
    slug: "owner",
    name: "Owner",
    type: "member",
    required: false,
    position: 2,
    options: {},
  },
  {
    id: "fld_notes",
    baseId: "bas_test",
    slug: "notes",
    name: "Notes",
    type: "longtext",
    required: false,
    position: 3,
    options: {},
  },
];

const initialConfig: ViewConfigVO = {
  filters: [],
  sorts: [],
  visibleFieldSlugs: ["title", "status", "owner"],
};

function Harness({
  onChange = () => {},
  availableFields = fields,
}: {
  onChange?: (config: ViewConfigVO) => void;
  availableFields?: BaseFieldVO[];
}) {
  const [config, setConfig] = useState(initialConfig);
  return (
    <CoreI18nProvider locale="en">
      <ViewFieldsEditor
        config={config}
        fields={availableFields}
        onChange={(next) => {
          setConfig(next);
          onChange(next);
        }}
        testId="test-view-fields"
      />
    </CoreI18nProvider>
  );
}

const rowOrder = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-view-field-slug]")).map(
    (element) => element.dataset.viewFieldSlug,
  );

const mockRowLayout = (container: HTMLElement) => {
  for (const [index, row] of Array.from(
    container.querySelectorAll<HTMLElement>("[data-view-field-slug]"),
  ).entries()) {
    const top = index * 40;
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      bottom: top + 40,
      height: 40,
      left: 0,
      right: 320,
      toJSON: () => ({}),
      top,
      width: 320,
      x: 0,
      y: top,
    });
  }
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ViewFieldsEditor field reordering", () => {
  it("keeps a width draft across a live field addition and submits only the width patch", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const request = { section: "fields", source: "toolbar" } as const;
    const view: ViewVO = {
      id: "view_test",
      baseId: "bas_test",
      slug: "grid",
      name: "Grid",
      description: "",
      type: "table",
      config: { ...initialConfig, fieldWidths: { title: 280 } },
      status: "active",
      position: 0,
      createdBy: "user_test",
      archivedAt: null,
      createdAt: "2026-10-27T00:00:00.000Z",
      updatedAt: "2026-10-27T00:00:00.000Z",
    };
    const props = { fields, onSubmit, onClose, request, view };
    const result = render(
      <CoreI18nProvider locale="en">
        <ViewConfigEditorDialog {...props} />
      </CoreI18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset widths" }));
    const added = {
      ...fields[3],
      id: "attachment-id",
      slug: "attachment",
      name: "Attachment",
      type: "attachment" as const,
      position: 4,
    };
    result.rerender(
      <CoreI18nProvider locale="en">
        <ViewConfigEditorDialog
          {...props}
          fields={[...fields, added]}
          view={{
            ...view,
            config: {
              ...view.config,
              visibleFieldSlugs: [...(initialConfig.visibleFieldSlugs ?? []), "attachment"],
            },
          }}
        />
      </CoreI18nProvider>,
    );
    // A background refetch must not restore the old saved widths over our draft.
    expect(
      (screen.getByRole("button", { name: "Reset widths" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Update View Now" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ fieldWidths: {} }, { mergeImmediately: true }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("lets a curated view opt into new fields without revealing previously hidden fields", () => {
    const result = render(<Harness />);
    const automatic = screen.getByRole("checkbox", { name: "Automatically show new fields" });
    expect((automatic as HTMLInputElement).checked).toBe(false);
    fireEvent.click(automatic);
    expect((automatic as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Show Notes" }) as HTMLInputElement).checked).toBe(
      false,
    );
    const attachment: BaseFieldVO = {
      baseId: "bas_test",
      id: "fld_files",
      slug: "files",
      name: "Files",
      type: "attachment",
      position: 4,
      options: {},
      required: false,
    };
    result.rerender(<Harness availableFields={[...fields, attachment]} />);
    expect((screen.getByRole("checkbox", { name: "Show Files" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole("checkbox", { name: "Show Notes" }) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("shows drag handles only for visible non-primary fields and enables one when revealed", () => {
    const { container } = render(<Harness />);

    expect(screen.queryByRole("button", { name: "Drag to reorder Title" })).toBeNull();
    expect(screen.getByRole("button", { name: "Drag to reorder Status" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Drag to reorder Owner" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Drag to reorder Notes" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Move .+ (up|down)/ })).toBeNull();
    expect(rowOrder(container)).toEqual(["title", "status", "owner", "notes"]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Show Notes" }));

    expect(rowOrder(container)).toEqual(["title", "status", "owner", "notes"]);
    expect(screen.getByRole("button", { name: "Drag to reorder Notes" })).toBeTruthy();
  });

  it("reorders with the keyboard and keeps the primary field fixed", async () => {
    const { container } = render(<Harness />);
    mockRowLayout(container);
    const ownerHandle = screen.getByRole("button", { name: "Drag to reorder Owner" });

    fireEvent.keyDown(ownerHandle, { code: "Space", key: " " });
    await waitFor(() => {
      expect(
        container.querySelector('[data-view-field-slug="owner"]')?.getAttribute("data-dragging"),
      ).toBe("true");
    });
    fireEvent.keyDown(ownerHandle, { code: "ArrowUp", key: "ArrowUp" });
    await waitFor(() => {
      expect(
        container
          .querySelector('[data-view-field-slug="status"]')
          ?.getAttribute("data-reorder-target"),
      ).toBe("true");
    });
    fireEvent.keyDown(ownerHandle, { code: "Space", key: " " });

    await waitFor(() => {
      expect(rowOrder(container)).toEqual(["title", "owner", "status", "notes"]);
    });
    expect(rowOrder(container)[0]).toBe("title");
  });

  it("cancels a keyboard drag without updating the draft", () => {
    const onChange = vi.fn();
    const { container } = render(<Harness onChange={onChange} />);
    mockRowLayout(container);
    const statusHandle = screen.getByRole("button", { name: "Drag to reorder Status" });

    fireEvent.keyDown(statusHandle, { code: "Space", key: " " });
    fireEvent.keyDown(statusHandle, { code: "ArrowDown", key: "ArrowDown" });
    fireEvent.keyDown(statusHandle, { code: "Escape", key: "Escape" });

    expect(onChange).not.toHaveBeenCalled();
    expect(rowOrder(container)).toEqual(["title", "status", "owner", "notes"]);
  });
});
