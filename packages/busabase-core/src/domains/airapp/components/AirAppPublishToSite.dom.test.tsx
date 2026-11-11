// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppSiteStateVO } from "busabase-contract/domains/airapp/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, type CoreLocale } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { NodeActionsMenu } from "../../dashboard/components/node-actions-menu";
import { SubmitPermissionProvider } from "../../dashboard/components/split-submit-button";
import { DashboardVisitorProvider } from "../../dashboard/visitor-context";
import type { AirAppEnginePlanGate } from "../utils/engine-plan-gate";
import { AirAppPublishToSite } from "./AirAppPublishToSite";
import { AirAppEngineAvailabilityProvider } from "./engine-availability-context";
import type { AirAppRunnerKind } from "./runners/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../dashboard/components/file-tree-browser", () => ({ NodeDeleteDialog: () => null }));
vi.mock("../../dashboard/components/node-settings-dialog", () => ({
  NodeSettingsDialog: () => null,
}));
vi.mock("../../dashboard/components/node-share-button", () => ({ NodeShareDialog: () => null }));

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.scrollIntoView ??= () => undefined;

const stateOf = (override: Partial<AirAppSiteStateVO> = {}): AirAppSiteStateVO => ({
  engine: "available",
  address: "https://lead-engine.sites.test",
  publication: "not-live",
  isPublic: false,
  previewUrl: null,
  previewVersion: null,
  liveVersion: null,
  currentVersion: "v1",
  previewStale: false,
  previewDeployedAt: null,
  liveDeployedAt: null,
  blockers: [],
  ...override,
});

const clients: QueryClient[] = [];
const renderPublish = ({
  state = stateOf(),
  planGate,
  engines = ["browser", "site"],
  notConfigured = [],
  permission = "manage",
  anonymous = false,
  locale = "en",
}: {
  state?: AirAppSiteStateVO;
  planGate?: AirAppEnginePlanGate;
  engines?: AirAppRunnerKind[];
  notConfigured?: AirAppRunnerKind[];
  permission?: ApiKeyPermissionLevel;
  anonymous?: boolean;
  locale?: CoreLocale;
} = {}) => {
  let current = state;
  const read = vi.fn(async () => current);
  const deploy = vi.fn(async () => {
    current = stateOf({
      previewUrl: "/api/airapp-preview/node/",
      previewVersion: "v1",
    });
    return { outcome: "ok", state: current };
  });
  const goLive = vi.fn(async () => {
    current = { ...current, publication: "live", isPublic: true, liveVersion: "v1" };
    return { outcome: "ok", state: current };
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(queryClient);
  const orpc = {
    nodes: {
      subscription: {
        get: {
          queryOptions: () => ({
            queryKey: ["subscription", "node"],
            queryFn: async () => ({ nodeId: "node", state: "none", source: null, via: null }),
          }),
        },
        set: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      },
    },
    airapps: {
      siteState: {
        queryOptions: () => ({ queryKey: ["site", "node"], queryFn: read }),
      },
      siteDeployPreview: { call: deploy },
      siteGoLive: { call: goLive },
    },
  } as unknown as BusabaseQueryUtils;
  render(
    <CoreI18nProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        <SubmitPermissionProvider permissionLevel={permission}>
          <DashboardVisitorProvider visitorKind={anonymous ? "anonymous" : "member"}>
            <AirAppEngineAvailabilityProvider
              engines={engines}
              notConfiguredEngines={notConfigured}
              planGate={planGate}
            >
              <AirAppPublishToSite nodeId="node" nodeName="Lead Engine" orpc={orpc}>
                {(publishAction) => (
                  <NodeActionsMenu
                    extraActions={publishAction}
                    nodeId="node"
                    nodeName="Lead Engine"
                    nodeType="airapp"
                    orpc={orpc}
                  />
                )}
              </AirAppPublishToSite>
            </AirAppEngineAvailabilityProvider>
          </DashboardVisitorProvider>
        </SubmitPermissionProvider>
      </QueryClientProvider>
    </CoreI18nProvider>,
  );
  return {
    read,
    deploy,
    goLive,
    queryClient,
    setState: (next: AirAppSiteStateVO) => {
      current = next;
    },
  };
};

const openMenu = (locale: CoreLocale = "en") =>
  fireEvent.pointerDown(
    screen.getByRole("button", { name: coreMessagesByLocale[locale].common.moreActions }),
    { button: 0, ctrlKey: false, pointerType: "mouse" },
  );

const openPublish = (locale: CoreLocale = "en") => {
  openMenu(locale);
  fireEvent.click(
    screen.getByRole("menuitem", { name: coreMessagesByLocale[locale].airapp.site.publish.title }),
  );
};

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("publishing a running AirApp alongside its browser preview", () => {
  it("opens publishing from More actions, closes the menu, and checks site state only on selection", async () => {
    const { read, deploy, goLive } = renderPublish();
    expect(screen.queryByRole("button", { name: "Publish to site" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Publish to site" })).toBeNull();
    expect(read).not.toHaveBeenCalled();
    openMenu();
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Publish to site" }));
    await screen.findByRole("button", { name: "Create website preview" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(read).toHaveBeenCalledOnce();
    expect(deploy).not.toHaveBeenCalled();
    expect(goLive).not.toHaveBeenCalled();
    expect(
      screen.getByText("Your browser preview keeps running while you prepare the website."),
    ).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
    openPublish();
    await screen.findByRole("button", { name: "Create website preview" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps preparation visible on Free and closes before opening the existing upgrade flow", async () => {
    const onUpgrade = vi.fn();
    const { deploy, goLive } = renderPublish({
      state: stateOf({ engine: "locked", blockers: [{ code: "not-a-site-app" }] }),
      planGate: { lockedEngines: ["site"], planLabel: "Plus", onUpgrade },
    });
    openPublish();
    await screen.findByText("Website hosting is included with Plus and above.");
    expect(screen.getByRole("button", { name: "Copy agent prompt" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create website preview" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Plus" }));
    await waitFor(() => expect(onUpgrade).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deploy).not.toHaveBeenCalled();
    expect(goLive).not.toHaveBeenCalled();
  });

  it("creates a member preview, checks its HTTP response, and publishes only after the preview loads", async () => {
    const fetchPreview = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchPreview);
    const { deploy, goLive } = renderPublish();
    openPublish();
    fireEvent.click(await screen.findByRole("button", { name: "Create website preview" }));
    await waitFor(() => expect(deploy).toHaveBeenCalledExactlyOnceWith({ nodeId: "node" }));
    const iframe = await screen.findByTitle("Private website preview");
    expect(iframe.getAttribute("src")).toBe("/api/airapp-preview/node/?__busabase_site_version=v1");
    const publish = screen.getByRole("button", { name: "Go live" });
    expect(publish).toHaveProperty("disabled", true);
    fireEvent.load(iframe);
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    expect(fetchPreview).toHaveBeenCalledWith(
      "/api/airapp-preview/node/?__busabase_site_version=v1",
      expect.objectContaining({ method: "HEAD", credentials: "same-origin", cache: "no-store" }),
    );
    expect(goLive).not.toHaveBeenCalled();
    fireEvent.click(publish);
    await screen.findByRole("link", { name: "https://lead-engine.sites.test" });
    expect(goLive).toHaveBeenCalledExactlyOnceWith({ nodeId: "node" });
    expect(screen.getByText("Live")).toBeTruthy();
    expect(publish).toHaveProperty("disabled", true);
  });

  it("does not reuse another member's saved preview registration", async () => {
    renderPublish({
      state: stateOf({ previewUrl: "/api/airapp-preview/node/", previewVersion: "v1" }),
    });
    openPublish();
    await screen.findByRole("button", { name: "Create website preview" });
    expect(screen.queryByTitle("Private website preview")).toBeNull();
    expect(screen.getByRole("button", { name: "Go live" })).toHaveProperty("disabled", true);
  });

  it("does not enable Go live for a 404 preview document", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { goLive } = renderPublish();
    openPublish();
    fireEvent.click(await screen.findByRole("button", { name: "Create website preview" }));
    fireEvent.load(await screen.findByTitle("Private website preview"));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      coreMessagesByLocale.en.airapp.site.publish.previewUnavailable,
    );
    expect(screen.getByRole("button", { name: "Go live" })).toHaveProperty("disabled", true);
    expect(goLive).not.toHaveBeenCalled();
  });

  it.each([405, 501])("can publish a working website that refuses HEAD with %s", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status })
        .mockResolvedValueOnce({ ok: true, status: 200 }),
    );
    const { goLive } = renderPublish();
    openPublish();
    fireEvent.click(await screen.findByRole("button", { name: "Create website preview" }));
    fireEvent.load(await screen.findByTitle("Private website preview"));
    const publish = screen.getByRole("button", { name: "Go live" });
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    fireEvent.click(publish);
    await waitFor(() => expect(goLive).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("copies an agent preparation request with this app's locator and leaves publishing untouched", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { deploy, goLive } = renderPublish({
      state: stateOf({ blockers: [{ code: "not-a-site-app" }] }),
    });
    openPublish();
    fireEvent.click(await screen.findByRole("button", { name: "Copy agent prompt" }));
    await screen.findByRole("button", { name: "Prompt copied" });
    expect(writeText).toHaveBeenCalledOnce();
    const prompt = writeText.mock.calls[0][0] as string;
    expect(prompt).toContain("Lead Engine");
    expect(prompt).toContain("node");
    expect(prompt).toContain("busabase-app-creator");
    expect(prompt).toContain("preserve its existing browser runtime");
    expect(prompt).toContain("site.access read-only");
    expect(screen.queryByRole("button", { name: "Go live" })).toBeNull();
    expect(deploy).not.toHaveBeenCalled();
    expect(goLive).not.toHaveBeenCalled();
  });

  it("keeps a failed clipboard copy recoverable inside the publishing dialog", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("Clipboard unavailable"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPublish({ state: stateOf({ blockers: [{ code: "not-a-site-app" }] }) });
    openPublish();
    fireEvent.click(await screen.findByRole("button", { name: "Copy agent prompt" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      coreMessagesByLocale.en.agentPrompts.locatorCopyFailed,
    );
    writeText.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Copy agent prompt" }));
    await screen.findByRole("button", { name: "Prompt copied" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rechecks on reopening and explains a stale preview instead of publishing changed files", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const { read, goLive } = renderPublish();
    goLive.mockResolvedValueOnce({
      outcome: "preview-stale",
      state: stateOf({
        previewVersion: "v1",
        previewUrl: "/api/airapp-preview/node/",
        previewStale: true,
        currentVersion: "v2",
      }),
    });
    openPublish();
    fireEvent.click(await screen.findByRole("button", { name: "Create website preview" }));
    fireEvent.load(await screen.findByTitle("Private website preview"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Go live" })).toHaveProperty("disabled", false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      coreMessagesByLocale.en.airapp.site.publish.previewStale,
    );
    expect(
      screen.getAllByText(coreMessagesByLocale.en.airapp.site.publish.previewStale),
    ).toHaveLength(1);
    expect(screen.queryByTitle("Private website preview")).toBeNull();
    expect(screen.getByRole("button", { name: "Go live" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    const before = read.mock.calls.length;
    openPublish();
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
  });

  it("keeps a failed readiness check recoverable and refuses to publish stale cached data", async () => {
    const { read, deploy } = renderPublish();
    read.mockRejectedValueOnce(new Error("You do not have write access to this app."));
    openPublish();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("write access"),
    );
    expect(screen.queryByRole("button", { name: "Create website preview" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "Create website preview" });
    expect(deploy).not.toHaveBeenCalled();
  });

  it("shows deployment configuration separately from paid upgrades", async () => {
    const onUpgrade = vi.fn();
    renderPublish({
      state: stateOf({ engine: "not-configured" }),
      engines: ["browser"],
      notConfigured: ["site"],
      planGate: { lockedEngines: ["site"], planLabel: "Plus", onUpgrade },
    });
    openPublish();
    await screen.findByText("Not configured — ask an administrator");
    expect(screen.queryByRole("button", { name: "Upgrade to Plus" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create website preview" })).toBeNull();
  });

  it.each([
    ["read-only user", { permission: "read" as const }],
    ["change-request contributor", { permission: "changeRequest" as const }],
    ["anonymous visitor", { anonymous: true }],
    ["browser-only deployment", { engines: ["browser"] as AirAppRunnerKind[] }],
  ])("has no publishing action or state query for a %s", (_reason, overrides) => {
    const { read } = renderPublish(overrides);
    expect(screen.queryByRole("button", { name: "Publish to site" })).toBeNull();
    if (!("anonymous" in overrides && overrides.anonymous)) openMenu();
    expect(screen.queryByRole("menuitem", { name: "Publish to site" })).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("uses the active locale throughout the upgrade and preparation path", async () => {
    renderPublish({
      locale: "zh-CN",
      state: stateOf({ engine: "locked", blockers: [{ code: "not-a-site-app" }] }),
      planGate: { lockedEngines: ["site"], planLabel: "Plus", onUpgrade: vi.fn() },
    });
    openPublish("zh-CN");
    await screen.findByRole("button", { name: "复制 Agent 提示词" });
    expect(screen.getByText("Plus 及以上套餐包含网站托管。")).toBeTruthy();
  });
});

describe("publishing translations", () => {
  it.each(Object.entries(coreMessagesByLocale))(
    "%s supplies complete publishing copy",
    (locale, messages) => {
      const copy = messages.airapp.site.publish;
      expect(Object.keys(copy)).toEqual(Object.keys(coreMessagesByLocale.en.airapp.site.publish));
      if (locale !== "en")
        expect(copy.title).not.toBe(coreMessagesByLocale.en.airapp.site.publish.title);
      expect(copy.planRequired).toContain("{plan}");
      expect(copy.agentPrompt).toContain("busabase-app-creator");
      expect(copy.agentPrompt).toContain("site.access");
      for (const value of Object.values(copy)) expect(value.length).toBeGreaterThan(0);
    },
  );
});
