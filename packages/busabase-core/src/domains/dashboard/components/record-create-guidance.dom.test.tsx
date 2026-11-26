// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseVO, RecordVO } from "busabase-contract/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CoreI18nProvider, type CoreLocale } from "../../../i18n";
import { AgentIntegrationProvider } from "../agent-integration-context";
import { DashboardVisitorProvider } from "../visitor-context";
import { RecordEditorView } from "./record-views";

const base = {
  id: "bas_products",
  nodeId: "nod_products",
  slug: "products",
  name: "Products",
  fields: [
    {
      id: "fld_name",
      baseId: "bas_products",
      slug: "name",
      name: "Name",
      type: "text",
      required: true,
      position: 0,
      options: {},
    },
  ],
} as BaseVO;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function openEditor({
  locale = "en",
  mode = "new",
  visitorKind = "member",
}: {
  locale?: CoreLocale;
  mode?: "new" | "edit";
  visitorKind?: "member" | "anonymous";
} = {}) {
  const submit = vi.fn(async () => {});
  const writeText = vi.fn(async (_text: string) => {});
  vi.stubGlobal("navigator", { clipboard: { writeText }, platform: "Linux" });
  const location = memoryLocation({ path: "/base/products/new" });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Router hook={location.hook} searchHook={location.searchHook}>
        <CoreI18nProvider locale={locale}>
          <AgentIntegrationProvider
            agentIntegration={{ edition: "cloud", targetSpaceId: "org_course" }}
          >
            <DashboardVisitorProvider visitorKind={visitorKind}>
              <RecordEditorView
                base={base}
                client={{} as BusabaseDashboardApiClient}
                mode={mode}
                record={
                  mode === "edit"
                    ? ({
                        id: "rec_existing",
                        base,
                        headCommit: { payload: { name: "Existing product" } },
                      } as unknown as RecordVO)
                    : null
                }
                records={[]}
                onSubmitCreate={submit}
                onSubmitUpdate={submit}
                onSubmitError={vi.fn()}
              />
            </DashboardVisitorProvider>
          </AgentIntegrationProvider>
        </CoreI18nProvider>
      </Router>
    </QueryClientProvider>,
  );
  return { submit, writeText };
}

describe("new-record practice guidance", () => {
  it.each([
    ["en", /Need an example/, "Agent prompts", "Create a practice record", "Fictional demo"],
    ["zh-CN", /不知道怎么填/, "Agent 提示词", "创建一条练习记录", "虚构演示"],
  ] as const)(
    "lets a learner hand an explicitly fictional, table-scoped request to their agent in %s",
    async (locale, help, button, scenario, fictionLabel) => {
      const { submit, writeText } = openEditor({ locale });
      expect(screen.getByText(help)).toBeTruthy();
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "My unfinished draft" } });
      fireEvent.click(screen.getByRole("button", { name: button }));
      fireEvent.click(screen.getByRole("button", { name: new RegExp(scenario) }));
      fireEvent.click(screen.getByTestId("agent-prompts-copy-button"));

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      const copied = writeText.mock.calls[0]?.[0] ?? "";
      expect(copied).toContain("nodeId: nod_products");
      expect(copied).toContain("spaceId: org_course");
      expect(copied).toContain(fictionLabel);
      expect(copied).toContain(locale === "en" ? "wait for my confirmation" : "等我确认后再保存");
      expect(copied).toContain(
        locale === "en" ? "Do not invent real product facts" : "不要编造真实商品资料",
      );
      expect(submit).not.toHaveBeenCalled();
      expect(screen.getByDisplayValue("My unfinished draft")).toBeTruthy();
    },
  );

  it.each([
    { mode: "edit" as const, visitorKind: "member" as const },
    { mode: "new" as const, visitorKind: "anonymous" as const },
  ])("keeps practice help out of $mode mode for a $visitorKind viewer", (options) => {
    openEditor(options);
    expect(screen.queryByText(/Need an example/)).toBeNull();
    expect(screen.queryByTestId("node-agent-prompts-button")).toBeNull();
  });
});
