// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseFieldVO, BaseVO, ViewVO } from "busabase-contract/types";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SubmitPermissionProvider } from "./split-submit-button";

vi.mock("../helpers/field-dependencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../helpers/field-dependencies")>();
  return { ...actual, getFieldDependencies: vi.fn(actual.getFieldDependencies) };
});

// Exercise the real delete dialog and permission-aware submission, without
// mounting unrelated tables, forms, or workbench panels.
vi.mock("./base-table", () => ({
  BusaBaseTable: () => null,
  applyViewConfigToRecords: (records: unknown) => records,
}));
vi.mock("../../form/components/forms-for-base-panel", () => ({ FormsForBasePanel: () => null }));
vi.mock("./node-settings-dialog", () => ({ NodeSettingsDialog: () => null }));
vi.mock("./node-actions-menu", () => ({ NodeActionsMenu: () => null }));
vi.mock("./node-agent-prompts-button", () => ({ NodeAgentPromptsButton: () => null }));
vi.mock("wouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wouter")>()),
  useSearch: () => "?spaceId=workspace",
}));

const transport = vi.hoisted(() => ({
  views: [] as ViewVO[],
  viewsPending: false,
  viewsError: null as Error | null,
  refetchViews: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { kind?: string; enabled?: boolean }) => {
    transport.query(options);
    if (options.kind === "views") {
      return {
        data: transport.views,
        isPending: transport.viewsPending,
        isFetching: false,
        error: transport.viewsError,
        refetch: transport.refetchViews,
      };
    }
    return { data: { total: 12, records: [] }, isPending: false, error: null };
  },
}));
const { BaseSetupView } = await import("./base-views");
const { getFieldDependencies } = await import("../helpers/field-dependencies");
type DeleteField = NonNullable<Parameters<typeof BaseSetupView>[0]["onDeleteField"]>;
type RestoreField = NonNullable<Parameters<typeof BaseSetupView>[0]["onRestoreField"]>;

const field = (slug: string, type: BaseFieldVO["type"], position: number): BaseFieldVO => ({
  id: `fld_${slug}`,
  baseId: "bas_orders",
  name: slug,
  slug,
  type,
  position,
  required: false,
  options: {},
});
const lookup: BaseFieldVO = {
  ...field("fees", "lookup", 1),
  options: { lookup: { relationFieldSlug: "course", targetFieldSlug: "fee", rollup: "values" } },
};
const formula: BaseFieldVO = {
  ...field("amount", "formula", 5),
  options: { formula: { expression: '{note} & " suffix"' } },
};
const base: BaseVO = {
  id: "bas_orders",
  nodeId: "nod_orders",
  name: "Orders",
  slug: "orders",
  description: "",
  createdAt: "2026-10-30T00:00:00Z",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  fields: [
    field("title", "text", 0),
    lookup,
    field("created", "created_time", 2),
    field("note", "text", 3),
    {
      ...field("course", "relation", 4),
      options: { targetBaseId: "inaccessible-source" },
    },
  ],
};
const queryOptions = (kind: string) => () => ({ kind });
const orpc = {
  records: {
    list: { queryOptions: queryOptions("records") },
    count: { queryOptions: queryOptions("count") },
  },
  bases: {
    get: { queryOptions: queryOptions("source") },
    previewFieldConversion: { queryOptions: queryOptions("preview") },
    listViews: { queryOptions: queryOptions("views") },
  },
} as unknown as BusabaseQueryUtils;

function setup({
  current = base,
  listed = [current],
  deletedFields = [],
  permission = "manage",
  save = vi.fn<DeleteField>().mockResolvedValue(undefined),
  restore = vi.fn<RestoreField>().mockResolvedValue(undefined),
}: {
  current?: BaseVO;
  listed?: BaseVO[];
  deletedFields?: BaseFieldVO[];
  permission?: "manage" | "changeRequest" | "write";
  save?: Mock<DeleteField>;
  restore?: Mock<RestoreField>;
} = {}) {
  const element = () => (
    <CoreI18nProvider locale="en">
      <SubmitPermissionProvider permissionLevel={permission}>
        <BaseSetupView
          base={current}
          bases={listed}
          deletedFields={deletedFields}
          orpc={orpc}
          onCreateField={vi.fn()}
          onDeleteField={save}
          onRestoreField={restore}
        />
      </SubmitPermissionProvider>
    </CoreI18nProvider>
  );
  const rendered = render(element());
  return { save, restore, rerender: () => rendered.rerender(element()) };
}

function openLookupDelete() {
  fireEvent.click(screen.getByTestId(`delete-field-${lookup.id}`));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  transport.views = [];
  transport.viewsPending = false;
  transport.viewsError = null;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("lookup field deletion", () => {
  it("offers deletion for lookup fields while protecting system and primary fields", () => {
    setup();
    expect(screen.getByTestId(`delete-field-${lookup.id}`)).toBeTruthy();
    expect(screen.queryByTestId("delete-field-fld_title")).toBeNull();
    expect(screen.queryByTestId("delete-field-fld_created")).toBeNull();
    expect(screen.getByTestId("delete-field-fld_note")).toBeTruthy();
    const primaryLookup = {
      ...base,
      fields: [{ ...lookup, position: -1 }, ...base.fields.slice(2)],
    };
    cleanup();
    setup({ current: primaryLookup });
    expect(screen.queryByTestId(`delete-field-${lookup.id}`)).toBeNull();
  });

  it("can request deletion without reading an inaccessible source or counting its computed values", async () => {
    const { save } = setup({ permission: "changeRequest" });
    const modal = openLookupDelete();
    expect(
      within(modal).getByText(
        /Source fields, source records, and record links will stay unchanged/,
      ),
    ).toBeTruthy();
    expect(within(modal).getAllByText(/brought back from Deleted Fields/).length).toBeGreaterThan(
      0,
    );
    expect(
      transport.query.mock.calls.some(([options]) => options.kind === "count" && options.enabled),
    ).toBe(false);
    expect(
      transport.query.mock.calls.some(([options]) => options.kind === "source" && options.enabled),
    ).toBe(false);
    fireEvent.click(within(modal).getByRole("button", { name: "Request delete" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(base, lookup.id, undefined));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the selected column and dialog on failure and allows retry", async () => {
    const save = vi
      .fn<DeleteField>()
      .mockRejectedValueOnce(new Error("Permission denied"))
      .mockResolvedValueOnce(undefined);
    setup({ save });
    const modal = openLookupDelete();
    fireEvent.click(within(modal).getByRole("button", { name: "Request delete" }));
    expect(await within(modal).findByText("Permission denied")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBe(modal);
    fireEvent.click(within(modal).getByRole("button", { name: "Request delete" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("blocks formulas using the lookup even if the Base list contains only link fields", () => {
    const formula = {
      ...field("invoice", "formula", 5),
      options: { formula: { expression: "SUM({fees})" } },
    };
    const current = { ...base, fields: [...base.fields, formula] };
    const { save } = setup({ current, listed: [{ ...base, fields: [lookup] }] });
    const modal = openLookupDelete();
    expect(within(modal).getByRole("alert").textContent).toContain("Update the formula fields");
    expect(within(modal).getByRole("link", { name: "Orders / invoice" })).toBeTruthy();
    const submit = within(modal).getByRole("button", {
      name: "Request delete",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole("link", { name: "Orders / invoice" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("localizes a newly introduced formula dependency rejected by the server", async () => {
    const save = vi.fn<DeleteField>().mockRejectedValue(
      Object.assign(new Error("Concurrent dependency"), {
        data: { reason: "lookup_has_formula_dependents" },
      }),
    );
    setup({ save });
    const modal = openLookupDelete();
    fireEvent.click(within(modal).getByRole("button", { name: "Request delete" }));
    expect(
      await within(modal).findByText(
        "Update the formula fields to stop referencing this lookup before deleting it.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("dialog")).toBe(modal);
  });

  it("blocks while dependency checks load or fail, with an explicit retry", () => {
    transport.viewsPending = true;
    const result = setup();
    const modal = openLookupDelete();
    expect(
      (within(modal).getByRole("button", { name: "Request delete" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    transport.viewsPending = false;
    transport.viewsError = new Error("Offline");
    result.rerender();
    fireEvent.click(within(modal).getByRole("button", { name: "Retry" }));
    expect(transport.refetchViews).toHaveBeenCalledOnce();
    expect(
      (within(modal).getByRole("button", { name: "Request delete" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    transport.viewsError = null;
    result.rerender();
    expect(
      (within(modal).getByRole("button", { name: "Request delete" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("restores deleted lookups through the same action as ordinary fields", async () => {
    const note = field("archived_note", "text", 6);
    const { restore } = setup({
      deletedFields: [{ ...lookup, id: "old_lookup", slug: "old_lookup" }, note],
    });
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(2);
    const [lookupRestore, noteRestore] = screen.getAllByRole("button", { name: "Restore" });
    if (!lookupRestore || !noteRestore) throw new Error("Expected both restore actions");
    fireEvent.click(lookupRestore);
    await waitFor(() => expect(restore).toHaveBeenCalledWith(base, "old_lookup"));
    fireEvent.click(noteRestore);
    await waitFor(() => expect(restore).toHaveBeenCalledWith(base, note.id));
  });
});

describe("formula field deletion", () => {
  const current = { ...base, fields: [...base.fields, formula] };
  const openFormulaDelete = () => {
    fireEvent.click(screen.getByTestId(`delete-field-${formula.id}`));
    return screen.getByRole("dialog");
  };

  it("offers formula deletion while preserving primary and protected system guards", () => {
    setup({ current });
    expect(screen.getByTestId(`delete-field-${formula.id}`)).toBeTruthy();
    expect(screen.queryByTestId("delete-field-fld_created")).toBeNull();
    cleanup();
    setup({ current: { ...current, fields: [{ ...formula, position: -1 }, ...base.fields] } });
    expect(screen.queryByTestId(`delete-field-${formula.id}`)).toBeNull();
  });

  it("uses metadata only and preserves inputs, cancellation and immediate submission", async () => {
    const result = setup({ current, permission: "write" });
    expect(getFieldDependencies).not.toHaveBeenCalled();
    expect(
      transport.query.mock.calls.some(([options]) => options.kind === "views" && options.enabled),
    ).toBe(false);
    let modal = openFormulaDelete();
    expect(
      within(modal).getByText(
        /The input fields and records used in its calculation will stay unchanged/,
      ),
    ).toBeTruthy();
    expect(within(modal).getAllByText(/brought back from Deleted Fields/).length).toBeGreaterThan(
      0,
    );
    expect(within(modal).queryByRole("alert")).toBeNull();
    expect(
      transport.query.mock.calls.some(([options]) => options.kind === "count" && options.enabled),
    ).toBe(false);
    expect(
      transport.query.mock.calls.some(([options]) => options.kind === "records" && options.enabled),
    ).toBe(false);
    const parses = vi.mocked(getFieldDependencies).mock.calls.length;
    result.rerender();
    expect(getFieldDependencies).toHaveBeenCalledTimes(parses);
    fireEvent.click(within(modal).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(result.save).not.toHaveBeenCalled();
    modal = openFormulaDelete();
    fireEvent.keyDown(within(modal).getByRole("button", { name: "More submit options" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete now" }));
    await waitFor(() =>
      expect(result.save).toHaveBeenCalledWith(current, formula.id, { mergeImmediately: true }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("permits deleting an invalid formula, retains failures and retries the same column", async () => {
    const invalid = {
      ...current,
      fields: [...base.fields, { ...formula, options: { formula: { expression: "INVALID(" } } }],
    };
    const save = vi
      .fn<DeleteField>()
      .mockRejectedValueOnce(new Error("Permission denied"))
      .mockResolvedValueOnce(undefined);
    setup({ current: invalid, save });
    const modal = openFormulaDelete();
    fireEvent.click(within(modal).getByRole("button", { name: "Request delete" }));
    expect(await within(modal).findByText("Permission denied")).toBeTruthy();
    fireEvent.click(within(modal).getByRole("button", { name: "Request delete" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls.every(([, id]) => id === formula.id)).toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it.each(["formula", "lookup"] as const)(
    "blocks a downstream %s and closes the modal when locating it",
    (kind) => {
      const consumerField: BaseFieldVO =
        kind === "formula"
          ? {
              ...field("invoice", "formula", 6),
              options: { formula: { expression: '{amount} & " total"' } },
            }
          : {
              ...lookup,
              id: "fld_total_lookup",
              slug: "total_lookup",
              name: "total_lookup",
              baseId: "bas_consumers",
              options: {
                lookup: {
                  relationFieldSlug: "orders",
                  targetFieldSlug: "amount",
                  rollup: "values",
                },
              },
            };
      const consumer = {
        ...base,
        id: "bas_consumers",
        name: "Consumers",
        slug: "consumers",
        fields: [
          {
            ...field("orders", "relation", 0),
            baseId: "bas_consumers",
            options: { targetBaseId: base.id },
          },
          consumerField,
        ],
      };
      const selected =
        kind === "formula" ? { ...current, fields: [...current.fields, consumerField] } : current;
      const { save } = setup({
        current: selected,
        listed: [{ ...current, fields: [formula] }, ...(kind === "lookup" ? [consumer] : [])],
      });
      const modal = openFormulaDelete();
      expect(within(modal).getByRole("alert").textContent).toBe(
        "Update the fields using this formula to stop referencing it before deleting it.",
      );
      expect(
        (within(modal).getByRole("button", { name: "Request delete" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      fireEvent.click(
        within(modal).getByRole("link", {
          name: kind === "formula" ? "Orders / invoice" : "Consumers / total_lookup",
        }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(save).not.toHaveBeenCalled();
    },
  );

  it.each(["formula_has_dependents", "formula_has_lookup_dependents"])(
    "localizes server dependency reason %s without exposing restricted names",
    async (reason) => {
      const save = vi.fn<DeleteField>().mockRejectedValue(
        Object.assign(new Error("Restricted consumer secret-name"), {
          data: { reason, hasRestrictedDependents: true },
        }),
      );
      setup({ current, save });
      const modal = openFormulaDelete();
      fireEvent.click(within(modal).getByRole("button", { name: "Request delete" }));
      expect(
        await within(modal).findByText(
          "Update the fields using this formula to stop referencing it before deleting it.",
        ),
      ).toBeTruthy();
      expect(within(modal).queryByText(/secret-name/)).toBeNull();
      expect(screen.getByRole("dialog")).toBe(modal);
    },
  );

  it("restores formula columns using the ordinary restore action", async () => {
    const { restore } = setup({ current: base, deletedFields: [formula] });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(base, formula.id));
  });
});
