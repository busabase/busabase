// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { useTopbarNodeInfoStore } from "../store/topbar-node-info-store";
import { TopbarNodeInfoButton } from "./topbar";

vi.mock("./node-settings-dialog", () => ({
  NodeSettingsDialog: ({
    open,
    onOpenChange,
    initialTab,
    initialSiteEnvironment,
    nodeId,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialTab: string;
    initialSiteEnvironment?: boolean;
    nodeId: string;
  }) =>
    open ? (
      <div
        role="dialog"
        aria-label="Node settings"
        data-initial-tab={initialTab}
        data-environment={String(initialSiteEnvironment)}
        data-node={nodeId}
      >
        <button onClick={() => onOpenChange(false)} type="button">
          Close
        </button>
      </div>
    ) : null,
}));

const info = (nodeType: string) => ({
  nodeId: "node-shop",
  nodeName: "Shop",
  nodeType,
  nodeSlug: "shop",
  description: "A website",
  orpc: {} as BusabaseQueryUtils,
});
const mount = (nodeType = "airapp") => {
  window.history.replaceState(
    null,
    "",
    "/dashboard/space/airapp/shop?siteEnvironment=1&keep=present",
  );
  useTopbarNodeInfoStore.getState().setInfo(info(nodeType));
  return render(
    <CoreI18nProvider locale="en">
      <Router>
        <TopbarNodeInfoButton />
      </Router>
    </CoreI18nProvider>,
  );
};
afterEach(() => {
  cleanup();
  useTopbarNodeInfoStore.getState().setInfo(null);
  window.history.replaceState(null, "", "/");
});

describe("Vault Site repair entry", () => {
  it("opens the referenced Site's environment settings once and consumes only its entry parameter", async () => {
    mount();
    const dialog = await screen.findByRole("dialog", { name: "Node settings" });
    expect(dialog.getAttribute("data-node")).toBe("node-shop");
    expect(dialog.getAttribute("data-initial-tab")).toBe("environment");
    expect(dialog.getAttribute("data-environment")).toBe("true");
    expect(new URLSearchParams(window.location.search).has("siteEnvironment")).toBe(false);
    expect(new URLSearchParams(window.location.search).get("keep")).toBe("present");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    useTopbarNodeInfoStore
      .getState()
      .setInfo({ ...info("airapp"), description: "Updated website" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("does not open settings for a non-Site node from the repair parameter", () => {
    mount("doc");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(new URLSearchParams(window.location.search).has("siteEnvironment")).toBe(true);
  });
});
