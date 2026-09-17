// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";

const setLocation = vi.fn();

vi.mock("wouter", () => ({ useLocation: () => ["/", setLocation] }));

const { CreateNodeModal } = await import("./create-node-modal");

afterEach(() => {
  cleanup();
  setLocation.mockClear();
});

/**
 * The Agent tab's wrapper around `AgentPromptsView` must scroll, not clip,
 * once content (the scenario/capability list, or an expanded target picker)
 * outgrows the row `TabsContent` leaves for it on a narrow viewport where
 * `AgentPromptsView` has no `sm:` height cap of its own — see the layout
 * comment in `create-node-modal.tsx`. `orpc={null}` keeps this a pure layout
 * check: no fetch, no Ask Agent action, just the tab shell and
 * `AgentPromptsView`'s built-in defaults.
 */
describe("CreateNodeModal Agent tab overflow", () => {
  it("scrolls the Agent tab body instead of clipping it", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <CoreI18nProvider locale="en">
        <QueryClientProvider client={client}>
          <CreateNodeModal
            apiClient={{} as unknown as BusabaseDashboardApiClient}
            onCreated={() => {}}
            onOpenChange={() => {}}
            open
            orpc={null}
          />
        </QueryClientProvider>
      </CoreI18nProvider>,
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Let an Agent create it" }));

    const panel = screen.getByRole("tabpanel");
    // Scoped to a direct child of the tabpanel, since `AgentPromptsView`'s own
    // preview pane legitimately keeps its own internal `overflow-hidden` for
    // unrelated reasons — same scoping the dialog's equivalent test uses.
    const scrollBody = panel.querySelector(":scope > div.min-h-0");
    expect(scrollBody?.className).toContain("overflow-y-auto");
    expect(scrollBody?.className).not.toContain("overflow-hidden");
  });
});
