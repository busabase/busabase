// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import {
  NodeSettingsAppSignInSlotProvider,
  type RenderNodeSettingsAppSignInPanel,
} from "./node-settings-app-sign-in-slot";
import { NodeSettingsDialog } from "./node-settings-dialog";

const messages = coreMessagesByLocale.en;

const orpc = {
  nodes: {
    get: {
      queryOptions: ({ input }: { input: { nodeId: string } }) => ({
        queryKey: ["nodes", "get", input.nodeId],
        // Never resolves: the tab rail is what is under test, not the detail.
        queryFn: () => new Promise(() => undefined),
      }),
    },
  },
} as unknown as BusabaseQueryUtils;

function renderDialog({
  nodeType,
  slot,
  onOpenChange = () => undefined,
}: {
  nodeType: string;
  slot: RenderNodeSettingsAppSignInPanel | null;
  onOpenChange?: (open: boolean) => void;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale="en">
        <Router>
          <NodeSettingsAppSignInSlotProvider value={slot}>
            <NodeSettingsDialog
              // No permissions slot is mounted, so this tab's pane is empty —
              // the tab rail is what is under test, not the other panes.
              initialTab="permissions"
              nodeId="nod_shop"
              nodeName="Corner Shop"
              nodeType={nodeType}
              onOpenChange={onOpenChange}
              open
              orpc={orpc}
            />
          </NodeSettingsAppSignInSlotProvider>
        </Router>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("node settings → User sign-in slot", () => {
  it("adds the tab for an AirApp when the host injects a panel, and renders it", () => {
    const onOpenChange = vi.fn();
    const slot = vi.fn<RenderNodeSettingsAppSignInPanel>(({ nodeId, nodeName, closeDialog }) => (
      <button onClick={closeDialog} type="button">
        panel for {nodeId} / {nodeName}
      </button>
    ));
    renderDialog({ nodeType: "airapp", slot, onOpenChange });

    fireEvent.click(screen.getByRole("button", { name: messages.nodeSettings.tabUserSignIn }));
    const panel = screen.getByRole("button", { name: "panel for nod_shop / Corner Shop" });
    fireEvent.click(panel);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("has no such tab for a node that is not an AirApp", () => {
    const slot = vi.fn<RenderNodeSettingsAppSignInPanel>(() => <p>panel</p>);
    renderDialog({ nodeType: "base", slot });
    expect(screen.queryByRole("button", { name: messages.nodeSettings.tabUserSignIn })).toBeNull();
    expect(slot).not.toHaveBeenCalled();
  });

  it("has no such tab in a host without app users (the open-source build)", () => {
    renderDialog({ nodeType: "airapp", slot: null });
    expect(screen.getByRole("button", { name: messages.nodeSettings.tabInfo })).toBeTruthy();
    expect(screen.queryByRole("button", { name: messages.nodeSettings.tabUserSignIn })).toBeNull();
  });
});
