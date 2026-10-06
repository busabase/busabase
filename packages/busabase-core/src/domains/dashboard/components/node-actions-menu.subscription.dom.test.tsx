// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeSubscriptionVO } from "busabase-contract/contract/node-subscription-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast }));
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("./embed-link-section", () => ({ useCanManageEmbedLinks: () => false }));
vi.mock("./file-tree-browser", () => ({ NodeDeleteDialog: () => null }));
vi.mock("./node-settings-dialog", () => ({ NodeSettingsDialog: () => null }));
vi.mock("./node-share-button", () => ({ NodeShareDialog: () => null }));
vi.mock("./split-submit-button", () => ({ useWorkspacePermissionLevel: () => "write" }));

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.scrollIntoView ??= () => undefined;

const { NodeActionsMenu } = await import("./node-actions-menu");

const stubOrpc = (initial: NodeSubscriptionVO, onSet: (input: unknown) => NodeSubscriptionVO) => {
  let current = initial;
  const get = vi.fn(async () => current);
  const set = vi.fn(async (input: unknown) => {
    current = onSet(input);
    return current;
  });
  const orpc = {
    nodes: {
      subscription: {
        get: {
          queryOptions: ({ input }: { input: { nodeId: string } }) => ({
            queryKey: ["nodes", "subscription", input.nodeId],
            queryFn: get,
          }),
        },
        set: { mutationOptions: () => ({ mutationFn: set }) },
      },
    },
  } as unknown as BusabaseQueryUtils;
  return { orpc, get, set };
};

const renderMenu = (orpc: BusabaseQueryUtils) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={client}>
        <NodeActionsMenu
          nodeId="nod_doc"
          nodeName="Q4 plan"
          nodeSlug="q4-plan"
          nodeType="doc"
          orpc={orpc}
        />
      </QueryClientProvider>
    </CoreI18nProvider>,
  );
};

const openMenu = () =>
  fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });

describe("NodeActionsMenu — subscription item", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not fetch the subscription until the menu opens", async () => {
    const { orpc, get } = stubOrpc(
      { nodeId: "nod_doc", state: "none", source: null, via: null },
      (input) => input as NodeSubscriptionVO,
    );
    renderMenu(orpc);
    expect(get).not.toHaveBeenCalled();
    openMenu();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  });

  it("offers Subscribe with 'Not subscribed', and subscribes on click", async () => {
    const { orpc, set } = stubOrpc(
      { nodeId: "nod_doc", state: "none", source: null, via: null },
      () => ({ nodeId: "nod_doc", state: "subscribed", source: "manual", via: null }),
    );
    renderMenu(orpc);
    openMenu();
    const item = await screen.findByRole("menuitem", { name: /Subscribe\s*Not subscribed/ });
    await waitFor(() => expect(item.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(item);
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set.mock.calls[0]?.[0]).toEqual({ nodeId: "nod_doc", subscribed: true });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Subscribed — you'll be notified about changes to Q4 plan.",
      ),
    );
  });

  it("names the folder an inherited subscription comes from, and unsubscribing mutes this node", async () => {
    const { orpc, set } = stubOrpc(
      {
        nodeId: "nod_doc",
        state: "inherited",
        source: "manual",
        via: { id: "nod_folder", name: "Projects", type: "folder", slug: "projects" },
      },
      () => ({ nodeId: "nod_doc", state: "muted", source: "manual", via: null }),
    );
    renderMenu(orpc);
    openMenu();
    const item = await screen.findByRole("menuitem", {
      name: /Unsubscribe\s*Subscribed via Projects/,
    });
    await waitFor(() => expect(item.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(item);
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set.mock.calls[0]?.[0]).toEqual({ nodeId: "nod_doc", subscribed: false });

    // Reopen: the cache now holds the muted state the server returned.
    openMenu();
    expect(
      await screen.findByRole("menuitem", { name: /Subscribe\s*Not subscribed/ }),
    ).not.toBeNull();
  });

  it("shows a direct subscription as 'Subscribed' and reports a failed update", async () => {
    const { orpc } = stubOrpc(
      { nodeId: "nod_doc", state: "subscribed", source: "auto", via: null },
      () => {
        throw new Error("boom");
      },
    );
    renderMenu(orpc);
    openMenu();
    const item = await screen.findByRole("menuitem", { name: /Unsubscribe\s*Subscribed$/ });
    await waitFor(() => expect(item.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(item);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't update your subscription."),
    );
  });
});
