// @vitest-environment jsdom
import { ORPCError } from "@orpc/client";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppSiteStateVO } from "busabase-contract/domains/airapp/contract";
import type { AirAppVO } from "busabase-contract/types";
import { Tabs, TabsContent } from "kui/tabs";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SubmitPermissionProvider } from "../../dashboard/components/split-submit-button";
import { DashboardVisitorProvider } from "../../dashboard/visitor-context";
import { useAirAppSiteViews } from "../hooks/use-airapp-site-views";
import { AirAppDetailViewSwitcher } from "./AirAppDetailView";
import { AirAppSiteToolbarActions } from "./AirAppSiteViews";
import { AirAppEngineAvailabilityProvider } from "./engine-availability-context";
import {
  AirAppRunControls,
  type AirAppRunnerState,
  AirAppRunPreview,
  useAirAppFullscreen,
} from "./RunPanel";
import type { AirAppRunnerKind } from "./runners/types";

vi.mock("../../dashboard/components/file-upload-tasks", () => ({
  useFileUploadTasks: () => ({ enqueue: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const encodeQr = vi.hoisted(() =>
  vi.fn(async (url: string) => `data:image/png;base64,${btoa(url)}`),
);
vi.mock("qrcode", () => ({ default: { toDataURL: encodeQr } }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  encodeQr.mockClear();
});
const ownerUrl = "/api/airapp-preview/app/?__busabase_site_version=v1";
const sharedUrl =
  "https://workspace.busabase.com/api/airapp-preview/app/?__busabase_site_version=v1&__busabase_preview=bounded-share-link";
const deployedUrl = "https://published.sites.test/";
const airapp = { node: { id: "app", name: "Preview app" }, files: [] } as unknown as AirAppVO;
const state: AirAppSiteStateVO = {
  engine: "available",
  publication: "not-live",
  isPublic: false,
  address: deployedUrl,
  previewUrl: "/api/airapp-preview/app/",
  previewShareUrl: sharedUrl,
  previewVersion: "v1",
  currentVersion: "v1",
  liveVersion: null,
  previewStale: false,
  previewDeployedAt: null,
  liveDeployedAt: null,
  blockers: [],
};
const liveState: AirAppSiteStateVO = {
  ...state,
  publication: "live-with-changes",
  isPublic: true,
  liveVersion: "v0",
};
function renderPreview({
  pinned = false,
  permission = "write",
  read = vi.fn(async () => state),
  cachedState,
  kind = "site",
  busy = false,
  anonymous = false,
}: {
  pinned?: boolean;
  permission?: ApiKeyPermissionLevel;
  read?: () => Promise<AirAppSiteStateVO>;
  cachedState?: AirAppSiteStateVO;
  kind?: AirAppRunnerKind;
  busy?: boolean;
  anonymous?: boolean;
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  if (cachedState) client.setQueryData(["site", "app"], cachedState);
  const logsRead = vi.fn(async (input: { nodeId: string; version: string }) => ({
    available: true,
    version: input.version,
    from: "2026-11-18T01:00:00Z",
    to: "2026-11-18T02:00:00Z",
    truncated: false,
    entries: [
      {
        id: "live-entry",
        timestamp: "2026-11-18T01:30:00Z",
        level: "info",
        message: "production response",
        method: "GET",
        path: "/",
        status: 200,
      },
    ],
  }));
  const unpublish = vi.fn(async () => ({ outcome: "ok" as const, state }));
  const orpc = {
    fileTrees: {
      readFile: {
        queryOptions: () => ({
          queryKey: ["file", "app"],
          queryFn: async () => ({ content: "", encoding: "utf8" }),
        }),
      },
    },
    airapps: {
      siteState: { queryOptions: () => ({ queryKey: ["site", "app"], queryFn: read }) },
      siteDomains: {
        queryOptions: () => ({
          queryKey: ["domains", "app"],
          queryFn: async () => ({ bindings: [] }),
        }),
      },
      siteReleases: { queryOptions: () => ({ queryKey: ["releases", "app"] }) },
      siteGoLive: { call: vi.fn() },
      siteUnpublish: { call: unpublish },
      siteLogs: {
        queryOptions: ({ input }: { input: { nodeId: string; version: string } }) => ({
          queryKey: ["site-logs", input.version],
          queryFn: () => logsRead(input),
        }),
      },
    },
  } as unknown as BusabaseQueryUtils;
  const runner: AirAppRunnerState = {
    status: busy ? "starting" : "ready",
    previewUrl: ownerUrl,
    runnerKind: kind,
    logLines: [],
    error: null,
    errorCode: null,
    engineLock: null,
    siteBlockers: null,
    orpc,
    run: vi.fn(),
    stop: vi.fn(),
    isBusy: busy,
    isLive: true,
  };
  function Detail() {
    const fullscreen = useAirAppFullscreen();
    const views = useAirAppSiteViews({ orpc, airapp, kind, previewUrl: ownerUrl, status: "ready" });
    const [tab, setTab] = useState("app");
    const destination = views.view === "deployed" ? "deployed" : "app";
    const activeTab = fullscreen.fullscreen || tab === "deployed" ? destination : tab;
    const content = (
      <>
        <header data-airapp-detail-toolbar="">
          <AirAppDetailViewSwitcher siteViews={views} />
          {views.isSite ? (
            <AirAppSiteToolbarActions
              views={views}
              controls={
                <AirAppRunControls
                  airapp={airapp}
                  fullscreenState={fullscreen}
                  previewState={views.activePreview}
                  siteViews={views}
                  runner={runner}
                />
              }
            />
          ) : (
            <AirAppRunControls
              airapp={airapp}
              fullscreenState={fullscreen}
              previewState={views.activePreview}
              siteViews={views}
              runner={runner}
            />
          )}
        </header>
        <div hidden={activeTab !== "app" && activeTab !== "deployed"}>
          <AirAppRunPreview
            airapp={airapp}
            fullscreenState={fullscreen}
            previewState={views.preview}
            siteViews={views}
            runner={runner}
            showToolbar={false}
            tabbed={!views.isSite}
          />
        </div>
        {!views.isSite ? (
          <>
            <TabsContent value="files">Source files</TabsContent>
            <TabsContent value="logs">Runtime logs</TabsContent>
          </>
        ) : null}
      </>
    );
    return views.isSite ? (
      <div>{content}</div>
    ) : (
      <Tabs value={activeTab} onValueChange={setTab}>
        {content}
      </Tabs>
    );
  }
  const fixture = () => (
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={client}>
        <SubmitPermissionProvider permissionLevel={permission}>
          <DashboardVisitorProvider visitorKind={anonymous ? "anonymous" : "member"}>
            <AirAppEngineAvailabilityProvider engines={["browser", "site"]}>
              {pinned ? <AirAppRunPreview airapp={airapp} runner={runner} /> : <Detail />}
            </AirAppEngineAvailabilityProvider>
          </DashboardVisitorProvider>
        </SubmitPermissionProvider>
      </QueryClientProvider>
    </CoreI18nProvider>
  );
  const view = render(fixture());
  return {
    runner,
    read,
    client,
    logsRead,
    unpublish,
    setBusy: (next: boolean) => {
      runner.status = next ? "starting" : "ready";
      runner.isBusy = next;
      view.rerender(fixture());
    },
  };
}
const openMenu = () =>
  fireEvent.pointerDown(
    screen.queryByRole("button", { name: "More actions" }) ??
      screen.getByRole("button", { name: "Preview & publish" }),
    {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    },
  );
const selectMode = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));
const address = (label = "Preview") =>
  screen.getByRole("textbox", { name: label }) as HTMLInputElement;
const liveFrame = () => {
  const frame = document.querySelector<HTMLIFrameElement>("iframe[data-airapp-deployed-frame]");
  if (!frame) throw new Error("The deployed website iframe must be mounted");
  return frame;
};
const changeSite = async (client: QueryClient, next: AirAppSiteStateVO) => {
  await act(async () => {
    client.setQueryData(["site", "app"], next);
  });
};

describe("Site destinations on both workbench surfaces", () => {
  it.each([false, true])(
    "disables duplicate preview refreshes while busy (pinned=%s)",
    (pinned) => {
      const { runner } = renderPreview({ pinned, busy: true });
      const refresh = screen.getByRole("button", { name: "Refresh page" });
      expect(refresh).toHaveProperty("disabled", true);
      fireEvent.click(refresh);
      expect(runner.run).not.toHaveBeenCalled();
    },
  );
  it.each(
    (["browser", "site"] as const).flatMap((kind) =>
      [false, true].map((pinned) => ({ kind, pinned })),
    ),
  )(
    "waits for Site preparation without blocking Browser publication (kind=$kind, pinned=$pinned)",
    async ({ kind, pinned }) => {
      const { setBusy, unpublish } = renderPreview({
        pinned,
        kind,
        busy: true,
        read: vi.fn(async () => liveState),
      });
      expect(screen.queryByRole("button", { name: "Publish update" })).toBeNull();
      openMenu();
      const primary = await screen.findByRole("menuitem", { name: "Publish update" });
      const arrow = screen.getByRole("menuitem", { name: "Publication actions" });
      expect(primary).toHaveProperty("disabled", kind === "site");
      expect(arrow.getAttribute("aria-disabled") === "true").toBe(kind === "site");
      if (kind === "site") {
        fireEvent.click(primary);
        fireEvent.keyDown(arrow, { key: "ArrowRight" });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.queryByRole("menuitem", { name: "Unpublish" })).toBeNull();
        expect(unpublish).not.toHaveBeenCalled();
      }
      setBusy(false);
      await waitFor(() => expect(primary).toHaveProperty("disabled", false));
      expect(arrow.getAttribute("aria-disabled")).not.toBe("true");
      fireEvent.keyDown(arrow, { key: "ArrowRight" });
      expect(await screen.findByRole("menuitem", { name: "Unpublish" })).toBeTruthy();
      expect(unpublish).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    "returns from the deployed website to the preserved private preview after confirming unpublish (pinned=%s)",
    async (pinned) => {
      let current = liveState;
      const { unpublish } = renderPreview({ pinned, read: vi.fn(async () => current) });
      unpublish.mockImplementation(async () => {
        current = { ...current, publication: "not-live", isPublic: false };
        return { outcome: "ok", state: current };
      });
      await screen.findByRole("radio", { name: "Deployed Site" });
      const draft = screen.getByTitle("AirApp preview");
      selectMode("Deployed Site");
      expect(liveFrame()).toBeTruthy();
      openMenu();
      fireEvent.keyDown(await screen.findByRole("menuitem", { name: "Publication actions" }), {
        key: "ArrowRight",
      });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Unpublish" }));
      expect(unpublish).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(unpublish).toHaveBeenCalledExactlyOnceWith({ nodeId: "app" });
      expect(screen.queryByRole("radio", { name: "Deployed Site" })).toBeNull();
      expect(document.querySelector("[data-airapp-deployed-frame]")).toBeNull();
      expect(screen.getByRole("radio", { name: "Preview" }).getAttribute("aria-checked")).toBe(
        "true",
      );
      expect(screen.getByTitle("AirApp preview")).toBe(draft);
      expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
      openMenu();
      expect(await screen.findByRole("menuitem", { name: "Publish" })).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: "Publication actions" })).toBeNull();
    },
  );
  it.each([false, true])(
    "uses one persistent primary mode choice above subordinate Files and Logs (pinned=%s)",
    async (pinned) => {
      renderPreview({ pinned, read: vi.fn(async () => liveState) });
      const deployed = await screen.findByRole("radio", { name: "Deployed Site" });
      const preview = screen.getByRole("radio", { name: "Preview" });
      const group = screen.getByRole("radiogroup", { name: "Viewing mode" });
      const assertOneChoice = () =>
        expect(group.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1);
      assertOneChoice();
      expect(preview.getAttribute("aria-checked")).toBe("true");
      expect(group.contains(screen.getByRole("button", { name: "Files" }))).toBe(false);
      expect(group.contains(screen.getByRole("button", { name: "Browser logs" }))).toBe(false);
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByRole("tabpanel", { hidden: true })).toBeNull();
      expect(screen.getByRole("region", { name: "Preview" })).toBeTruthy();
      fireEvent.click(preview);
      assertOneChoice();
      expect(preview.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Files" }));
      expect(screen.getByRole("button", { name: "Files" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      fireEvent.click(preview);
      expect(screen.getByRole("button", { name: "Files" }).getAttribute("aria-pressed")).toBe(
        "false",
      );
      assertOneChoice();
      act(() => preview.focus());
      fireEvent.keyDown(preview, { key: "ArrowRight" });
      await waitFor(() => expect(document.activeElement).toBe(deployed));
      expect(preview.getAttribute("aria-checked")).toBe("true");
      expect(document.querySelector("[data-airapp-deployed-frame]")).toBeNull();
      fireEvent.click(deployed);
      expect(deployed.getAttribute("aria-checked")).toBe("true");
      expect(screen.getByRole("region", { name: "Deployed Site" })).toBeTruthy();
      fireEvent.click(deployed);
      assertOneChoice();
      expect(deployed.getAttribute("aria-checked")).toBe("true");
      act(() => deployed.focus());
      fireEvent.keyDown(deployed, { key: "ArrowLeft" });
      await waitFor(() => expect(document.activeElement).toBe(preview));
      expect(deployed.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(preview);
      assertOneChoice();
      expect(preview.getAttribute("aria-checked")).toBe("true");
    },
  );
  it.each([false, true])(
    "keeps contextual Files and Logs on the left and the deployed address on the right (pinned=%s)",
    async (pinned) => {
      renderPreview({ pinned, read: vi.fn(async () => liveState) });
      await screen.findByRole("radio", { name: "Deployed Site" });
      const files = screen.getByRole("button", { name: "Files" });
      const browserLogs = screen.getByRole("button", { name: "Browser logs" });
      const left = files.closest("[data-airapp-view-switcher]");
      const right = document.querySelector("[data-airapp-site-toolbar-actions]");
      expect(left).not.toBeNull();
      expect(right).not.toBeNull();
      if (!left || !right) throw new Error("Both toolbar groups must be present");
      expect(left.contains(browserLogs)).toBe(true);
      expect(files.closest('[role="radiogroup"]')).toBeNull();
      expect(browserLogs.closest('[role="radiogroup"]')).toBeNull();
      expect(
        Array.from(left.querySelectorAll('[role="radio"], button[aria-pressed]')).map((control) =>
          control.getAttribute("aria-label"),
        ),
      ).toEqual(["Preview", "Deployed Site", "Files", "Browser logs"]);
      expect(right.contains(files)).toBe(false);
      expect(right.contains(screen.getByRole("button", { name: "More actions" }))).toBe(true);
      expect(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      selectMode("Deployed Site");
      const onlineLogs = screen.getByRole("button", { name: "Online logs" });
      expect(left.contains(onlineLogs)).toBe(true);
      expect(onlineLogs.closest('[role="radiogroup"]')).toBeNull();
      expect(screen.queryByRole("button", { name: "Files" })).toBeNull();
      expect(right.contains(address("Deployed Site"))).toBe(true);
      expect(right.contains(screen.getByRole("button", { name: "Copy link" }))).toBe(true);
      expect(right.contains(screen.getByRole("link", { name: "Open in new tab" }))).toBe(true);
      expect(right.contains(onlineLogs)).toBe(false);
    },
  );
  it.each([false, true])(
    "shows actual private browser output and queries the deployed release for online logs (pinned=%s)",
    async (pinned) => {
      const { logsRead } = renderPreview({ pinned, read: vi.fn(async () => liveState) });
      await screen.findByRole("radio", { name: "Deployed Site" });
      const draft = screen.getByTitle("AirApp preview") as HTMLIFrameElement;
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: draft.contentWindow,
            origin: window.location.origin,
            data: { channel: "busabase-airapp-console", level: "info", message: "browser event" },
          }),
        );
      });
      fireEvent.click(screen.getByRole("button", { name: "Browser logs" }));
      expect(await screen.findByText(/browser event/)).toBeTruthy();
      expect(logsRead).not.toHaveBeenCalled();
      expect(screen.getByRole("radio", { name: "Preview" }).getAttribute("aria-checked")).toBe(
        "true",
      );
      fireEvent.click(screen.getByRole("radio", { name: "Preview" }));
      expect(screen.queryByText(/browser event/)).toBeNull();
      expect(screen.getByTitle("AirApp preview")).toBe(draft);
      selectMode("Deployed Site");
      expect(screen.queryByRole("button", { name: "Files" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Browser logs" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Online logs" }));
      expect(await screen.findByText("production response")).toBeTruthy();
      expect(logsRead).toHaveBeenCalledWith({ nodeId: "app", version: "v0" });
      expect(
        screen.getByRole("radio", { name: "Deployed Site" }).getAttribute("aria-checked"),
      ).toBe("true");
      fireEvent.click(screen.getByRole("radio", { name: "Deployed Site" }));
      expect(screen.queryByText("production response")).toBeNull();
    },
  );
  it.each([false, true])(
    "switches primary modes and URL actions without replacing either frame (pinned=%s)",
    async (pinned) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      renderPreview({ pinned, read: vi.fn(async () => liveState) });
      const deployedTab = await screen.findByRole("radio", { name: "Deployed Site" });
      const tabs = screen.getAllByRole("radio").map((tab) => tab.getAttribute("aria-label"));
      expect(tabs).toEqual(["Preview", "Deployed Site"]);
      expect(deployedTab.previousElementSibling?.getAttribute("aria-label")).toBe("Preview");
      expect(document.querySelector("[data-airapp-deployed-frame]")).toBeNull();
      const draft = screen.getByTitle("AirApp preview");
      draft.setAttribute("data-unsaved-input", "private draft");
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.getByRole("button", { name: "Files" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Browser logs" })).toBeTruthy();
      selectMode("Deployed Site");
      const live = liveFrame();
      live.setAttribute("data-unsaved-input", "public session");
      expect(live.getAttribute("src")).toBe(deployedUrl);
      expect(live.hasAttribute("credentialless")).toBe(true);
      expect(draft.hasAttribute("credentialless")).toBe(false);
      expect(address("Deployed Site").value).toBe(deployedUrl);
      expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
      const open = screen.getByRole("link", { name: "Open in new tab" });
      expect(open.getAttribute("href")).toBe(deployedUrl);
      expect(open.getAttribute("target")).toBe("_blank");
      expect(open.getAttribute("rel")).toBe("noopener noreferrer");
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(deployedUrl));
      selectMode("Preview");
      expect(screen.getByTitle("AirApp preview")).toBe(draft);
      expect(screen.queryByRole("textbox")).toBeNull();
      selectMode("Deployed Site");
      expect(liveFrame()).toBe(live);
      selectMode("Preview");
      fireEvent.click(screen.getByRole("button", { name: "Files" }));
      expect(screen.getByRole("radio", { name: "Preview" }).getAttribute("aria-checked")).toBe(
        "true",
      );
      fireEvent.click(screen.getByRole("radio", { name: "Preview" }));
      selectMode("Deployed Site");
      expect(screen.getByTitle("AirApp preview")).toBe(draft);
      expect(liveFrame()).toBe(live);
      expect(draft.getAttribute("data-unsaved-input")).toBe("private draft");
      expect(live.getAttribute("data-unsaved-input")).toBe("public session");
    },
  );

  it.each([false, true])(
    "reloads the deployed frame and reconciles the private preview, including fullscreen (pinned=%s)",
    async (pinned) => {
      const { runner } = renderPreview({ pinned, read: vi.fn(async () => liveState) });
      await screen.findByRole("radio", { name: "Deployed Site" });
      const draft = screen.getByTitle("AirApp preview") as HTMLIFrameElement;
      const reloadDraft = vi.spyOn(draft, "src", "set");
      selectMode("Deployed Site");
      const live = liveFrame() as HTMLIFrameElement;
      const reloadLive = vi.spyOn(live, "src", "set");
      const refresh = screen.getByRole("button", { name: "Refresh page" });
      expect(refresh.nextElementSibling).toBe(screen.getByRole("button", { name: "More actions" }));
      fireEvent.click(refresh);
      expect(reloadLive).toHaveBeenCalledExactlyOnceWith(deployedUrl);
      expect(reloadDraft).not.toHaveBeenCalled();
      fireEvent.load(live);
      openMenu();
      expect(screen.queryByRole("menuitem", { name: /Refresh|Restart/ })).toBeNull();
      expect(screen.queryByRole("link", { name: "Preview link" })).toBeNull();
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Mobile" }));
      expect(
        live
          .closest("[data-airapp-preview-viewport]")
          ?.getAttribute("data-airapp-preview-viewport"),
      ).toBe("mobile");
      expect(
        draft
          .closest("[data-airapp-preview-viewport]")
          ?.getAttribute("data-airapp-preview-viewport"),
      ).toBe("desktop");
      openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Enter fullscreen" }));
      expect(
        screen.getByRole("radio", { name: "Deployed Site" }).getAttribute("aria-checked"),
      ).toBe("true");
      expect(liveFrame()).toBe(live);
      fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
      selectMode("Preview");
      fireEvent.click(screen.getByRole("button", { name: "Refresh page" }));
      expect(reloadDraft).not.toHaveBeenCalled();
      expect(reloadLive).toHaveBeenCalledTimes(1);
      expect(runner.run).toHaveBeenCalledExactlyOnceWith({ sitePreview: true });
      expect(runner.stop).not.toHaveBeenCalled();
    },
  );

  it("falls back to Preview when the website goes offline and waits for explicit selection after it returns", async () => {
    const { client } = renderPreview({ pinned: true, read: vi.fn(async () => liveState) });
    await screen.findByRole("radio", { name: "Deployed Site" });
    const draft = screen.getByTitle("AirApp preview");
    selectMode("Deployed Site");
    await changeSite(client, { ...liveState, publication: "not-live", isPublic: false });
    await waitFor(() => expect(screen.queryByRole("radio", { name: "Deployed Site" })).toBeNull());
    expect(document.querySelector("[data-airapp-deployed-frame]")).toBeNull();
    expect(screen.getByRole("radio", { name: "Preview" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByTitle("AirApp preview")).toBe(draft);
    await changeSite(client, liveState);
    await screen.findByRole("radio", { name: "Deployed Site" });
    expect(document.querySelector("[data-airapp-deployed-frame]")).toBeNull();
    selectMode("Deployed Site");
    expect(liveFrame().getAttribute("src")).toBe(deployedUrl);
  });

  it("loads a new public version without replacing the private draft", async () => {
    const { client } = renderPreview({ read: vi.fn(async () => liveState) });
    await screen.findByRole("radio", { name: "Deployed Site" });
    const draft = screen.getByTitle("AirApp preview");
    selectMode("Deployed Site");
    const live = liveFrame();
    await changeSite(client, { ...liveState, liveVersion: "v2" });
    await waitFor(() => expect(liveFrame()).not.toBe(live));
    expect(screen.getByTitle("AirApp preview")).toBe(draft);
    expect(address("Deployed Site").value).toBe(deployedUrl);
  });

  it("keeps the public website usable while the private sharing capability belongs to another version", async () => {
    renderPreview({
      read: vi.fn(async () => ({
        ...liveState,
        previewVersion: "v2",
        previewShareUrl: sharedUrl.replace("v1", "v2"),
      })),
    });
    await screen.findByRole("radio", { name: "Deployed Site" });
    expect(screen.queryByRole("textbox")).toBeNull();
    selectMode("Deployed Site");
    expect(address("Deployed Site").value).toBe(deployedUrl);
    expect(address("Deployed Site").disabled).toBe(false);
  });

  it("keeps QR preview tied to the version-scoped private capability while viewing the public website", async () => {
    renderPreview({ read: vi.fn(async () => liveState) });
    await screen.findByRole("radio", { name: "Deployed Site" });
    selectMode("Deployed Site");
    openMenu();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Preview on your phone" }), {
      key: "ArrowRight",
    });
    await screen.findByRole("img");
    expect(encodeQr).toHaveBeenCalledExactlyOnceWith(sharedUrl, expect.any(Object));
    expect(screen.getByTitle("AirApp preview").getAttribute("src")).toBe(ownerUrl);
  });

  it.each([
    { name: "reserved address before publication", liveVersion: null, isPublic: true },
    { name: "offline deployment", liveVersion: "v0", isPublic: false },
    { name: "unpublished site", publication: "not-live" as const },
    { name: "missing address", address: null },
    { name: "script address", address: "javascript:alert(1)" },
    { name: "data address", address: "data:text/html,not-a-website" },
    { name: "relative address", address: "/api/airapp-preview/app/" },
    { name: "credential-bearing address", address: "https://user:secret@published.sites.test" },
  ])("omits the deployed view for $name", async ({ name: _name, ...override }) => {
    renderPreview({ read: vi.fn(async () => ({ ...liveState, ...override })) });
    openMenu();
    await waitFor(() =>
      expect(
        screen
          .getByRole("menuitem", { name: "Preview on your phone" })
          .getAttribute("data-disabled"),
      ).toBeNull(),
    );
    expect(screen.queryByRole("radio", { name: "Deployed Site", hidden: true })).toBeNull();
    expect(document.querySelector("[data-airapp-deployed-frame]")).toBeNull();
  });

  it("does not expose a session-only or stale share URL while site state is loading", async () => {
    let complete!: (value: AirAppSiteStateVO) => void;
    const read = vi.fn(
      () =>
        new Promise<AirAppSiteStateVO>((resolve) => {
          complete = resolve;
        }),
    );
    renderPreview({ pinned: true, read });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Deployed Site" })).toBeNull();
    expect(screen.getByTitle("AirApp preview").getAttribute("src")).toBe(ownerUrl);
    await act(async () => complete(state));
    openMenu();
    await waitFor(() =>
      expect(
        screen
          .getByRole("menuitem", { name: "Preview on your phone" })
          .getAttribute("data-disabled"),
      ).toBeNull(),
    );
  });

  it("probes a Viewer once and never exposes privileged cached state after the server denies node access", async () => {
    const read = vi.fn(async () => {
      throw new ORPCError("FORBIDDEN");
    });
    const { client } = renderPreview({
      pinned: true,
      permission: "read",
      read,
      cachedState: liveState,
    });
    expect(screen.queryByRole("radio", { name: "Deployed Site" })).toBeNull();
    await waitFor(() => expect(client.getQueryState(["site", "app"])?.status).toBe("error"));
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("radio", { name: "Deployed Site" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    openMenu();
    expect(screen.queryByRole("menuitem", { name: /^Publish/ })).toBeNull();
    expect(screen.queryByText(/Anyone with this link/)).toBeNull();
  });

  it.each([false, true])(
    "lets a Viewer with a server-confirmed node write grant open deployed logs without enabling mutations (pinned=%s)",
    async (pinned) => {
      const read = vi.fn(async () => liveState);
      const { logsRead, unpublish, runner } = renderPreview({ pinned, permission: "read", read });
      await screen.findByRole("radio", { name: "Deployed Site" });
      selectMode("Deployed Site");
      fireEvent.click(screen.getByRole("button", { name: "Online logs" }));
      await screen.findByText("production response");
      expect(logsRead).toHaveBeenCalledTimes(1);
      openMenu();
      expect(screen.queryByRole("menuitem", { name: /^Publish|^Unpublish/ })).toBeNull();
      expect(unpublish).not.toHaveBeenCalled();
      expect(runner.run).not.toHaveBeenCalled();
    },
  );

  it("keeps normal Site state revalidation on focus and reconnect", async () => {
    const read = vi.fn(async () => liveState);
    renderPreview({ pinned: true, read });
    await screen.findByRole("radio", { name: "Deployed Site" });
    const initial = read.mock.calls.length;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(initial));
    const afterFocus = read.mock.calls.length;
    await act(async () => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(afterFocus));
  });

  it("never probes privileged Site state for an anonymous visitor even when a member result is cached", () => {
    const read = vi.fn(async () => liveState);
    renderPreview({
      pinned: true,
      permission: "read",
      anonymous: true,
      read,
      cachedState: liveState,
    });
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByRole("radio", { name: "Deployed Site" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Online logs" })).toBeNull();
  });

  it.each(
    (["browser", "local", "remote"] as const).flatMap((kind) =>
      [false, true].map((pinned) => ({ kind, pinned })),
    ),
  )(
    "keeps preview tools and the primary publish entry for non-Site engines (kind=$kind, pinned=$pinned)",
    async ({ kind, pinned }) => {
      renderPreview({ pinned, kind, read: vi.fn(async () => liveState) });
      if (!pinned) {
        expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual([
          "Files",
          "App",
          "Logs",
        ]);
      }
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByRole("tab", { name: "Deployed Site" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Publish update" })).toBeNull();
      openMenu();
      const publication = await screen.findByRole("menuitem", { name: "Publish update" });
      expect(publication.className).toContain("bg-primary");
      expect(screen.getByRole("link", { name: "Preview link" }).getAttribute("href")).toBe(
        new URL(ownerUrl, window.location.origin).href,
      );
      expect(screen.queryByRole("menuitem", { name: "Publish" })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Preview on your phone" })).toBeNull();
      expect(screen.getByRole("menuitemradio", { name: "Mobile" })).toBeTruthy();
      fireEvent.click(publication);
      expect(await screen.findByRole("dialog")).toBeTruthy();
      expect(screen.queryByRole("menu")).toBeNull();
    },
  );
});
