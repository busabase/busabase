// @vitest-environment jsdom

/**
 * Who is offered the sidebar row's "•••" → Share entry.
 *
 * The shell is the chrome AROUND `BusabaseDashboard`, so it used to sit outside
 * the `SubmitPermissionProvider` the dashboard mounts over its own children:
 * every permission read in the sidebar — and in the dialogs the sidebar opens —
 * answered from the context DEFAULT (`"manage"`) no matter who was looking. On
 * Busabase Cloud that handed a viewer a Share entry on an AirApp, whose ONLY
 * half is the embed one (`publicAccess: "no"`, embeddable), and whose three
 * `embedLinks.*` procedures are all `workspace("manage")` — so the dialog opened
 * onto a header and a Close button, after a refused round trip.
 *
 * What is pinned here is that affordance against the host-resolved level, on
 * both sides: absent at `read`/`write`, present at `manage`. Both the public
 * share procedures and embed-link procedures require manage, so a Doc is not
 * an exception merely because its node type supports an anonymous page.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeVO } from "busabase-contract/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { BusabaseDashboardShell } from "./dashboard-shell";

/**
 * jsdom ships neither `ResizeObserver` (the sidebar measures itself), nor
 * `matchMedia` (kui's mobile breakpoint hook), nor the Pointer Capture API
 * (Radix menus call it while opening). All three are browser plumbing this test
 * has no opinion about.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof globalThis.matchMedia;
// jsdom has no `CSS` object either; NavMain uses `CSS.escape` to look up the
// active row by URL. The ids here need no escaping.
globalThis.CSS ??= { escape: (value: string) => value } as unknown as typeof globalThis.CSS;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
document.elementFromPoint ??= () => null;

const useStaticSearch = () => "";

/** A minimal `NodeVO` — only the fields the sidebar row builder reads. */
const nodeVO = (
  overrides: Partial<NodeVO> & Pick<NodeVO, "id" | "slug" | "name" | "type">,
): NodeVO => ({
  baseId: null,
  children: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  description: "",
  explicitVisibility: null,
  icon: null,
  metadata: {},
  parentId: null,
  position: 0,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

/**
 * The three endpoints the shell itself touches when a host wires `orpc` — none
 * of which this test has an opinion about. `orpc` still has to be present: the
 * Share action is wired only for a host that supplied a client.
 */
const stubOrpc = () =>
  ({
    nodes: {
      ancestors: {
        queryOptions: () => ({
          queryKey: ["nodes", "ancestors"],
          queryFn: async () => ({ ancestorIds: [] }),
        }),
      },
      listFavorites: {
        queryOptions: () => ({
          queryKey: ["nodes", "listFavorites"],
          queryFn: async () => [],
        }),
      },
      toggleFavorite: { mutationOptions: () => ({ mutationFn: async () => ({ ok: true }) }) },
    },
  }) as unknown as BusabaseQueryUtils;

const AIRAPP = nodeVO({
  id: "nd_airapp",
  name: "Kelly CRM",
  slug: "kelly-crm",
  type: "airapp",
});
const DOC = nodeVO({ id: "nd_doc", name: "Handbook", slug: "handbook", type: "doc" });

function renderShell(submitPermissionLevel?: ApiKeyPermissionLevel, location = "/") {
  const useLocation = (): [string, (path: string) => void] => [location, () => undefined];
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Router hook={useLocation} searchHook={useStaticSearch}>
        <BusabaseDashboardShell
          activeChangeRequestCount={0}
          chrome={{
            hideUserMenu: true,
            onSignOut: () => undefined,
            user: { avatar: "", email: "tester@example.com", name: "Tester" },
          }}
          locale="en"
          nodes={[AIRAPP, DOC]}
          onCreateClick={() => undefined}
          onSearchClick={() => undefined}
          orpc={stubOrpc()}
          submitPermissionLevel={submitPermissionLevel}
        >
          <span />
        </BusabaseDashboardShell>
      </Router>
    </QueryClientProvider>,
  );
}

/** Open a sidebar row's "•••" menu and list the entries it offers. */
async function openRowMenu(nodeName: string): Promise<string[]> {
  const row = screen.getByText(nodeName).closest("li") ?? screen.getByText(nodeName).parentElement;
  if (!row) throw new Error(`no sidebar row for ${nodeName}`);
  const trigger = within(row as HTMLElement).getByTitle("More");
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  const menu = await waitFor(() => {
    const found = document.querySelector('[role="menu"]');
    if (!found) throw new Error("menu did not open");
    return found as HTMLElement;
  });
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent?.trim() ?? "");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BusabaseDashboardShell sidebar Share action", () => {
  it.each(["read", "write"] as const)(
    "does not offer Share on an embed-only node at %s",
    async (level) => {
      renderShell(level);
      expect(await openRowMenu("Kelly CRM")).not.toContain("Share");
    },
  );

  it("offers Share on an embed-only node at manage", async () => {
    renderShell("manage");
    expect(await openRowMenu("Kelly CRM")).toContain("Share");
  });

  it.each(["read", "write"] as const)(
    "does not offer Share on a share-to-web node at %s",
    async (level) => {
      renderShell(level);
      expect(await openRowMenu("Handbook")).not.toContain("Share");
    },
  );

  it("offers Share on a share-to-web node at manage", async () => {
    renderShell("manage");
    expect(await openRowMenu("Handbook")).toContain("Share");
  });

  it("defaults to manage for a host that states no level (open-source install)", async () => {
    renderShell();
    expect(await openRowMenu("Kelly CRM")).toContain("Share");
  });
});

describe("BusabaseDashboardShell embed-link audit navigation", () => {
  it.each(["read", "write"] as const)(
    "does not surface the contextual audit row at %s",
    (level) => {
      renderShell(level, "/embed-links");
      expect(screen.queryByRole("link", { name: "Embed links" })).toBeNull();
    },
  );

  it("surfaces the contextual audit row at manage", () => {
    renderShell("manage", "/embed-links");
    expect(screen.getByRole("link", { name: "Embed links" })).toBeTruthy();
  });
});
