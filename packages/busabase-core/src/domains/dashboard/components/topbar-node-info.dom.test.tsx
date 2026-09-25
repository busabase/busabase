// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, coreMessagesByLocale } from "../../../i18n";
import { useRegisterTopbarNodeInfo } from "../hooks/use-register-topbar-node-info";
import { useTopbarNodeInfoStore } from "../store/topbar-node-info-store";
import { BusabaseTopbarBreadcrumb } from "./topbar";

const messages = coreMessagesByLocale.en;

const detail = {
  type: "doc",
  body: "",
  node: {
    id: "nod_handbook",
    parentId: null,
    type: "doc",
    slug: "handbook",
    name: "Handbook",
    description: "Team reference",
    metadata: {},
    settings: {},
    explicitVisibility: null,
    icon: null,
    position: 0,
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    baseId: null,
    children: [],
  },
};

const orpc = {
  nodes: {
    get: {
      queryOptions: () => ({
        queryKey: ["nodes", "get", detail.node.id],
        queryFn: async () => detail,
      }),
    },
    list: { queryOptions: () => ({ queryKey: ["nodes", "list"] }) },
    updateSettings: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    createChangeRequest: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
  },
} as unknown as BusabaseQueryUtils;

/** Stands in for a node-detail view: registers, and nothing else. */
function RegisterProbe({
  description,
  enabled = true,
  name = "Handbook",
}: {
  description?: string | null;
  enabled?: boolean;
  name?: string;
}) {
  useRegisterTopbarNodeInfo(
    {
      description,
      nodeId: detail.node.id,
      nodeName: name,
      nodeSlug: detail.node.slug,
      nodeType: "doc",
      orpc,
    },
    enabled,
  );
  return null;
}

function renderTopbar(children: ReactNode, label = "Handbook") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale="en">
        {children}
        <div data-testid="topbar">
          <BusabaseTopbarBreadcrumb items={[{ href: "/home", label: "Workspace" }, { label }]} />
        </div>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  useTopbarNodeInfoStore.getState().setInfo(null);
});

describe("topbar node info slot", () => {
  it("shows no Info button until a detail view registers one", () => {
    renderTopbar(null);

    expect(screen.queryByRole("button", { name: messages.nodeDetail.details })).toBeNull();
  });

  it("renders the Info button beside the current breadcrumb item once registered", async () => {
    renderTopbar(<RegisterProbe description="Team reference" />);

    const button = await screen.findByRole("button", { name: messages.nodeDetail.details });
    const currentItem = screen
      .getByTestId("topbar")
      .querySelector("[data-topbar-current-item]") as HTMLElement | null;
    expect(currentItem?.textContent).toBe("Handbook");
    // Against the node's name, not pushed to the far end of the topbar row.
    expect(currentItem?.parentElement?.contains(button)).toBe(true);
  });

  it("shows the node description on hover", async () => {
    renderTopbar(<RegisterProbe description="Team reference" />);

    const button = await screen.findByRole("button", { name: messages.nodeDetail.details });
    fireEvent.focus(button);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toBe("Team reference");
  });

  it("falls back to the generic label instead of an empty tooltip", async () => {
    renderTopbar(<RegisterProbe description="   " />);

    const button = await screen.findByRole("button", { name: messages.nodeDetail.details });
    fireEvent.focus(button);

    // A whitespace-only description must not produce a blank bubble.
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toBe(messages.nodeDetail.details);
  });

  it("opens the node settings dialog on its Info tab when clicked", async () => {
    renderTopbar(<RegisterProbe description="Team reference" />);

    fireEvent.click(await screen.findByRole("button", { name: messages.nodeDetail.details }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(messages.nodeSettings.dialogTitle);
    // Info is the active tab, not General: the rail marks it, and its
    // read-only property list is what is rendered in the pane.
    expect(screen.getByRole("button", { name: messages.nodeSettings.tabInfo }).className).toContain(
      "bg-accent",
    );
    await waitFor(() => {
      expect(screen.getAllByText(messages.common.slug).length).toBeGreaterThan(0);
    });
  });

  it("does not let a disabled instance claim or clear the slot", async () => {
    // The page's own view registers; a side-panel/keep-alive twin stays mounted
    // with `enabled: false` and must not overwrite or clear that registration.
    const view = renderTopbar(
      <>
        <RegisterProbe description="Team reference" />
        <RegisterProbe description="Pinned copy" enabled={false} name="Pinned Handbook" />
      </>,
    );

    await screen.findByRole("button", { name: messages.nodeDetail.details });
    expect(useTopbarNodeInfoStore.getState().info?.description).toBe("Team reference");
    expect(useTopbarNodeInfoStore.getState().info?.nodeName).toBe("Handbook");

    view.unmount();
    expect(useTopbarNodeInfoStore.getState().info).toBeNull();
  });

  it("clears the slot when the registering view unmounts", async () => {
    const view = renderTopbar(<RegisterProbe description="Team reference" />);
    await screen.findByRole("button", { name: messages.nodeDetail.details });

    view.unmount();

    expect(useTopbarNodeInfoStore.getState().info).toBeNull();
  });

  it("sits against the node crumb, not the last one, on a Base view route", async () => {
    // `/base/blog/ready-to-publish` reads Workspace › Posts › Ready to publish.
    // Hanging the Info button off the LAST crumb would put it against the view
    // name while opening the settings of the Base — so it follows `isNode`.
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CoreI18nProvider locale="en">
          <RegisterProbe description="Team reference" name="Posts" />
          <div data-testid="topbar">
            <BusabaseTopbarBreadcrumb
              items={[
                { href: "/home", label: "Workspace" },
                { href: "/base/blog", isNode: true, label: "Posts" },
                { label: "Ready to publish" },
              ]}
            />
          </div>
        </CoreI18nProvider>
      </QueryClientProvider>,
    );

    const button = await screen.findByRole("button", { name: messages.nodeDetail.details });
    const marked = screen
      .getByTestId("topbar")
      .querySelector("[data-topbar-current-item]") as HTMLElement | null;
    // The marker — and the e2e suite's "which node am I on" hook — names the
    // Base, never the view.
    expect(marked?.textContent).toBe("Posts");
    expect(marked?.closest("li")?.contains(button)).toBe(true);
    // And the emphasis goes with it: the view name stays muted path text.
    expect(marked?.className).toContain("font-semibold");
  });

  it("stays hidden while the node route is not active", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CoreI18nProvider locale="en">
          <RegisterProbe description="Team reference" />
          <BusabaseTopbarBreadcrumb items={[{ label: "Handbook" }]} showNodeInfo={false} />
        </CoreI18nProvider>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole("button", { name: messages.nodeDetail.details })).toBeNull();
  });
});
