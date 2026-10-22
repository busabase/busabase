// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { DashboardVisitorProvider } from "../visitor-context";

vi.mock("wouter", () => ({ useLocation: () => ["/drive/shared", vi.fn()], useSearch: () => "" }));
const prompts = vi.hoisted(() => vi.fn());
vi.mock("../hooks/use-node-agent-prompts", () => ({ useNodeAgentPrompts: prompts }));
vi.mock("./field-preview", () => ({
  MarkdownFieldPreview: ({ value }: { value: string }) => <p>{value}</p>,
}));

const { DriveDetailView, SkillDetailView } = await import("./node-detail-views");

function makeOrpc(type: "skill" | "drive") {
  const filePath = type === "skill" ? "SKILL.md" : "README.md";
  const node = {
    id: `nod_${type}`,
    type,
    slug: "shared",
    name: "Shared",
    description: "",
    metadata: {},
    settings: {},
    icon: null,
    children: [],
  };
  const file = {
    path: filePath,
    name: filePath,
    assetId: "asset_shared",
    mimeType: "text/markdown",
    displayName: filePath,
    size: 20,
    updatedAt: null,
  };
  const readFile = vi.fn(async () => ({
    nodeId: node.id,
    path: filePath,
    content: "Public file contents",
    encoding: "utf8",
    mimeType: "text/markdown",
    assetId: file.assetId,
    assetUrl: "/file.md",
    contentHash: "test",
  }));
  const previewConfig = vi.fn(async () => ({ provider: "previewfile", status: "ready" }));
  const preparePreview = vi.fn();
  const mutate = vi.fn();
  const orpc = {
    nodes: {
      get: {
        queryOptions: () => ({
          queryKey: ["nodes", type],
          queryFn: async () => ({ type, node, entryFile: filePath, files: [file] }),
        }),
      },
    },
    fileTrees: {
      readFile: {
        queryOptions: ({ input }: { input: { filePath: string } }) => ({
          queryKey: ["file", type, input.filePath],
          queryFn: readFile,
        }),
      },
      previewConfig: {
        queryOptions: () => ({ queryKey: ["preview-config"], queryFn: previewConfig }),
      },
      createChangeRequest: { mutationOptions: () => ({ mutationFn: mutate }) },
      preparePreview: { mutationOptions: () => ({ mutationFn: preparePreview }) },
    },
  } as unknown as BusabaseQueryUtils;
  return { orpc, previewConfig, preparePreview, mutate, readFile };
}

afterEach(() => {
  cleanup();
  prompts.mockReset();
});

describe("public file-tree node details", () => {
  it.each(["skill", "drive"] as const)(
    "opens %s's entry file without member controls or private queries",
    async (type) => {
      const state = makeOrpc(type);
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      // Even a stale member config cannot start external conversion anonymously.
      queryClient.setQueryData(["preview-config"], { provider: "previewfile", status: "ready" });
      render(
        <CoreI18nProvider locale="en">
          <QueryClientProvider client={queryClient}>
            <DashboardVisitorProvider visitorKind="anonymous">
              {type === "skill" ? (
                <SkillDetailView orpc={state.orpc} slug="shared" />
              ) : (
                <DriveDetailView orpc={state.orpc} slug="shared" />
              )}
            </DashboardVisitorProvider>
          </QueryClientProvider>
        </CoreI18nProvider>,
      );
      expect(await screen.findByText("Public file contents")).toBeTruthy();
      await waitFor(() => expect(state.readFile).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
      expect(screen.queryByText("Parsed text")).toBeNull();
      expect(screen.queryByRole("tab", { name: /agent/i })).toBeNull();
      expect(prompts).not.toHaveBeenCalled();
      expect(state.previewConfig).not.toHaveBeenCalled();
      expect(state.preparePreview).not.toHaveBeenCalled();
      expect(state.mutate).not.toHaveBeenCalled();
    },
  );
});
