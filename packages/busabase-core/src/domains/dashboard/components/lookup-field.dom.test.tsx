// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BaseFieldVO, LookupComputedVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";

vi.mock("wouter", () => ({ useSearch: () => "?spaceId=space" }));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const { LookupFieldValue } = await import("./field-preview");
const field: BaseFieldVO = {
  id: "lookup",
  baseId: "students",
  slug: "fees",
  name: "学费",
  type: "lookup",
  position: 1,
  required: false,
  options: { lookup: { relationFieldSlug: "courses", targetFieldSlug: "fee", rollup: "values" } },
};
const target: BaseFieldVO = {
  id: "fee",
  baseId: "courses",
  slug: "fee",
  name: "学费",
  type: "number",
  position: 1,
  required: false,
  options: { number: { format: "currency", currency: "EUR" } },
};
const computed = (patch: Partial<LookupComputedVO> = {}): LookupComputedVO => ({
  status: "ready",
  value: [12],
  targetField: target,
  sourceBaseId: "courses",
  sourceBaseSlug: "courses",
  sources: [{ recordId: "rec1", title: "数学", value: 12, headCommitId: "commit1" }],
  dependencyVersion: "v1",
  ...patch,
});
const show = (props: Partial<Parameters<typeof LookupFieldValue>[0]> = {}) =>
  render(
    <CoreI18nProvider locale="zh-CN">
      <LookupFieldValue computed={computed()} field={field} value={[12]} {...props} />
    </CoreI18nProvider>,
  );
afterEach(cleanup);

describe("lookup typed result", () => {
  it("formats calendar dates without raw JSON", () => {
    show({
      computed: computed({
        targetField: { ...target, type: "date", options: { date: { includeTime: false } } },
        value: ["2026-10-12"],
        sources: [],
      }),
    });
    expect(screen.getByTestId("lookup-field-fees").textContent).toContain("2026");
    expect(screen.getByTestId("lookup-field-fees").textContent).not.toContain('["');
  });
  it("resolves member names including source detail", () => {
    show({
      fieldUsers: { user1: { id: "user1", name: "王老师", email: null, image: null, role: null } },
      computed: computed({
        targetField: { ...target, type: "member", options: {} },
        value: ["user1"],
        sources: [{ recordId: "rec1", title: "数学", value: ["user1"], headCommitId: "commit1" }],
      }),
    });
    expect(screen.getByText("王老师")).toBeTruthy();
    expect(screen.queryByText("user1")).toBeNull();
    fireEvent.click(screen.getByTestId("lookup-sources-fees"));
    expect(screen.getByTestId("lookup-source-dialog").textContent).toContain("王老师");
  });
  it("renders attachment names with safe preview links", () => {
    const attachment = {
      id: "file1",
      fileName: "成绩单.pdf",
      url: "https://example.com/report.pdf",
      mimeType: "application/pdf",
      size: 100,
    };
    show({
      computed: computed({
        targetField: { ...target, type: "attachment", options: {} },
        value: [attachment],
        sources: [],
      }),
    });
    expect(screen.getByRole("link", { name: "成绩单.pdf" }).getAttribute("href")).toBe(
      attachment.url,
    );
    expect(screen.queryByText("file1")).toBeNull();
  });
  it("renders false checkbox values rather than treating them as empty", () => {
    show({
      computed: computed({
        targetField: { ...target, type: "checkbox", options: {} },
        value: [false],
        sources: [],
      }),
    });
    expect(screen.getByText("否")).toBeTruthy();
    expect(screen.queryByText("来源值为空")).toBeNull();
  });
  it("renders latest source currency and source links", () => {
    show();
    expect(screen.getByTestId("lookup-field-fees").textContent).toContain("€12");
    fireEvent.click(screen.getByTestId("lookup-sources-fees"));
    expect(screen.getByTestId("lookup-source-dialog").textContent).toContain("数学");
    expect(screen.getByRole("link", { name: "数学" }).getAttribute("href")).toBe(
      "/base/courses/rec1?spaceId=space",
    );
  });
  it("resolves select identifiers to labels and colors", () => {
    show({
      computed: computed({
        targetField: {
          ...target,
          type: "select",
          options: { choices: [{ id: "passed", name: "通过", color: "green" }] },
        },
        value: ["passed"],
        sources: [],
      }),
    });
    expect(screen.getByText("通过").className).toContain("green");
    expect(screen.queryByText("passed")).toBeNull();
  });
  it("preserves duplicate values and expands overflow", () => {
    show({ computed: computed({ value: [1, 1, 2, 3, 4], sources: [] }) });
    expect(screen.getByTestId("lookup-sources-fees").textContent).toBe("+2");
    fireEvent.click(screen.getByTestId("lookup-sources-fees"));
    expect(screen.getByTestId("lookup-source-dialog").textContent).toContain("€4");
  });
  it("keeps zero count distinguishable from no links", () => {
    show({
      field: {
        ...field,
        options: {
          lookup: { relationFieldSlug: "courses", targetFieldSlug: "fee", rollup: "count" },
        },
      },
      computed: computed({ value: 0, status: "unlinked", sources: [] }),
    });
    expect(screen.getByTestId("lookup-field-fees").textContent).toContain("0");
    expect(screen.getByText("未关联记录")).toBeTruthy();
    expect(screen.getByTestId("lookup-field-fees").textContent).not.toContain("€");
  });
  it("does not render stale values or provenance for inaccessible sources", () => {
    show({
      computed: computed({
        status: "inaccessible",
        value: null,
        targetField: undefined,
        sourceBaseId: undefined,
        sourceBaseSlug: undefined,
        sources: [],
      }),
      value: [999],
    });
    expect(screen.getByText("来源不可用或无权访问")).toBeTruthy();
    expect(screen.queryByText("999")).toBeNull();
    expect(screen.queryByTestId("lookup-sources-fees")).toBeNull();
  });
  it("labels unsaved relation calculations as drafts", () => {
    show({ draft: true });
    expect(screen.getByText("未保存预览")).toBeTruthy();
  });
});
