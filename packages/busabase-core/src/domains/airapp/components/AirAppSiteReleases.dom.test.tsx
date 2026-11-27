// @vitest-environment jsdom
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AirAppSiteReleasesVO,
  AirAppSiteStateVO,
} from "busabase-contract/domains/airapp/contract";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { NodeSettingsDialog } from "../../dashboard/components/node-settings-dialog";
import { SidePanel } from "../../dashboard/components/side-panel";
import { SubmitPermissionProvider } from "../../dashboard/components/split-submit-button";
import { createKnownNodeCache } from "../../dashboard/helpers/known-node-cache";
import { registerSidePanelTab, type SidePanelTabProps } from "../../dashboard/side-panel-registry";
import {
  DEFAULT_SIDE_PANEL_WIDTH,
  useSidePanelStore,
} from "../../dashboard/store/side-panel-store";
import { DashboardVisitorProvider } from "../../dashboard/visitor-context";
import { AirAppEngineAvailabilityProvider } from "./engine-availability-context";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,cXI=") },
}));
// Domain/public controls have dedicated DOM coverage; exercise the release workflow here.
vi.mock("./AirAppSiteControls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./AirAppSiteControls")>()),
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
  permission = "manage",
  visitorKind = "member",
  siteOffered = true,
  nodeType = "airapp",
  nodeId = "node",
  nodeName = "Shop",
}: {
  site?: AirAppSiteStateVO;
  releases?: AirAppSiteReleasesVO;
  permission?: "read" | "changeRequest" | "write" | "manage";
  visitorKind?: "member" | "anonymous";
  siteOffered?: boolean;
  nodeType?: string;
  nodeId?: string;
  nodeName?: string;
} = {}) => {
  let currentSite = site;
  let currentReleases = releases;
  const readSite = vi.fn(async () => currentSite);
  const read = vi.fn(async () => currentReleases);
  const publish = vi.fn(async () => ({ outcome: "ok", state: currentSite }));
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
    nodes: {
      get: {
        queryOptions: () => ({
          queryKey: ["node", nodeId],
          queryFn: () => new Promise(() => undefined),
        }),
      },
    },
    airapps: {
      siteState: {
        queryOptions: () => ({ queryKey: ["site", nodeId], queryFn: readSite }),
      },
      siteReleases: { queryOptions: () => ({ queryKey: ["releases", nodeId], queryFn: read }) },
      siteRollback: { call: rollback },
      siteGoLive: { call: publish },
    },
  } as unknown as BusabaseQueryUtils;
  function SettingsStory({ scopeKey = "space-a:user-a", api = orpc }) {
    const [settingsOpen, setSettingsOpen] = useState(false);
    return (
      <CoreI18nProvider locale="en">
        <QueryClientProvider client={queryClient}>
          <Router>
            <SubmitPermissionProvider permissionLevel={permission}>
              <DashboardVisitorProvider visitorKind={visitorKind}>
                <AirAppEngineAvailabilityProvider
                  engines={siteOffered ? ["browser", "site"] : ["browser"]}
                >
                  <button onClick={() => setSettingsOpen(true)} type="button">
                    Node settings
                  </button>
                  <NodeSettingsDialog
                    initialTab="releases"
                    nodeId={nodeId}
                    nodeName={nodeName}
                    nodeType={nodeType}
                    onOpenChange={setSettingsOpen}
                    open={settingsOpen}
                    orpc={api}
                  />
                </AirAppEngineAvailabilityProvider>
              </DashboardVisitorProvider>
            </SubmitPermissionProvider>
            <SidePanel
              currentNode={null}
              nodeCache={createKnownNodeCache(scopeKey)}
              onNavigate={vi.fn()}
              onOpenSearch={vi.fn()}
              orpc={api}
              scopeKey={scopeKey}
            />
          </Router>
        </QueryClientProvider>
      </CoreI18nProvider>
    );
  }
  const tree = (scopeKey = "space-a:user-a", api = orpc) => (
    <SettingsStory api={api} scopeKey={scopeKey} />
  );
  const view = render(tree());
  return {
    read,
    readSite,
    rollback,
    publish,
    queryClient,
    setReleases: (next: AirAppSiteReleasesVO) => {
      currentReleases = next;
    },
    rerenderScope: (scopeKey: string, api = orpc) => view.rerender(tree(scopeKey, api)),
  };
};
const close = () => fireEvent.click(screen.getByRole("button", { name: "Close" }));
const open = async () => {
  if (screen.queryByRole("dialog")) close();
  fireEvent.click(screen.getByRole("button", { name: "Node settings" }));
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
  it("puts one publish entry above progressive details and opens the existing guarded preview flow", async () => {
    const { publish } = renderReleases();
    await open();
    const panel = document.querySelector("[data-airapp-release-panel]") as HTMLElement;
    const action = screen.getByRole("button", { name: "Publish update" });
    const history = panel.querySelector("[data-airapp-release-history]") as HTMLDetailsElement;
    const settings = panel.querySelector("[data-airapp-release-settings]") as HTMLDetailsElement;
    expect(screen.getAllByRole("button", { name: "Publish update" })).toHaveLength(1);
    expect(history.open).toBe(false);
    expect(settings.open).toBe(false);
    expect(history.contains(action)).toBe(false);
    expect(settings.contains(action)).toBe(false);
    fireEvent.click(action);
    await screen.findByRole("button", { name: "Create website preview" });
    expect(screen.getByRole("button", { name: "Publish update" })).toHaveProperty("disabled", true);
    expect(publish).not.toHaveBeenCalled();
  });

  it("opens release management inside node settings without replacing Agent, record or preview tabs", async () => {
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
    const panelBefore = useSidePanelStore.getState();
    await open();
    expect(screen.getByRole("dialog").textContent).toContain("Shop");
    expect(screen.getByRole("button", { name: "Deployments" })).toBeTruthy();
    expect(screen.getByText("Existing address and domain settings")).toBeTruthy();
    expect(useSidePanelStore.getState().tabs).toBe(panelBefore.tabs);
    expect(useSidePanelStore.getState().activeTabId).toBe(panelBefore.activeTabId);
    close();
    for (const tab of tabs) {
      fireEvent.click(screen.getByRole("tab", { name: tab.title }));
      expect(screen.getByRole("textbox", { name: tab.payload.label })).toHaveProperty(
        "value",
        `${tab.title} retained`,
      );
    }
  });

  it("refetches on reopening and never offers stale recovery while checking", async () => {
    const { read, setReleases } = renderReleases();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Roll back to v1" }));
    close();
    expect(screen.queryByRole("dialog")).toBeNull();
    let resolve!: (next: AirAppSiteReleasesVO) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Node settings" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Roll back to v1" })).toHaveProperty(
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
      expect(screen.queryByRole("button", { name: "Roll back to v1" })).toBeNull(),
    );
  });

  it("pauses deployment polling while settings are closed and refreshes on reopening", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { read } = renderReleases({ releases: { ...initialReleases(), status: "deploying" } });
    await open();
    const started = read.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(read.mock.calls.length).toBeGreaterThan(started);
    close();
    const closed = read.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_100);
    });
    expect(read).toHaveBeenCalledTimes(closed);
    await open();
    expect(read.mock.calls.length).toBeGreaterThan(closed);
  });

  it.each([
    { permission: "read" as const },
    { permission: "changeRequest" as const },
    { visitorKind: "anonymous" as const },
    { siteOffered: false },
    { nodeType: "base" },
  ])("does not expose release management outside its publication access gate: %j", (options) => {
    const { read, readSite } = renderReleases(options);
    fireEvent.click(screen.getByRole("button", { name: "Node settings" }));
    expect(screen.queryByRole("button", { name: "Deployments" })).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(readSite).not.toHaveBeenCalled();
    expect(useSidePanelStore.getState().tabs).toEqual([]);
  });

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

  it("finishes a confirmed recovery after settings close and updates the shared site state", async () => {
    const { rollback, queryClient, setReleases } = renderReleases();
    let resolve!: (result: { outcome: string; state: AirAppSiteStateVO }) => void;
    rollback.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Roll back to v1" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm rollback" }));
    await waitFor(() => expect(rollback).toHaveBeenCalledOnce());
    close();
    setReleases({
      ...initialReleases(),
      versions: initialReleases().versions.map((version) => ({
        ...version,
        isCurrent: version.version === "first",
        canRollback: version.version !== "first",
      })),
    });
    await act(async () =>
      resolve({ outcome: "ok", state: { ...initialSite(), liveVersion: "first" } }),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(["site", "node"])).toHaveProperty("liveVersion", "first"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useSidePanelStore.getState().tabs).toEqual([]);
  });

  it("keeps another app's recovery scoped to the app named in node settings", async () => {
    const { rollback } = renderReleases({ nodeId: "other-app", nodeName: "Support Console" });
    await open();
    expect(screen.getByRole("dialog").textContent).toContain("Support Console");
    fireEvent.click(screen.getByRole("button", { name: "Roll back to v1" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm rollback" }));
    await waitFor(() =>
      expect(rollback).toHaveBeenCalledExactlyOnceWith({ nodeId: "other-app", version: "first" }),
    );
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

  it.each([
    { ...initialSite(), engine: "locked" as const },
    { ...initialSite(), publicationLock: { planLabel: "Plus" } },
  ])("disables paid rollback while keeping history readable: %j", async (site) => {
    renderReleases({ site });
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
    fireEvent.click(screen.getByRole("button", { name: "Node settings" }));
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

describe("Space Vault release permission", () => {
  it("keeps release history visible but disables rollback when saved sources need a manager", async () => {
    const { rollback } = renderReleases({
      site: {
        ...initialSite(),
        environmentDeploymentLock: { reason: "SPACE_VAULT_MANAGE_REQUIRED" },
      },
      releases: {
        ...initialReleases(),
        versions: initialReleases().versions.map((version) => ({ ...version, canRollback: false })),
      },
    });
    await open();
    expect(await screen.findByText(/A workspace owner or admin/)).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /Roll back to v1/ }).disabled,
    ).toBe(true);
    expect(rollback).not.toHaveBeenCalled();
  });
  it("shows a stable permission refusal instead of a generic load failure and retry button", async () => {
    const { read } = renderReleases();
    read.mockRejectedValue(new ORPCError("FORBIDDEN", { message: "internal-denial" }));
    fireEvent.click(screen.getByRole("button", { name: "Node settings" }));
    await screen.findByText(/You do not have permission to manage this website/);
    expect(screen.queryByText(coreMessagesByLocale.en.airapp.site.releases.loadFailed)).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(document.body.textContent).not.toContain("internal-denial");
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("keeps a permission change during rollback disabled rather than offering another failing attempt", async () => {
    const { rollback } = renderReleases();
    await open();
    rollback.mockRejectedValueOnce(
      new ORPCError("FORBIDDEN", { data: { reason: "SPACE_VAULT_MANAGE_REQUIRED" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Roll back to v1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm rollback" }));
    await screen.findByText(/A workspace owner or admin/);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Confirm rollback" }).disabled,
    ).toBe(true);
    expect(rollback).toHaveBeenCalledTimes(1);
  });
});
