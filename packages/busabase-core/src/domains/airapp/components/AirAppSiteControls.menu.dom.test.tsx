// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AirAppSiteActionVO,
  AirAppSiteStateVO,
} from "busabase-contract/domains/airapp/contract";
import { Button } from "kui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "kui/dropdown-menu";
import { afterEach, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { AirAppSiteGoLive } from "./AirAppSiteControls";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
});

it("finishes a side-panel publication and updates cached release state after its menu has closed", async () => {
  let state: AirAppSiteStateVO = {
    engine: "available",
    publication: "not-live",
    isPublic: false,
    address: "https://app.sites.test",
    previewUrl: "/api/airapp-preview/app/",
    previewVersion: "v1",
    currentVersion: "v1",
    liveVersion: null,
    previewStale: false,
    previewDeployedAt: null,
    liveDeployedAt: null,
    blockers: [],
  };
  const read = vi.fn(async () => state);
  let complete!: (result: AirAppSiteActionVO) => void;
  const publish = vi.fn(
    () =>
      new Promise<AirAppSiteActionVO>((resolve) => {
        complete = resolve;
      }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  client.setQueryData(["site-releases", "app"], { versions: [] });
  const orpc = {
    airapps: {
      siteState: { queryOptions: () => ({ queryKey: ["site", "app"], queryFn: read }) },
      siteDomains: {
        queryOptions: () => ({
          queryKey: ["domains", "app"],
          queryFn: async () => ({ bindings: [] }),
        }),
      },
      siteReleases: { queryOptions: () => ({ queryKey: ["site-releases", "app"] }) },
      siteGoLive: { call: publish },
    },
  } as unknown as BusabaseQueryUtils;
  render(
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={client}>
        <AirAppSiteGoLive
          filesRevision="v1"
          nodeId="app"
          orpc={orpc}
          runStatus="ready"
          renderMenuAction={(action) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>More</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>{action}</DropdownMenuContent>
            </DropdownMenu>
          )}
        />
      </QueryClientProvider>
    </CoreI18nProvider>,
  );
  await waitFor(() => expect(read).toHaveBeenCalled());
  fireEvent.pointerDown(screen.getByRole("button", { name: "More" }), {
    button: 0,
    ctrlKey: false,
  });
  const action = await screen.findByRole("menuitem", { name: "Publish Site" });
  fireEvent.click(action);
  await waitFor(() => expect(publish).toHaveBeenCalledExactlyOnceWith({ nodeId: "app" }));
  expect(screen.queryByRole("menu")).toBeNull();
  state = { ...state, publication: "live", liveVersion: "v1", isPublic: true };
  complete({ outcome: "ok", state });
  await waitFor(() =>
    expect(client.getQueryState(["site-releases", "app"])?.isInvalidated).toBe(true),
  );
  expect(client.getQueryData<AirAppSiteStateVO>(["site", "app"])?.liveVersion).toBe("v1");
  fireEvent.pointerDown(screen.getByRole("button", { name: "More" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(await screen.findByRole("menuitem", { name: "Publish update" })).toBeTruthy();
  expect(
    screen.getByRole("menuitem", { name: "Publish update" }).getAttribute("data-disabled"),
  ).not.toBeNull();
});

it("rechecks saved source edits while the runner is idle without fetching domain management", async () => {
  let state: AirAppSiteStateVO = {
    engine: "available",
    publication: "live",
    isPublic: true,
    address: "https://app.sites.test",
    previewUrl: "/api/airapp-preview/app/",
    previewShareUrl: null,
    previewVersion: "v1",
    currentVersion: "v1",
    liveVersion: "v1",
    previewStale: false,
    previewDeployedAt: null,
    liveDeployedAt: null,
    blockers: [],
  };
  const read = vi.fn(async () => state);
  const readDomains = vi.fn(async () => ({ bindings: [] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const orpc = {
    airapps: {
      siteState: { queryOptions: () => ({ queryKey: ["site", "app"], queryFn: read }) },
      siteDomains: {
        queryOptions: () => ({ queryKey: ["domains", "app"], queryFn: readDomains }),
      },
      siteGoLive: { call: vi.fn() },
    },
  } as unknown as BusabaseQueryUtils;
  const surface = (revision: string) => (
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={client}>
        <AirAppSiteGoLive
          filesRevision={revision}
          nodeId="app"
          orpc={orpc}
          runStatus="idle"
          renderMenuAction={(_action, current) => <p>{current?.publication ?? "loading"}</p>}
        />
      </QueryClientProvider>
    </CoreI18nProvider>
  );
  const view = render(surface("source-v1"));
  await screen.findByText("live");
  const readsBeforeEdit = read.mock.calls.length;
  state = { ...state, currentVersion: "v2", publication: "live-with-changes", previewStale: true };
  view.rerender(surface("source-v2"));
  await screen.findByText("live-with-changes");
  expect(read.mock.calls.length).toBe(readsBeforeEdit + 1);
  expect(readDomains).not.toHaveBeenCalled();
});
