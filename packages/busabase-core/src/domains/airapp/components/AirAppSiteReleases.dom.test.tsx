// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AirAppSiteReleasesVO,
  AirAppSiteStateVO,
} from "busabase-contract/domains/airapp/contract";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { SidePanel } from "../../dashboard/components/side-panel";
import { createKnownNodeCache } from "../../dashboard/helpers/known-node-cache";
import { registerSidePanelTab, type SidePanelTabProps } from "../../dashboard/side-panel-registry";
import {
  DEFAULT_SIDE_PANEL_WIDTH,
  useSidePanelStore,
} from "../../dashboard/store/side-panel-store";
import {
  AIRAPP_SITE_RELEASES_TAB_TYPE,
  airAppSiteReleasesTabId,
} from "../utils/site-release-panel";
import { AirAppSiteReleases, AirAppSiteReleasesPanel } from "./AirAppSiteReleases";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,cXI=") },
}));
// Domain/public controls have dedicated DOM coverage; exercise the release workflow here.
vi.mock("./AirAppSiteControls", () => ({
  AirAppSiteSettings: () => <p>Existing address and domain settings</p>,
}));
vi.mock("../../dashboard/components/side-panel-add-tab", () => ({ SidePanelAddTab: () => null }));
vi.mock("../../dashboard/components/side-panel-empty-state", () => ({
  SidePanelEmptyState: () => <p>Panel launcher</p>,
  SidePanelAgentPicker: () => null,
}));

function RetainedTabProbe({ payload }: SidePanelTabProps) {
  const { label } = payload as { label: string };
  const [draft, setDraft] = useState("");
  return (
    <input aria-label={label} onChange={(event) => setDraft(event.target.value)} value={draft} />
  );
}

const initialSite = (): AirAppSiteStateVO => ({
  engine: "available",
  address: "https://shop.sites.test",
  publication: "live-with-changes",
  isPublic: true,
  previewUrl: "/api/airapp-preview/node/",
  previewVersion: "draft",
  liveVersion: "second",
  currentVersion: "draft",
  previewStale: false,
  previewDeployedAt: null,
  liveDeployedAt: null,
  blockers: [],
});
const initialReleases = (): AirAppSiteReleasesVO => ({
  available: true,
  status: "idle",
  lastError: null,
  versions: [
    {
      version: "second",
      releaseNumber: 2,
      createdAt: "2026-11-11T08:00:00.000Z",
      createdBy: "author",
      isCurrent: true,
      canRollback: false,
    },
    {
      version: "first",
      releaseNumber: 1,
      createdAt: "2026-11-10T08:00:00.000Z",
      createdBy: "author",
      isCurrent: false,
      canRollback: true,
    },
  ],
  history: [
    {
      id: "published-second",
      kind: "publish",
      version: "second",
      releaseNumber: 2,
      createdAt: "2026-11-11T08:00:00.000Z",
      createdBy: "author",
    },
  ],
});

const clients: QueryClient[] = [];
const renderReleases = ({
  site = initialSite(),
  releases = initialReleases(),
}: {
  site?: AirAppSiteStateVO;
  releases?: AirAppSiteReleasesVO;
} = {}) => {
  let currentSite = site;
  let currentReleases = releases;
  const readSite = vi.fn(async () => currentSite);
  const read = vi.fn(async () => currentReleases);
  const rollback = vi.fn(async ({ version }: { version: string }) => {
    currentSite = { ...currentSite, liveVersion: version };
    currentReleases = {
      ...currentReleases,
      versions: currentReleases.versions.map((release) => ({
        ...release,
        isCurrent: release.version === version,
        canRollback: release.version !== version,
      })),
    };
    return { outcome: "ok", state: currentSite };
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(queryClient);
  const orpc = {
    airapps: {
      siteState: {
        queryOptions: () => ({ queryKey: ["site", "node"], queryFn: readSite }),
      },
      siteReleases: { queryOptions: () => ({ queryKey: ["releases", "node"], queryFn: read }) },
      siteRollback: { call: rollback },
    },
  } as unknown as BusabaseQueryUtils;
  const tree = (scopeKey = "space-a:user-a", api = orpc) => (
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={queryClient}>
        <AirAppSiteReleases nodeId="node" nodeName="Shop" orpc={api} />
        <SidePanel
          currentNode={null}
          nodeCache={createKnownNodeCache(scopeKey)}
          onNavigate={vi.fn()}
          onOpenSearch={vi.fn()}
          orpc={api}
          scopeKey={scopeKey}
        />
      </QueryClientProvider>
    </CoreI18nProvider>
  );
  const view = render(tree());
  return {
    read,
    readSite,
    rollback,
    queryClient,
    setReleases: (next: AirAppSiteReleasesVO) => {
      currentReleases = next;
    },
    rerenderScope: (scopeKey: string, api = orpc) => view.rerender(tree(scopeKey, api)),
  };
};
const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Release management" }));
  await screen.findByText("Keep the current version and up to 5 historical versions.");
};

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  useSidePanelStore.setState({
    scopeKey: null,
    isOpen: false,
    layout: "split",
    width: DEFAULT_SIDE_PANEL_WIDTH,
    activeTabId: null,
    tabs: [],
  });
  registerSidePanelTab(AIRAPP_SITE_RELEASES_TAB_TYPE, AirAppSiteReleasesPanel);
  registerSidePanelTab("agent-chat", RetainedTabProbe);
  registerSidePanelTab("airapp-preview", RetainedTabProbe);
  registerSidePanelTab("record-probe", RetainedTabProbe);
});

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Site release management", () => {
  it("opens one distinct tab without replacing Agent, record or preview content", async () => {
    renderReleases();
    const tabs = [
      {
        id: "agent-research",
        type: "agent-chat",
        title: "Research",
        payload: { label: "Agent draft", agentSlug: "research" },
      },
      { id: "record-1", type: "record-probe", title: "Record", payload: { label: "Record draft" } },
      {
        id: "airapp-node",
        type: "airapp-preview",
        title: "Shop preview",
        payload: { label: "Preview state" },
      },
    ];
    for (const tab of tabs) {
      act(() => useSidePanelStore.getState().openTab(tab));
      fireEvent.change(screen.getByRole("textbox", { name: tab.payload.label }), {
        target: { value: `${tab.title} retained` },
      });
    }
    await open();
    await open();
    expect(useSidePanelStore.getState().tabs.map((tab) => tab.id)).toEqual([
      ...tabs.map((tab) => tab.id),
      airAppSiteReleasesTabId("node"),
    ]);
    expect(useSidePanelStore.getState().tabs.at(-1)?.payload).toEqual({
      nodeId: "node",
      nodeName: "Shop",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Maximize side panel" })).toBeTruthy();
    expect(document.querySelector("[data-airapp-release-panel]")).toBeTruthy();
    for (const tab of tabs) {
      fireEvent.click(screen.getByRole("tab", { name: tab.title }));
      expect(screen.getByRole("textbox", { name: tab.payload.label })).toHaveProperty(
        "value",
        `${tab.title} retained`,
      );
    }
    const saved = JSON.parse(localStorage.getItem("busabase-side-panel-prefs") ?? "{}");
    expect(saved.state.tabs).toEqual([expect.objectContaining({ type: "agent-chat" })]);
    expect(JSON.stringify(saved)).not.toContain("airapp-site-releases");
  });

  it("retains content on collapse, refreshes on activation and explicit opening, and rejects stale recovery", async () => {
    const { read, setReleases } = renderReleases();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Roll back to v1" }));
    const panel = document.querySelector("[data-airapp-release-panel]");
    act(() => useSidePanelStore.getState().setOpen(false));
    expect(document.querySelector("[data-airapp-release-panel]")).toBe(panel);
    let resolve!: (next: AirAppSiteReleasesVO) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    act(() => useSidePanelStore.getState().setOpen(true));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirm rollback" })).toHaveProperty(
        "disabled",
        true,
      ),
    );
    const fresh = {
      ...initialReleases(),
      versions: initialReleases().versions.map((version) => ({ ...version, canRollback: false })),
    };
    setReleases(fresh);
    await act(async () => resolve(fresh));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Confirm rollback" })).toBeNull(),
    );
    const before = read.mock.calls.length;
    await open();
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
  });

  it("pauses deployment polling while inactive or collapsed and refreshes when selected again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { read } = renderReleases({ releases: { ...initialReleases(), status: "deploying" } });
    await open();
    const started = read.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(read.mock.calls.length).toBeGreaterThan(started);
    act(() =>
      useSidePanelStore.getState().openTab({
        id: "agent-research",
        type: "agent-chat",
        title: "Research",
        payload: { label: "Agent draft", agentSlug: "research" },
      }),
    );
    const inactive = read.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_100);
    });
    expect(read).toHaveBeenCalledTimes(inactive);
    act(() => useSidePanelStore.getState().setActiveTab(airAppSiteReleasesTabId("node")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(read.mock.calls.length).toBeGreaterThan(inactive);
    act(() => useSidePanelStore.getState().setOpen(false));
    const collapsed = read.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_100);
    });
    expect(read).toHaveBeenCalledTimes(collapsed);
  });

  it.each(["space-b:user-a", "space-a:user-b"])(
    "retires release content before changing API ownership to %s",
    async (scope) => {
      const { read, rerenderScope } = renderReleases();
      await open();
      const before = read.mock.calls.length;
      rerenderScope(scope, {} as BusabaseQueryUtils);
      expect(useSidePanelStore.getState().tabs).toEqual([]);
      expect(document.querySelector("[data-airapp-release-panel]")).toBeNull();
      expect(read).toHaveBeenCalledTimes(before);
    },
  );

  it("loads only on opening and requires a focused confirmation before rolling back", async () => {
    const { read, rollback } = renderReleases();
    expect(read).not.toHaveBeenCalled();
    await open();
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText("Existing address and domain settings")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Roll back to v1" }));
    const confirmation = screen.getByRole("group", { name: "Roll back to v1?" });
    expect(document.activeElement).toBe(confirmation);
    expect(rollback).not.toHaveBeenCalled();
    expect(within(confirmation).getByText(/draft, preview and workspace data stay/)).toBeTruthy();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Confirm rollback" }));
    await waitFor(() =>
      expect(rollback).toHaveBeenCalledExactlyOnceWith({ nodeId: "node", version: "first" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Roll back to v1?" })).toBeNull(),
    );
    expect(
      within(
        document.querySelector('[data-airapp-release-version="first"]') as HTMLElement,
      ).getByText("Current"),
    ).toBeTruthy();
    expect(
      document
        .querySelector("[data-airapp-release-version]")
        ?.getAttribute("data-airapp-release-version"),
    ).toBe("first");
  });

  it("cancels recovery without changing the live version", async () => {
    const { rollback } = renderReleases();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Roll back to v1" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Confirm rollback" })).toBeNull();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("keeps failed rollback recoverable without claiming success", async () => {
    const { rollback } = renderReleases();
    rollback.mockRejectedValueOnce(new Error("Provider unavailable; previous version preserved."));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Roll back to v1" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm rollback" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("previous version preserved"),
    );
    expect(screen.getByRole("button", { name: "Confirm rollback" })).toBeTruthy();
    expect(
      within(
        document.querySelector('[data-airapp-release-version="second"]') as HTMLElement,
      ).getByText("Current"),
    ).toBeTruthy();
  });

  it("disables rollback when entitlement is locked and keeps history readable", async () => {
    renderReleases({ site: { ...initialSite(), engine: "locked" } });
    await open();
    expect(screen.getByRole("button", { name: "Roll back to v1" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("heading", { name: "Release history" })).toBeTruthy();
  });

  it("retries a history read failure without showing cached releases as current", async () => {
    const { read } = renderReleases();
    read.mockRejectedValueOnce(new Error("Temporary read error"));
    fireEvent.click(screen.getByRole("button", { name: "Release management" }));
    await screen.findByText("Could not load releases. Try again.");
    expect(screen.queryByRole("button", { name: "Roll back to v1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "Roll back to v1" });
  });

  it("generates the public QR for the production URL and preserves pruned version labels in history", async () => {
    const releases = initialReleases();
    releases.history.push({
      id: "old-release",
      kind: "publish",
      version: "pruned-hash",
      releaseNumber: 12,
      createdAt: "2026-11-09T08:00:00.000Z",
      createdBy: null,
    });
    renderReleases({ releases });
    await open();
    expect(screen.getByText("v12")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: coreMessagesByLocale.en.share.qrCode }));
    await screen.findByAltText(coreMessagesByLocale.en.share.qrAlt);
    const { default: QRCode } = await import("qrcode");
    expect(QRCode.toDataURL).toHaveBeenCalledWith("https://shop.sites.test", expect.any(Object));
    expect(screen.getByText(/Unpublished draft changes are not included/)).toBeTruthy();
  });

  it("offers no public QR while the Site is offline", async () => {
    renderReleases({ site: { ...initialSite(), isPublic: false, publication: "not-live" } });
    await open();
    expect(screen.queryByRole("button", { name: coreMessagesByLocale.en.share.qrCode })).toBeNull();
  });

  it("explains a first publication and legacy versions without inventing rollback artifacts", async () => {
    renderReleases({ releases: { ...initialReleases(), versions: [], history: [] } });
    await open();
    expect(
      screen.getByText("No published versions yet. Publish this Site to start its history."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Roll back to/ })).toBeNull();
  });
});
