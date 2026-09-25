// @vitest-environment jsdom

/**
 * Which node types the Share dialog offers "share to web" for.
 *
 * Nothing rendered this dialog under test before, which is how a whole half of
 * it stayed invisible for AirApp: the switch is gated on
 * `publicAccessOf(nodeType) !== "no"`, and AirApp's registry entry said `"no"`
 * for three weeks after the runtime it was waiting for shipped (#6648). The
 * server-side gate (`resolvePublicTargetNode`) reads the same flag, so the user
 * saw no Share-to-web switch AND a link would have 404'd anyway — two symptoms,
 * one value. `packages/busabase-contract/src/domains/registry.test.ts` pins the
 * value; this pins the thing the user actually sees, so the two cannot drift
 * apart again.
 *
 * The fake `orpc` answers every query with a fixture (or `null`) and every
 * mutation with `{}`: the dialog's own copy and gating are under test, not the
 * network.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { listNodeTypes, publicAccessOf } from "busabase-contract/domains";
import { afterEach, describe, expect, it } from "vitest";
import { NodeShareDialog } from "./node-share-button";

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
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const FIXTURES: Record<string, unknown> = {
  "nodes.share.get": { scope: "none", capability: "read", hasPassword: false, expiresAt: null },
  "embedLinks.list": [],
};

/** A `BusabaseQueryUtils` stand-in: any `a.b.c.queryOptions()` resolves to a fixture. */
const fakeOrpc = (): BusabaseQueryUtils => {
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key: string) => {
        if (key === "queryOptions") {
          return (options?: { input?: unknown }) => ({
            queryKey: [...path, options?.input ?? null],
            queryFn: async () => FIXTURES[path.join(".")] ?? null,
          });
        }
        if (key === "mutationOptions") return () => ({ mutationFn: async () => ({}) });
        return node([...path, key]);
      },
    });
  return node([]) as BusabaseQueryUtils;
};

const renderDialog = (nodeType: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <NodeShareDialog
        nodeId="nod_1"
        nodeName="Thing"
        nodeSlug="thing"
        nodeType={nodeType}
        onOpenChange={() => {}}
        open
        orpc={fakeOrpc()}
        spaceId="org_1"
      />
    </QueryClientProvider>,
  );

const shareToWebSwitch = () => document.getElementById("node-share-public");

/** Wait until the dialog has rendered SOMETHING for this type, so "absent" means absent, not "not yet". */
const settled = async () => {
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
};

afterEach(cleanup);

describe("NodeShareDialog: share-to-web availability follows the registry", () => {
  it("offers share-to-web for an AirApp, with the copy that says it RUNS the app", async () => {
    renderDialog("airapp");

    await waitFor(() => expect(shareToWebSwitch()).not.toBeNull());
    // An AirApp is a program: the hint must say the visitor's browser runs it,
    // not the generic "anyone with the link can open this".
    expect(screen.getByText(/run/i, { selector: "span.text-xs" })).toBeTruthy();
  });

  it.each(["drive", "skill"])(
    "does not offer share-to-web for %s (declared publicAccess: no)",
    async (type) => {
      renderDialog(type);

      await settled();
      expect(publicAccessOf(type)).toBe("no");
      expect(shareToWebSwitch()).toBeNull();
    },
  );

  it("agrees with publicAccessOf for every built-in node type", async () => {
    // Data-driven so a newly added type cannot ship with the switch and the
    // resolver disagreeing. Types that share to web must show the switch; types
    // that cannot must not.
    for (const { type } of listNodeTypes()) {
      const { unmount } = renderDialog(type);
      const offered = publicAccessOf(type) !== "no";

      if (offered) {
        await waitFor(() => expect(shareToWebSwitch(), type).not.toBeNull());
      } else {
        // may render only the embed half, or nothing at all — either way, no switch.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(shareToWebSwitch(), type).toBeNull();
      }
      unmount();
      cleanup();
    }
  });
});
