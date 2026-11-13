// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { createKnownNodeCache } from "../helpers/known-node-cache";
import { SearchDialog } from "./search-dialog";
import { type SearchSpacesSlot, SearchSpacesSlotProvider } from "./search-spaces-slot";

afterEach(cleanup);

/** Every request stays pending: the Spaces section must not wait on the server. */
const inert = (key: string) => ({
  queryOptions: (opts?: { input?: unknown }) => ({
    queryKey: [key, opts?.input],
    queryFn: () => new Promise(() => undefined),
  }),
});
const orpc = {
  search: inert("search"),
  searchMetrics: {
    report: { mutationOptions: () => ({ mutationFn: async () => ({ accepted: true }) }) },
  },
  nodes: { list: inert("nodes.list"), searchByName: inert("nodes.searchByName") },
} as unknown as BusabaseQueryUtils;

const renderDialog = ({
  slot,
  onClose = () => undefined,
  onSelect,
}: {
  slot?: SearchSpacesSlot;
  onClose?: () => void;
  onSelect?: () => void;
}) => {
  const dialog = (
    <SearchDialog
      nodeCache={createKnownNodeCache(`test:spaces:${Math.random()}`)}
      onClose={onClose}
      onSelect={onSelect}
      open
      orpc={orpc}
    />
  );
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Router hook={() => ["/home", () => undefined]} searchHook={() => ""}>
        <CoreI18nProvider locale="en">
          {slot ? (
            <SearchSpacesSlotProvider value={slot}>{dialog}</SearchSpacesSlotProvider>
          ) : (
            dialog
          )}
        </CoreI18nProvider>
      </Router>
    </QueryClientProvider>,
  );
};

const type = (container: HTMLElement, value: string) => {
  const input = container.querySelector("input");
  if (!input) throw new Error("search input not rendered");
  fireEvent.change(input, { target: { value } });
  return input;
};

const slotWith = (onSwitch: (spaceId: string) => void): SearchSpacesSlot => ({
  activeSpaceId: "s1",
  onSwitch,
  spaces: [
    { id: "s1", name: "Acme Demo", subtitle: "Owner · PRO" },
    { id: "s2", name: "Qiming Demo", subtitle: "Member · PRO" },
    { id: "s3", name: "Personal", subtitle: "Owner · FREE" },
  ],
});

describe("SearchDialog spaces", () => {
  it("lists other spaces a query names and switches to the one picked", () => {
    const onSwitch = vi.fn();
    const onClose = vi.fn();
    const { container } = renderDialog({ slot: slotWith(onSwitch), onClose });

    type(container, "demo");

    const row = screen.getByRole("option", { name: /Qiming Demo/ });
    expect(row.textContent).toContain("Switch to this space");
    expect(row.textContent).toContain("Member · PRO");
    // The active space is where the search runs, never a switch target.
    expect(screen.queryByRole("option", { name: /Acme Demo/ })).toBeNull();

    fireEvent.click(row);
    expect(onSwitch).toHaveBeenCalledWith("s2");
    expect(onClose).toHaveBeenCalled();
  });

  it("switches with the keyboard too, since Enter and click share one path", () => {
    const onSwitch = vi.fn();
    const { container } = renderDialog({ slot: slotWith(onSwitch) });

    const input = type(container, "qiming");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSwitch).toHaveBeenCalledWith("s2");
  });

  it("shows no spaces without a host, with an empty query, or while pinning", () => {
    const onSwitch = vi.fn();

    const bare = renderDialog({});
    type(bare.container, "demo");
    expect(screen.queryByText("Switch to this space")).toBeNull();
    bare.unmount();

    const empty = renderDialog({ slot: slotWith(onSwitch) });
    type(empty.container, "");
    expect(screen.queryByText("Switch to this space")).toBeNull();
    empty.unmount();

    const pinning = renderDialog({ slot: slotWith(onSwitch), onSelect: () => undefined });
    type(pinning.container, "demo");
    expect(screen.queryByText("Switch to this space")).toBeNull();
  });

  it("draws a logo only from an image address and falls back to the first letter", () => {
    const { container } = renderDialog({
      slot: {
        activeSpaceId: "s0",
        onSwitch: () => undefined,
        spaces: [
          { id: "s1", name: "Box Named", logo: "Box" },
          { id: "s2", name: "Bright Uploaded", logo: "https://cdn.example/logo.png" },
        ],
      },
    });

    type(container, "b");

    const named = screen.getByRole("option", { name: /Box Named/ });
    expect(named.querySelector("img")).toBeNull();
    expect(named.textContent?.startsWith("B")).toBe(true);
    expect(screen.getByRole("option", { name: /Bright Uploaded/ }).querySelector("img")?.src).toBe(
      "https://cdn.example/logo.png",
    );
  });
});
