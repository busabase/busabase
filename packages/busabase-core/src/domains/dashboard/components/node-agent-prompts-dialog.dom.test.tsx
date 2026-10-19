// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { AgentIntegrationProvider } from "../agent-integration-context";
import type { NodePromptScope } from "../helpers/node-agent-prompts";
import { DashboardOrpcProvider } from "../orpc-context";
import { NodeAgentPromptsDialog } from "./node-agent-prompts-dialog";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("NodeAgentPromptsDialog stable workspace identity", () => {
  const canonicalId = "org_stable_workspace";
  const types = ["airapp", "base", "folder", "doc", "filetree", "skill", "form"];

  it.each(types)("uses the host space id for %s prompts after an address rename", (nodeType) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (targetSpaceId: string, spaceId?: string) => (
      <CoreI18nProvider locale="zh-CN">
        <QueryClientProvider client={client}>
          <AgentIntegrationProvider agentIntegration={{ edition: "cloud", targetSpaceId }}>
            <NodeAgentPromptsDialog
              nodeId="nod_ops"
              nodeName="Ops Overview"
              nodeType={nodeType}
              onOpenChange={() => {}}
              open
              orpc={null}
              spaceId={spaceId}
            />
          </AgentIntegrationProvider>
        </QueryClientProvider>
      </CoreI18nProvider>
    );
    window.history.replaceState({}, "", "/dashboard/old-custom-slug/airapp/ops");
    const { rerender } = render(view(canonicalId));
    const prompt = () => screen.getByRole("dialog").textContent ?? "";
    expect(prompt()).toContain(`spaceId: ${canonicalId}`);
    expect(prompt()).not.toContain("spaceId: old-custom-slug");

    // Renaming changes the URL, never the database identity.
    window.history.replaceState({}, "", "/dashboard/new-custom-slug/airapp/ops");
    rerender(view(canonicalId));
    expect(prompt()).toContain(`spaceId: ${canonicalId}`);
    expect(prompt()).not.toContain("spaceId: new-custom-slug");

    // Subdomain workbenches have no workspace token in the pathname at all.
    window.history.replaceState({}, "", "/dashboard/airapp/ops");
    rerender(view(canonicalId));
    expect(prompt()).toContain(`spaceId: ${canonicalId}`);
    expect(prompt()).not.toContain("spaceId: airapp");

    // Switching spaces while the dialog is mounted must replace the target.
    rerender(view("org_second_workspace"));
    expect(prompt()).toContain("spaceId: org_second_workspace");
    expect(prompt()).not.toContain(`spaceId: ${canonicalId}`);

    rerender(view(canonicalId, "org_explicit_workspace"));
    expect(prompt()).toContain("spaceId: org_explicit_workspace");
  });

  it("uses the explicit shell target without a provider and omits unknown local targets", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (targetSpaceId?: string) => (
      <CoreI18nProvider locale="en">
        <QueryClientProvider client={client}>
          <NodeAgentPromptsDialog
            agentIntegration={targetSpaceId ? { edition: "cloud", targetSpaceId } : undefined}
            nodeId="nod_ops"
            nodeName="Ops Overview"
            nodeType="airapp"
            onOpenChange={() => {}}
            open
            orpc={null}
          />
        </QueryClientProvider>
      </CoreI18nProvider>
    );
    window.history.replaceState({}, "", "/dashboard/renamed-slug/airapp/ops");
    const { rerender } = render(view(canonicalId));
    expect(screen.getByRole("dialog").textContent).toContain(`spaceId: ${canonicalId}`);
    rerender(view());
    expect(screen.getByRole("dialog").textContent).not.toContain("spaceId:");
  });
});

/**
 * `orpc={null}` keeps these pure layout checks: no fetch, no Ask Agent action,
 * just the dialog shell and `AgentPromptsView`'s built-in defaults.
 */
describe("NodeAgentPromptsDialog responsive layout", () => {
  it("matches Settings sizing while keeping narrow and short viewports bounded", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <CoreI18nProvider locale="en">
        <QueryClientProvider client={client}>
          <NodeAgentPromptsDialog
            nodeId="nod_report"
            nodeName="Quarterly report"
            nodeType="doc"
            onOpenChange={() => {}}
            open
            orpc={null}
          />
        </QueryClientProvider>
      </CoreI18nProvider>,
    );

    const heading = screen.getByRole("heading", { name: /Agent prompts/ });
    const dialog = heading.closest('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.className).toContain("h-[80vh]");
    expect(dialog?.className).toContain("max-h-[calc(100dvh-2rem)]");
    expect(dialog?.className).toContain("w-[min(96vw,1020px)]");
    expect(dialog?.className).toContain("sm:h-[min(640px,calc(100dvh-2rem))]");
    expect(dialog?.className).toContain("sm:max-w-[1020px]");

    // Mobile stacks the list and preview, so the body must scroll. At the
    // desktop breakpoint the full-height panel takes over and its two panes
    // own their overflow independently.
    const scrollBody = dialog?.querySelector(":scope > div.min-h-0");
    expect(scrollBody?.className).toContain("overflow-y-auto");
    expect(scrollBody?.className).toContain("sm:overflow-hidden");

    const promptPanel = scrollBody?.firstElementChild;
    expect(promptPanel?.className).toContain("sm:h-full");
    expect(promptPanel?.className).not.toContain("sm:h-auto");
  });
});

describe("NodeAgentPromptsDialog scope-gated fetch", () => {
  const scopes: Array<{ label: string; scope: NodePromptScope }> = [
    { label: "field", scope: { kind: "field", fieldName: "Owner", fieldSlug: "owner" } },
    { label: "record", scope: { kind: "record", recordId: "rec_1" } },
    {
      label: "cell",
      scope: {
        kind: "cell",
        recordId: "rec_1",
        fieldName: "Owner",
        fieldSlug: "owner",
      },
    },
  ];

  it.each(scopes)(
    "keeps Ask Agent but skips node custom prompts for a $label scope",
    async ({ scope }) => {
      const queryFn = vi.fn(async () => ({ nodeId: "nod_companies", agentPrompts: null }));
      const contextOrpc = {
        nodes: {
          getAgentPrompts: {
            queryOptions: () => ({ queryKey: ["node-agent-prompts", "nod_companies"], queryFn }),
          },
          updateAgentPrompts: {
            mutationOptions: () => ({
              mutationFn: async () => ({ nodeId: "nod_companies", agentPrompts: null }),
            }),
          },
        },
        agents: {
          catalog: {
            queryOptions: () => ({ queryKey: ["agents", "catalog"], queryFn: async () => [] }),
          },
          connections: {
            list: {
              queryOptions: () => ({
                queryKey: ["agents", "connections", "space"],
                queryFn: async () => [],
              }),
            },
          },
          sessions: {
            list: {
              queryKey: () => ["agents", "sessions"],
              queryOptions: () => ({ queryKey: ["agents", "sessions"], queryFn: async () => [] }),
            },
            create: {
              mutationOptions: () => ({ mutationFn: async () => ({ id: "sess_1" }) }),
            },
          },
        },
      } as unknown as BusabaseQueryUtils;
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <CoreI18nProvider locale="en">
          <QueryClientProvider client={client}>
            <DashboardOrpcProvider orpc={contextOrpc}>
              <NodeAgentPromptsDialog
                nodeId="nod_companies"
                nodeName="Companies"
                nodeType="base"
                onOpenChange={() => {}}
                open
                orpc={null}
                scope={scope}
              />
            </DashboardOrpcProvider>
          </QueryClientProvider>
        </CoreI18nProvider>,
      );

      await screen.findByRole("heading", { name: /Agent prompts/ });
      expect(screen.getByRole("button", { name: "Ask Agent" })).toBeTruthy();
      expect(queryFn).not.toHaveBeenCalled();
    },
  );
});
