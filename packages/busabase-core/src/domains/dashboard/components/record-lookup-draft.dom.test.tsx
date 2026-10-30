// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseFieldVO, BaseVO, RecordVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { DashboardOrpcProvider } from "../orpc-context";

vi.mock("wouter", () => ({
  useSearch: () => "",
  useLocation: () => ["/base/projects/new", vi.fn()],
}));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("./relation-field", () => ({
  RelationFieldEditor: ({
    value,
    onChange,
  }: {
    value: string[];
    onChange: (ids: string[]) => void;
  }) => (
    <button onClick={() => onChange(value.length ? [] : ["expense-1"])} type="button">
      Toggle expense
    </button>
  ),
}));
const { RecordFieldInput, RecordEditorView } = await import("./record-views");
const field = (patch: Partial<BaseFieldVO>): BaseFieldVO => ({
  id: "title",
  slug: "title",
  baseId: "projects",
  name: "Title",
  type: "text",
  required: false,
  position: 0,
  options: {},
  ...patch,
});
const relation = field({
  id: "expenses",
  slug: "expenses",
  name: "Expenses",
  type: "relation",
  options: { targetBaseId: "expenses", multiple: true },
});
const lookup = field({
  id: "spent",
  slug: "spent",
  name: "Spent",
  type: "lookup",
  options: { lookup: { relationFieldSlug: "expenses", targetFieldSlug: "amount", rollup: "sum" } },
});
const amount = field({
  id: "amount",
  slug: "amount",
  baseId: "expenses",
  name: "Amount",
  type: "number",
});
const source = {
  id: "expenses",
  slug: "expenses",
  name: "Expenses",
  fields: [field({ baseId: "expenses" }), amount],
} as BaseVO;
const base = {
  id: "projects",
  slug: "projects",
  name: "Projects",
  fields: [
    field({}),
    relation,
    lookup,
    field({ id: "created", slug: "created", name: "Created system", type: "created_time" }),
    field({ id: "ai", slug: "ai", name: "AI text", type: "ai_summary" }),
  ],
} as BaseVO;
const target = {
  id: "expense-1",
  baseId: "expenses",
  base: source,
  headCommit: { id: "commit-1", payload: { title: "Train", amount: 100 } },
} as unknown as RecordVO;
// `getRecord` is the per-record resolver behind the batched `getRecords` the
// preview actually calls; asserting on it still says WHICH ids were read.
const client = (
  getBase = vi.fn(async () => source),
  getRecord: (recordId: string) => Promise<RecordVO> = vi.fn(async (_recordId: string) => target),
) => {
  const getRecords = vi.fn(async (ids: string[]) => ({
    records: await Promise.all(ids.map((id) => getRecord(id))),
    missingIds: [] as string[],
  }));
  return { getBase, getRecord, getRecords } as unknown as BusabaseDashboardApiClient & {
    getRecords: typeof getRecords;
  };
};
const orpc = createBusabaseQueryUtils("http://localhost/api/rpc", {}, "workspace-a");
afterEach(cleanup);
const harness = (
  children: ReactNode,
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  utils = orpc,
) => (
  <QueryClientProvider client={cache}>
    <DashboardOrpcProvider orpc={utils}>
      <CoreI18nProvider locale="en">{children}</CoreI18nProvider>
    </DashboardOrpcProvider>
  </QueryClientProvider>
);
const input = (
  api: BusabaseDashboardApiClient,
  patch: Partial<Parameters<typeof RecordFieldInput>[0]> = {},
) => (
  <RecordFieldInput
    client={api}
    editorBase={base}
    editorInstanceKey="new"
    field={lookup}
    draftRelationIds={[target.id]}
    records={[]}
    onChange={vi.fn()}
    value=""
    {...patch}
  />
);
const preview = () => screen.getByTestId("lookup-field-spent");

describe("new record lookup preview", () => {
  it("shows only the Lookup computed field on create, previews selection changes and never submits it", async () => {
    const api = client();
    const submit = vi.fn(async (_base: BaseVO, _fields: Record<string, unknown>) => undefined);
    const rendered = render(
      harness(
        <RecordEditorView
          base={base}
          client={api}
          mode="new"
          record={null}
          records={[]}
          onSubmitError={vi.fn()}
          onSubmitCreate={submit}
        />,
      ),
    );
    await waitFor(() => expect(preview().textContent).toContain("No linked records"));
    expect(screen.queryByText("Created system")).toBeNull();
    expect(screen.queryByText("AI text")).toBeNull();
    expect(api.getRecord).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Toggle expense" }));
    await waitFor(() => expect(preview().textContent).toContain("100"));
    expect(preview().textContent).toContain("Unsaved preview");
    fireEvent.click(screen.getByRole("button", { name: "Submit Now" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]?.[1]).toEqual({ title: "", expenses: [target.id], ai: "" });
    rendered.unmount();
  });

  it("leaves the preview unsaved when the new editor is cancelled", async () => {
    const submit = vi.fn(async () => undefined);
    const rendered = render(
      harness(
        <RecordEditorView
          base={base}
          client={client()}
          mode="new"
          record={null}
          records={[]}
          onSubmitError={vi.fn()}
          onSubmitCreate={submit}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle expense" }));
    await waitFor(() => expect(preview().textContent).toContain("100"));
    rendered.unmount();
    expect(submit).not.toHaveBeenCalled();
  });

  it("supports a changed relation in an existing editor without using its previous committed Lookup", async () => {
    const api = client();
    render(
      harness(
        input(api, {
          editorInstanceKey: "existing-record",
          computed: {
            status: "ready",
            value: 999,
            targetField: amount,
            sourceBaseId: source.id,
            sources: [],
            dependencyVersion: "old",
          },
          value: 999,
        }),
      ),
    );
    await waitFor(() => expect(preview().textContent).toContain("100"));
    expect(preview().textContent).not.toContain("999");
    expect(preview().textContent).toContain("Unsaved preview");
  });

  it("shows the bounded-preview limit and honors first-linked mode", async () => {
    const api = client();
    const rendered = render(
      harness(
        input(api, {
          draftRelationIds: Array.from({ length: 26 }, (_, index) => `expense-${index + 1}`),
        }),
      ),
    );
    await waitFor(() => expect(api.getBase).toHaveBeenCalled());
    expect(screen.getByText("Too many linked records for a sample preview")).toBeTruthy();
    expect(api.getRecord).not.toHaveBeenCalled();
    rendered.rerender(
      harness(
        input(api, {
          field: {
            ...lookup,
            options: {
              lookup: {
                relationFieldSlug: "expenses",
                targetFieldSlug: "amount",
                rollup: "sum",
                limit: "first",
              },
            },
          },
          draftRelationIds: Array.from({ length: 26 }, (_, index) => `expense-${index + 1}`),
        }),
      ),
    );
    await waitFor(() => expect(preview().textContent).toContain("100"));
    expect(api.getRecords).toHaveBeenCalledOnce();
    expect(api.getRecords).toHaveBeenCalledWith(["expense-1"]);
    expect(api.getRecord).toHaveBeenCalledOnce();
    expect(api.getRecord).toHaveBeenCalledWith("expense-1");
  });

  it("authorizes the source schema before reading any record", async () => {
    let resolveSource: (value: BaseVO) => void = () => undefined;
    const getBase = vi.fn(
      () =>
        new Promise<BaseVO>((resolve) => {
          resolveSource = resolve;
        }),
    );
    const getRecord = vi.fn(async () => target);
    render(harness(input(client(getBase, getRecord))));
    await waitFor(() => expect(getBase).toHaveBeenCalledWith(source.id));
    expect(getRecord).not.toHaveBeenCalled();
    resolveSource(source);
    await waitFor(() => expect(preview().textContent).toContain("100"));
    expect(getRecord).toHaveBeenCalledWith(target.id);
  });

  it("never reads records when source schema access fails, even with a cached computed value", async () => {
    const getBase = vi.fn(async () => {
      throw new Error("Forbidden");
    });
    const api = client(getBase);
    render(
      harness(
        input(api, {
          computed: {
            status: "ready",
            value: 999,
            targetField: amount,
            sourceBaseId: source.id,
            sources: [],
            dependencyVersion: "old",
          },
          value: 999,
        }),
      ),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(api.getRecord).not.toHaveBeenCalled();
    expect(screen.queryByTestId("lookup-field-spent")).toBeNull();
    expect(screen.queryByText("999")).toBeNull();
  });

  it.each(["wrong-base", "deleted-field", "lookup-field", "dynamic-formula"])(
    "fails closed for %s configuration",
    async (kind) => {
      const schema =
        kind === "wrong-base"
          ? { ...source, id: "unrelated" }
          : kind === "deleted-field"
            ? { ...source, fields: [] }
            : kind === "lookup-field"
              ? { ...source, fields: [{ ...amount, type: "lookup" as const }] }
              : {
                  ...source,
                  fields: [
                    field({ id: "origin", slug: "origin", type: "lookup" }),
                    {
                      ...amount,
                      type: "formula" as const,
                      options: { formula: { expression: "{origin} + 1" } },
                    },
                  ],
                };
      const api = client(vi.fn(async () => schema));
      render(harness(input(api)));
      await waitFor(() => expect(api.getBase).toHaveBeenCalled());
      await waitFor(() =>
        expect(
          screen.getByText(
            kind === "wrong-base" ? "Could not load source" : "Lookup configuration is invalid",
          ),
        ).toBeTruthy(),
      );
      expect(api.getRecord).not.toHaveBeenCalled();
      expect(screen.queryByTestId("lookup-field-spent")).toBeNull();
    },
  );

  it("rejects a source record from another Base instead of displaying its value", async () => {
    render(
      harness(
        input(
          client(
            undefined,
            vi.fn(async () => ({ ...target, baseId: "secret" })),
          ),
        ),
      ),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(screen.queryByTestId("lookup-field-spent")).toBeNull();
  });

  it("clears the old result on source ACL revalidation and does not read hidden records", async () => {
    let denied = false;
    const getBase = vi.fn(async () => {
      if (denied) throw new Error("Forbidden");
      return source;
    });
    const getRecord = vi.fn(async () => target);
    const api = client(getBase, getRecord);
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(harness(input(api), cache));
    await waitFor(() => expect(preview().textContent).toContain("100"));
    denied = true;
    const count = getRecord.mock.calls.length;
    await cache.invalidateQueries({ queryKey: orpc.bases.get.key() });
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(screen.queryByTestId("lookup-field-spent")).toBeNull();
    expect(getRecord.mock.calls).toHaveLength(count);
    await waitFor(() =>
      expect(
        cache
          .getQueryCache()
          .getAll()
          .some((query) => JSON.stringify(query.state.data ?? {}).includes('"amount":100')),
      ).toBe(false),
    );
  });

  it("revalidates source values with the existing record query prefix, clearing failed cached totals", async () => {
    let fail = false;
    let price = 100;
    const getRecord = vi.fn(async () => {
      if (fail) throw new Error("Revoked");
      return {
        ...target,
        headCommit: { ...target.headCommit, payload: { title: "Train", amount: price } },
      };
    });
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(harness(input(client(undefined, getRecord)), cache));
    await waitFor(() => expect(preview().textContent).toContain("100"));
    price = 150;
    await cache.invalidateQueries({ queryKey: orpc.records.get.key() });
    await waitFor(() => expect(preview().textContent).toContain("150"));
    fail = true;
    await cache.invalidateQueries({ queryKey: orpc.records.get.key() });
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(screen.queryByTestId("lookup-field-spent")).toBeNull();
    expect(
      cache
        .getQueryCache()
        .getAll()
        .some((query) => JSON.stringify(query.state.data ?? {}).includes('"amount":150')),
    ).toBe(false);
  });

  it("isolates identical Base/field/record ids between workspace and credential scopes", async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = render(harness(input(client()), cache));
    await waitFor(() => expect(preview().textContent).toContain("100"));
    const denied = client(
      vi.fn(async () => {
        throw new Error("Forbidden");
      }),
    );
    rendered.rerender(
      harness(
        input(denied),
        cache,
        createBusabaseQueryUtils("http://localhost/api/rpc", {}, "workspace-b"),
      ),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(screen.queryByTestId("lookup-field-spent")).toBeNull();
    expect(denied.getRecord).not.toHaveBeenCalled();
  });
});
