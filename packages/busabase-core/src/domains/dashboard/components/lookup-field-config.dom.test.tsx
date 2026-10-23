// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseFieldVO, BaseVO, RecordVO } from "busabase-contract/types";
import { type ReactNode, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";

vi.mock("wouter", () => ({ useSearch: () => "" }));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
const { LookupFieldConfig } = await import("./lookup-field-config");
type Draft = Parameters<typeof LookupFieldConfig>[0]["value"];
const relation = {
  id: "relation",
  baseId: "students",
  slug: "courses",
  name: "选课",
  type: "relation",
  required: false,
  position: 1,
  options: { targetBaseId: "courses" },
} as BaseFieldVO;
const price = {
  id: "fee",
  baseId: "courses",
  slug: "fee",
  name: "学费",
  type: "number",
  required: false,
  position: 1,
  options: { number: { format: "currency", currency: "EUR" } },
} as BaseFieldVO;
const title = {
  ...price,
  id: "title",
  slug: "title",
  name: "课程名称",
  type: "text",
  position: 0,
  options: {},
} as BaseFieldVO;
const source = { id: "students", slug: "students", name: "学生", fields: [relation] } as BaseVO;
const target = { id: "courses", slug: "courses", name: "课程", fields: [title, price] } as BaseVO;
const targets = [12, 8].map((fee, i) => ({
  id: `rec${i}`,
  baseId: target.id,
  base: target,
  headCommit: { payload: { title: `课程${i}`, fee } },
})) as unknown as RecordVO[];
const sample = {
  id: "student",
  baseId: source.id,
  base: { ...source, fields: [{ ...title, baseId: source.id }, relation] },
  headCommit: { payload: { title: "张三", courses: ["rec0", "rec1"] } },
} as unknown as RecordVO;
const queryOptions =
  (scope: string, fn: (input: Record<string, unknown>) => unknown) =>
  ({ input }: { input: Record<string, unknown> }) => ({
    queryKey: ["lookup-test", scope, input],
    queryFn: async () => fn(input),
  });
const mockOrpc = (
  samples: RecordVO[] = [sample],
  get = vi.fn((input: Record<string, unknown>) =>
    targets.find((record) => record.id === input.recordId),
  ),
  getBase = vi.fn(() => target),
) =>
  ({
    bases: { get: { queryOptions: queryOptions("base", getBase) } },
    records: {
      listPage: { queryOptions: queryOptions("page", () => ({ records: samples })) },
      get: { queryOptions: queryOptions("get", get) },
    },
  }) as unknown as BusabaseQueryUtils;
function show({
  initial,
  samples,
  base = source,
  bases = [source, target],
  onCreateRelation,
  orpc,
}: {
  initial?: Draft;
  samples?: RecordVO[];
  base?: BaseVO;
  bases?: BaseVO[];
  onCreateRelation?: () => void;
  orpc?: BusabaseQueryUtils;
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [draft, setDraft] = useState<Draft>(
      initial ?? { relationFieldSlug: "courses", targetFieldSlug: "fee", rollup: "values" },
    );
    return (
      <>
        <LookupFieldConfig
          base={base}
          bases={bases}
          mode="edit"
          onChange={setDraft}
          onCreateRelation={onCreateRelation}
          orpc={orpc ?? mockOrpc(samples)}
          value={draft}
        />
        <output data-testid="draft">{JSON.stringify(draft)}</output>
      </>
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <CoreI18nProvider locale="zh-CN">
        <Harness />
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
}
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(cleanup);
describe("shared lookup configuration", () => {
  it("reflects external reset of an existing controlled rollup draft in both directions", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const orpc = mockOrpc();
    const view = (rollup: Draft["rollup"]) => (
      <QueryClientProvider client={queryClient}>
        <CoreI18nProvider locale="zh-CN">
          <LookupFieldConfig
            base={source}
            bases={[source, target]}
            mode="edit"
            onChange={vi.fn()}
            orpc={orpc}
            value={{ relationFieldSlug: "courses", targetFieldSlug: "fee", rollup }}
          />
        </CoreI18nProvider>
      </QueryClientProvider>
    );
    const rendered = render(view("sum"));
    await waitFor(() => expect(screen.getByTestId("edit-field-lookup-rollup")).toBeTruthy());
    expect((screen.getByRole("radio", { name: "汇总计算" }) as HTMLInputElement).checked).toBe(
      true,
    );
    rendered.rerender(view("values"));
    expect((screen.getByRole("radio", { name: "原值" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId("edit-field-lookup-rollup")).toBeNull();
    rendered.rerender(view("average"));
    expect((screen.getByRole("radio", { name: "汇总计算" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByTestId("edit-field-lookup-rollup") as HTMLSelectElement).value).toBe(
      "average",
    );
  });

  it("loads ordinary target fields from the full schema when the catalog only has links", async () => {
    const getBase = vi.fn(() => target);
    show({
      bases: [source, { ...target, fields: [] }],
      orpc: mockOrpc([sample], undefined, getBase),
    });
    await waitFor(() =>
      expect(screen.getByTestId("edit-field-lookup-target").textContent).toContain("学费"),
    );
    expect(getBase).toHaveBeenCalledWith({ baseId: target.id });
    fireEvent.click(screen.getByTestId("edit-field-lookup-target"));
    expect(screen.getByRole("option", { name: /课程名称/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /学费/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("lookup-preview").textContent).toContain("€12"));
  });
  it("does not fetch schemas or preview records for targets outside the accessible catalog", () => {
    const getBase = vi.fn(() => target);
    const getRecord = vi.fn(() => targets[0]);
    show({ bases: [source], orpc: mockOrpc([sample], getRecord, getBase) });
    expect(getBase).not.toHaveBeenCalled();
    expect(getRecord).not.toHaveBeenCalled();
    expect((screen.getByTestId("edit-field-lookup-target") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByTestId("lookup-preview")).toBeNull();
  });
  it("hides catalog field names and previews when loading the full schema fails", async () => {
    const getBase = vi.fn(() => {
      throw new Error("Forbidden");
    });
    show({ orpc: mockOrpc([sample], undefined, getBase) });
    await waitFor(() => expect(screen.getByText("来源不可用或无权访问")).toBeTruthy());
    expect((screen.getByTestId("edit-field-lookup-target") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByTestId("edit-field-lookup-target").textContent).not.toContain("学费");
    expect(screen.queryByTestId("lookup-preview")).toBeNull();
  });
  it("shows source failure rather than partial totals and retries", async () => {
    let fail = true;
    const get = vi.fn((input: Record<string, unknown>) => {
      if (fail && input.recordId === "rec0") throw new Error("Unavailable");
      return targets.find((record) => record.id === input.recordId);
    });
    show({ orpc: mockOrpc([sample], get) });
    await waitFor(() => expect(screen.getByText("来源加载失败")).toBeTruthy());
    expect(screen.getByTestId("lookup-preview").textContent).not.toContain("€8");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByTestId("lookup-preview").textContent).toContain("€12"));
    expect(screen.getByTestId("lookup-preview").textContent).toContain("€8");
  });
  it("previews actual source values, then aggregates without saving", async () => {
    show();
    await waitFor(() => expect(screen.getByTestId("lookup-preview").textContent).toContain("€12"));
    expect(screen.getByTestId("lookup-preview").textContent).toContain("€8");
    fireEvent.click(screen.getByLabelText("汇总计算"));
    fireEvent.change(screen.getByTestId("edit-field-lookup-rollup"), { target: { value: "sum" } });
    await waitFor(() => expect(screen.getByTestId("lookup-preview").textContent).toContain("€20"));
    expect(screen.getByTestId("draft").textContent).toContain('"rollup":"sum"');
  });
  it("edits existing config and resets incompatible aggregation when target changes", async () => {
    show({ initial: { relationFieldSlug: "courses", targetFieldSlug: "fee", rollup: "sum" } });
    await waitFor(() =>
      expect((screen.getByTestId("edit-field-lookup-rollup") as HTMLSelectElement).value).toBe(
        "sum",
      ),
    );
    fireEvent.click(screen.getByTestId("edit-field-lookup-target"));
    fireEvent.change(screen.getByPlaceholderText("搜索字段"), { target: { value: "课程名称" } });
    fireEvent.click(screen.getByRole("option", { name: /课程名称/ }));
    expect(screen.getByTestId("draft").textContent).toContain('"rollup":"values"');
    expect(screen.getByTestId("draft").textContent).toContain('"targetFieldSlug":"title"');
  });
  it("offers a create relation command without performing writes", () => {
    const create = vi.fn();
    show({
      base: { ...source, fields: [] },
      initial: { relationFieldSlug: "", targetFieldSlug: "", rollup: "values" },
      onCreateRelation: create,
    });
    fireEvent.click(screen.getByRole("button", { name: "创建关联字段" }));
    expect(create).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("lookup-preview")).toBeNull();
  });
  it("does not present a partial aggregation for large samples", async () => {
    show({
      samples: [
        {
          ...sample,
          headCommit: {
            ...sample.headCommit,
            payload: { title: "张三", courses: Array.from({ length: 26 }, (_, i) => `rec${i}`) },
          },
        },
      ],
    });
    await waitFor(() =>
      expect(screen.getByText("关联记录较多，无法提供完整样本预览")).toBeTruthy(),
    );
    expect(screen.getByTestId("lookup-preview").textContent).not.toContain("€12");
  });
});
