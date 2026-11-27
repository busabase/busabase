// @vitest-environment jsdom
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AirAppSiteEnvironmentVO,
  AirAppSiteStateVO,
} from "busabase-contract/domains/airapp/contract";
import { type ReactNode, StrictMode } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, type CoreLocale } from "../../../i18n";
import { airAppToolbarMessages } from "../../../i18n/airapp-toolbar";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { NodeActionsMenu } from "../../dashboard/components/node-actions-menu";
import { SubmitPermissionProvider } from "../../dashboard/components/split-submit-button";
import { DashboardVisitorProvider } from "../../dashboard/visitor-context";
import { useAirAppPreviewState } from "../hooks/use-airapp-preview-state";
import type { AirAppEnginePlanGate } from "../utils/engine-plan-gate";
import { AirAppPreviewMenu } from "./AirAppPreviewMenu";
import { AirAppPublishToSite } from "./AirAppPublishToSite";
import { AirAppEngineAvailabilityProvider } from "./engine-availability-context";
import type { AirAppRunnerKind } from "./runners/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../dashboard/components/file-tree-browser", () => ({ NodeDeleteDialog: () => null }));
vi.mock("../../dashboard/components/node-settings-dialog", () => ({
  NodeSettingsDialog: () => null,
}));
vi.mock("../../dashboard/components/node-share-button", () => ({ NodeShareDialog: () => null }));
const encodeQr = vi.hoisted(() =>
  vi.fn(async (url: string) => `data:image/png;base64,${btoa(url)}`),
);
vi.mock("qrcode", () => ({ default: { toDataURL: encodeQr } }));

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
function SitesMenu({ publishMenuItem }: { publishMenuItem: ReactNode }) {
  const previewState = useAirAppPreviewState(null);
  return (
    <AirAppPreviewMenu
      kind="site"
      previewState={previewState}
      topItems={publishMenuItem}
      url={null}
    />
  );
}
const renderPublish = ({
  state = stateOf(),
  planGate,
  engines = ["browser", "site"],
  notConfigured = [],
  permission = "manage",
  anonymous = false,
  locale = "en",
  showButton = false,
  previewShareUrl,
  strict = false,
  toolbar = false,
  publicationBusy = false,
  menuPlacement = false,
  environment,
}: {
  state?: AirAppSiteStateVO;
  planGate?: AirAppEnginePlanGate;
  engines?: AirAppRunnerKind[];
  notConfigured?: AirAppRunnerKind[];
  permission?: ApiKeyPermissionLevel;
  anonymous?: boolean;
  locale?: CoreLocale;
  showButton?: boolean;
  previewShareUrl?: string | null;
  strict?: boolean;
  toolbar?: boolean;
  publicationBusy?: boolean;
  menuPlacement?: boolean;
  environment?: AirAppSiteEnvironmentVO;
} = {}) => {
  let current = state;
  const read = vi.fn(async () => current);
  const readEnvironment = vi.fn(async () => environment);
  const deploy = vi.fn(async () => {
    current = {
      ...current,
      previewUrl: "/api/airapp-preview/node/",
      previewVersion: current.currentVersion,
      previewStale: false,
      previewShareUrl,
    };
    return { outcome: "ok", state: current };
  });
  const goLive = vi.fn(async () => {
    current = { ...current, publication: "live", isPublic: true, liveVersion: "v1" };
    return { outcome: "ok", state: current };
  });
  const unpublish = vi.fn(async () => {
    current = { ...current, publication: "not-live", isPublic: false };
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
      ...(environment
        ? {
            siteEnvironment: {
              queryOptions: () => ({
                queryKey: ["siteEnvironment", "node"],
                queryFn: readEnvironment,
              }),
            },
          }
        : {}),
      siteState: {
        queryOptions: () => ({ queryKey: ["site", "node"], queryFn: read }),
      },
      siteDeployPreview: { call: deploy },
      siteGoLive: { call: goLive },
      siteUnpublish: { call: unpublish },
      siteReleases: {
        queryOptions: () => ({
          queryKey: ["site-releases", "node"],
          queryFn: async () => ({
            available: true,
            status: "idle",
            versions: [],
            history: [],
            lastError: null,
          }),
        }),
      },
    },
  } as unknown as BusabaseQueryUtils;
  const fixture = (filesRevision?: string) => (
    <CoreI18nProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        <SubmitPermissionProvider permissionLevel={permission}>
          <DashboardVisitorProvider visitorKind={anonymous ? "anonymous" : "member"}>
            <AirAppEngineAvailabilityProvider
              engines={engines}
              notConfiguredEngines={notConfigured}
              planGate={planGate}
            >
              <AirAppPublishToSite
                filesRevision={filesRevision}
                nodeId="node"
                nodeName="Lead Engine"
                orpc={orpc}
                showButton={showButton}
                buttonWhenNeeded={toolbar}
                publicationBusy={publicationBusy}
                placement={menuPlacement ? "menu" : "toolbar"}
                renderButtons={
                  toolbar
                    ? (publish, _releases, publishMenuItem) => (
                        <>
                          {publish}
                          <SitesMenu publishMenuItem={publishMenuItem} />
                        </>
                      )
                    : undefined
                }
              >
                {(publishAction) =>
                  toolbar ? null : (
                    <NodeActionsMenu
                      extraActions={publishAction}
                      nodeId="node"
                      nodeName="Lead Engine"
                      nodeType="airapp"
                      orpc={orpc}
                    />
                  )
                }
              </AirAppPublishToSite>
            </AirAppEngineAvailabilityProvider>
          </DashboardVisitorProvider>
        </SubmitPermissionProvider>
      </QueryClientProvider>
    </CoreI18nProvider>
  );
  const view = render(fixture(), strict ? { wrapper: StrictMode } : undefined);
  return {
    updateFilesRevision: (revision: string) => view.rerender(fixture(revision)),
    read,
    readEnvironment,
    deploy,
    goLive,
    unpublish,
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
  fireEvent.click(screen.getByRole("menuitem", { name: airAppToolbarMessages[locale].publish }));
};

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  encodeQr.mockClear();
  vi.mocked(toast.success).mockClear();
});

describe("toolbar publication and unpublishing", () => {
  it("shows selected deployment names and unused saved items before preparing a preview", async () => {
    const environment: AirAppSiteEnvironmentVO = {
      available: true,
      sources: [{ id: "space-product", key: "PRODUCTNAME", kind: "variable" }],
      bindings: [
        {
          vaultItemId: "space-product",
          envName: "PUBLIC_NAME",
          sourceKey: "PRODUCTNAME",
          kind: "variable",
          status: "ready",
        },
      ],
      directValues: [
        {
          vaultItemId: "website-token",
          envName: "SERVICE_TOKEN",
          kind: "secret",
          hasValue: true,
          status: "ready",
        },
      ],
      unboundDirectValues: [
        {
          vaultItemId: "unbound-date",
          envName: "BLOG_DATE",
          kind: "variable",
          hasValue: true,
          status: "ready",
        },
      ],
    };
    const view = renderPublish({ environment });
    let resolveEnvironment: (value: AirAppSiteEnvironmentVO) => void = () => {
      throw new Error("Expected pending environment read");
    };
    view.readEnvironment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveEnvironment = resolve;
        }),
    );
    openPublish();
    const dialog = await screen.findByRole("dialog");
    const copy = coreMessagesByLocale.en.airapp.site.environment;
    await within(dialog).findByText(copy.loading);
    expect(view.deploy).not.toHaveBeenCalled();
    resolveEnvironment(environment);
    await within(dialog).findByText(copy.deploymentList);
    const list = dialog.querySelector<HTMLElement>("[data-airapp-site-deployment-list]");
    expect(list?.textContent).toContain(`SERVICE_TOKEN · ${copy.secret} · ${copy.directSource}`);
    expect(list?.textContent).toContain(
      `PUBLIC_NAME · ${copy.variable} · ${copy.spaceSource}: PRODUCTNAME`,
    );
    expect(list?.textContent).not.toContain("BLOG_DATE");
    const unbound = dialog.querySelector<HTMLElement>("[data-airapp-site-publish-unbound]");
    expect(unbound?.textContent).toContain("BLOG_DATE");
    expect(unbound?.textContent).toContain(copy.unboundTitle);
    const settings = within(dialog).getByRole<HTMLAnchorElement>("link", {
      name: `${copy.title} ↗`,
    });
    expect(settings.href).toContain("siteEnvironment=1");
    expect(settings.target).toBe("_blank");
    await waitFor(() => expect(view.deploy).toHaveBeenCalledTimes(1));
  });

  it("keeps a failed configuration read explicit and lets the user retry", async () => {
    const environment: AirAppSiteEnvironmentVO = {
      available: true,
      sources: [],
      bindings: [],
      directValues: [],
    };
    const view = renderPublish({ environment });
    view.readEnvironment.mockRejectedValueOnce(new Error("private-provider-details"));
    openPublish();
    const dialog = await screen.findByRole("dialog");
    const copy = coreMessagesByLocale.en.airapp.site.environment;
    await within(dialog).findByText(copy.loadFailed);
    expect(dialog.textContent).not.toContain("private-provider-details");
    fireEvent.click(within(dialog).getByRole("button", { name: copy.retry }));
    await within(dialog).findByText(copy.deploymentEmpty);
    expect(view.readEnvironment).toHaveBeenCalledTimes(2);
  });

  it.each([
    [stateOf(), "Publish"],
    [
      stateOf({ isPublic: true, liveVersion: "v0", publication: "live-with-changes" }),
      "Publish update",
    ],
    [stateOf({ isPublic: true, liveVersion: "v1", publication: "live" }), "Published"],
  ] as const)(
    "places the emphasized %s action only inside More and opens review by keyboard",
    async (state, label) => {
      renderPublish({ state, toolbar: true, showButton: true, menuPlacement: true });
      expect(screen.queryByRole("button", { name: label })).toBeNull();
      const more = screen.getByRole("button", { name: "Preview & publish" });
      fireEvent.keyDown(more, { key: "Enter" });
      const primary = await screen.findByRole("menuitem", { name: label });
      await waitFor(() => expect(primary).toHaveProperty("disabled", false));
      expect(primary.tagName).toBe("BUTTON");
      expect(primary.className).toContain("bg-primary");
      expect(primary.className).toContain("text-primary-foreground");
      expect(primary.className).toContain("focus:bg-primary/90");
      expect(primary.className).toContain("focus:text-primary-foreground");
      expect(primary.closest('[role="menu"]')).toBeTruthy();
      expect(document.querySelector("[data-airapp-publication-notice]")).toBeNull();
      primary.focus();
      fireEvent.keyDown(primary, { key: "Enter" });
      const dialog = await screen.findByRole("dialog");
      expect(screen.queryByRole("menu")).toBeNull();
      fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(more));
    },
  );

  it("opens the attached unpublish submenu by keyboard and returns focus to More after cancelling", async () => {
    const { unpublish } = renderPublish({
      state: stateOf({ isPublic: true, liveVersion: "v1", publication: "live" }),
      toolbar: true,
      showButton: true,
      menuPlacement: true,
    });
    const more = screen.getByRole("button", { name: "Preview & publish" });
    fireEvent.keyDown(more, { key: "Enter" });
    const arrow = await screen.findByRole("menuitem", { name: "Publication actions" });
    arrow.focus();
    fireEvent.keyDown(arrow, { key: "ArrowRight" });
    const child = await screen.findByRole("menuitem", { name: "Unpublish" });
    child.focus();
    fireEvent.keyDown(child, { key: "Enter" });
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(unpublish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(more));
    expect(unpublish).not.toHaveBeenCalled();
  });

  it("disables the fallback publication menu while the Site runner is preparing", () => {
    const { deploy, goLive, unpublish } = renderPublish({ publicationBusy: true });
    openMenu();
    const action = screen.getByRole("menuitem", { name: "Publish" });
    expect(action.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(action);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deploy).not.toHaveBeenCalled();
    expect(goLive).not.toHaveBeenCalled();
    expect(unpublish).not.toHaveBeenCalled();
  });
  it.each([
    [stateOf(), "Publish"],
    [
      stateOf({
        isPublic: true,
        liveVersion: "v0",
        publication: "live-with-changes",
        previewStale: true,
      }),
      "Publish update",
    ],
  ] as const)(
    "shows a primary text action for %s without publishing immediately",
    async (state, label) => {
      const { deploy, goLive } = renderPublish({ state, toolbar: true, showButton: true });
      const action = await screen.findByRole("button", { name: label });
      expect(action.className).toContain("bg-primary");
      expect(action.textContent).toBe(label);
      expect(action.querySelector("span")?.className).not.toContain("hidden");
      expect(Boolean(screen.queryByRole("button", { name: "Publication actions" }))).toBe(
        state.isPublic,
      );
      expect(deploy).not.toHaveBeenCalled();
      expect(goLive).not.toHaveBeenCalled();
      fireEvent.pointerDown(screen.getByRole("button", { name: "Preview & publish" }), {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
      expect(screen.queryByRole("menuitem", { name: label })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Unpublish" })).toBeNull();
      expect(document.querySelector("[data-airapp-publication-notice]")).toBeNull();
      expect(document.querySelector("[data-airapp-unpublished-changes]")).toBeNull();
      expect(
        screen.queryByText(
          /The latest AirApp changes are not live yet|This website preview is out of date/,
        ),
      ).toBeNull();
    },
  );

  it.each([
    ["zh-CN", "更新发布", "发布操作"],
    ["zh-TW", "更新發布", "發布操作"],
  ] as const)(
    "uses the compact update wording in %s without a publication notice",
    async (locale, label, actions) => {
      renderPublish({
        state: stateOf({
          isPublic: true,
          liveVersion: "v0",
          publication: "live-with-changes",
          previewStale: true,
        }),
        toolbar: true,
        showButton: true,
        locale,
      });
      const primary = await screen.findByRole("button", { name: label });
      expect(screen.getByRole("button", { name: actions }).parentElement).toBe(
        primary.closest("[data-airapp-publication-controls]"),
      );
      fireEvent.click(primary);
      await screen.findByRole("heading", { name: label });
      expect(within(screen.getByRole("dialog")).getByRole("button", { name: label })).toBeTruthy();
    },
  );

  it("keeps a synchronized site Published and confirms cancellation from its attached dropdown", async () => {
    const { unpublish } = renderPublish({
      state: stateOf({ isPublic: true, liveVersion: "v1", publication: "live" }),
      toolbar: true,
      showButton: true,
    });
    expect(await screen.findByRole("button", { name: "Published" })).toBeTruthy();
    const more = screen.getByRole("button", { name: "Publication actions" });
    const open = () =>
      fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: "mouse" });
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unpublish" }));
    const dialog = screen.getByRole("alertdialog", { name: "Unpublish this website?" });
    expect(dialog.textContent).toContain("Your files and private preview stay available");
    expect(unpublish).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(unpublish).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(more);
    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unpublish" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Unpublish" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(unpublish).toHaveBeenCalledExactlyOnceWith({ nodeId: "node" });
    expect(await screen.findByRole("button", { name: "Publish" })).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith("The website is unpublished.");
    expect(screen.queryByRole("button", { name: "Publication actions" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Publish" }));
  });

  it("keeps a failed unpublish recoverable and blocks repeated clicks while waiting", async () => {
    const { unpublish } = renderPublish({
      state: stateOf({ isPublic: true, liveVersion: "v1", publication: "live" }),
      toolbar: true,
      showButton: true,
    });
    unpublish.mockRejectedValueOnce(new Error("Could not take the site offline"));
    fireEvent.pointerDown(await screen.findByRole("button", { name: "Publication actions" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unpublish" }));
    const confirm = within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Unpublish",
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not take the site offline"),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await waitFor(() => expect(confirm).toHaveProperty("disabled", false));
    unpublish.mockImplementationOnce(() => new Promise(() => undefined));
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm).toHaveProperty("disabled", true));
    fireEvent.click(confirm);
    expect(unpublish).toHaveBeenCalledTimes(2);
    expect(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    ).toHaveProperty("disabled", true);
  });

  it("allows an existing site to be unpublished after a plan lock", async () => {
    renderPublish({
      state: stateOf({ engine: "locked", isPublic: true, liveVersion: "v1", publication: "live" }),
      engines: ["browser", "site"],
      planGate: { lockedEngines: ["site"], planLabel: "Pro" },
      toolbar: true,
      showButton: true,
    });
    expect(await screen.findByRole("button", { name: "Published" })).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Publication actions" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    expect(await screen.findByRole("menuitem", { name: "Unpublish" })).toBeTruthy();
  });
});

describe("publishing a running AirApp alongside its browser preview", () => {
  it("opens the latest preview automatically exactly once under StrictMode", async () => {
    const { deploy, goLive } = renderPublish({ strict: true });
    openPublish();
    await screen.findByTitle("Private website preview");
    expect(deploy).toHaveBeenCalledExactlyOnceWith({ nodeId: "node" });
    expect(goLive).not.toHaveBeenCalled();
    expect(document.querySelector("[data-airapp-published-summary]")).toBeNull();
  });

  it("waits for a fresh readiness check before preparing a cached available preview", async () => {
    const { read, deploy, queryClient } = renderPublish();
    queryClient.setQueryData(["site", "node"], stateOf());
    let finishRead!: (value: AirAppSiteStateVO) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    openPublish();
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(deploy).not.toHaveBeenCalled();
    finishRead(stateOf({ engine: "locked" }));
    await screen.findByText(coreMessagesByLocale.en.airapp.site.publish.paidPlanRequired);
    expect(deploy).not.toHaveBeenCalled();
  });

  it("keeps a failed automatic build recoverable without redeploying on every state refresh", async () => {
    const { deploy, queryClient } = renderPublish();
    deploy.mockRejectedValueOnce(new Error("Preview build failed"));
    openPublish();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Preview build failed");
    await queryClient.invalidateQueries({ queryKey: ["site", "node"] });
    expect(deploy).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Create website preview" }));
    await screen.findByTitle("Private website preview");
    expect(deploy).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks edited source as stale and rebuilds it for review before publishing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const { deploy, goLive, setState, updateFilesRevision } = renderPublish();
    openPublish();
    fireEvent.load(await screen.findByTitle("Private website preview"));
    const publish = screen.getByRole("button", { name: "Publish" });
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    setState(
      stateOf({
        previewUrl: "/api/airapp-preview/node/",
        previewVersion: "v1",
        currentVersion: "v2",
        previewStale: true,
      }),
    );
    updateFilesRevision("index.html:title-edited");
    await screen.findByText(coreMessagesByLocale.en.airapp.site.publish.previewStale);
    expect(publish).toHaveProperty("disabled", true);
    expect(deploy).toHaveBeenCalledOnce();
    expect(screen.getByTitle("Private website preview").getAttribute("src")).toContain(
      "version=v1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create website preview" }));
    const frame = await screen.findByTitle("Private website preview");
    expect(frame.getAttribute("src")).toContain("version=v2");
    expect(publish).toHaveProperty("disabled", true);
    fireEvent.load(frame);
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    expect(goLive).not.toHaveBeenCalled();
  });

  it("keeps a reviewed snapshot after an excluded file changes without reloading the iframe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const { read, deploy, updateFilesRevision } = renderPublish();
    openPublish();
    const frame = await screen.findByTitle("Private website preview");
    fireEvent.load(frame);
    const publish = screen.getByRole("button", { name: "Publish" });
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    let finishCheck!: (value: AirAppSiteStateVO) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCheck = resolve;
        }),
    );
    updateFilesRevision("README.md:updated");
    expect(publish).toHaveProperty("disabled", true);
    await waitFor(() => expect(finishCheck).toBeTypeOf("function"));
    finishCheck(stateOf({ previewUrl: "/api/airapp-preview/node/", previewVersion: "v1" }));
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    expect(screen.getByTitle("Private website preview")).toBe(frame);
    expect(deploy).toHaveBeenCalledOnce();
  });

  it("completes a pending HTTP review after an excluded edit once source comparison succeeds", async () => {
    let finishReview!: (value: { ok: boolean }) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            finishReview = resolve;
          }),
      ),
    );
    const { read, deploy, updateFilesRevision } = renderPublish();
    openPublish();
    const frame = await screen.findByTitle("Private website preview");
    fireEvent.load(frame);
    let finishCheck!: (value: AirAppSiteStateVO) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCheck = resolve;
        }),
    );
    updateFilesRevision("README.md:updated");
    await waitFor(() => expect(finishCheck).toBeTypeOf("function"));
    finishReview({ ok: true });
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(publish).toHaveProperty("disabled", true);
    finishCheck(stateOf({ previewUrl: "/api/airapp-preview/node/", previewVersion: "v1" }));
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    expect(screen.getByTitle("Private website preview")).toBe(frame);
    expect(deploy).toHaveBeenCalledOnce();
  });

  it("rechecks source edited during a build before accepting that preview for publication", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const { deploy, setState, updateFilesRevision } = renderPublish();
    let finishBuild!: (value: { outcome: string; state: AirAppSiteStateVO }) => void;
    deploy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishBuild = resolve;
        }),
    );
    openPublish();
    await waitFor(() => expect(deploy).toHaveBeenCalledOnce());
    setState(stateOf({ currentVersion: "v2" }));
    updateFilesRevision("index.html:title-edited-during-build");
    const built = stateOf({ previewUrl: "/api/airapp-preview/node/", previewVersion: "v1" });
    setState({ ...built, currentVersion: "v2", previewStale: true });
    finishBuild({ outcome: "ok", state: built });
    const frame = await screen.findByTitle("Private website preview");
    fireEvent.load(frame);
    await screen.findByText(coreMessagesByLocale.en.airapp.site.publish.previewStale);
    expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", true);
    expect(deploy).toHaveBeenCalledOnce();
  });

  it("ignores an old HTTP review completing after a rebuilt preview was reviewed", async () => {
    let finishOldReview!: (value: { ok: boolean }) => void;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishOldReview = resolve;
            }),
        )
        .mockResolvedValue({ ok: true }),
    );
    renderPublish();
    openPublish();
    fireEvent.load(await screen.findByTitle("Private website preview"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh website preview" }));
    const frame = await screen.findByTitle("Private website preview");
    fireEvent.load(frame);
    const publish = screen.getByRole("button", { name: "Publish" });
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    finishOldReview({ ok: false });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(publish).toHaveProperty("disabled", false);
  });

  it("keeps the primary action outside the scrolling preview and explains every readiness step", async () => {
    let finishCheck!: (value: { ok: boolean }) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            finishCheck = resolve;
          }),
      ),
    );
    const { goLive } = renderPublish();
    openPublish();
    await screen.findByTitle("Private website preview");
    const footer = document.querySelector("[data-airapp-publish-footer]") as HTMLElement;
    const scroller = document.querySelector("[data-airapp-publish-scroll]") as HTMLElement;
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(footer.contains(publish)).toBe(true);
    expect(scroller.contains(publish)).toBe(false);
    expect(screen.queryByRole("button", { name: "Create website preview" })).toBeNull();
    const iframe = await screen.findByTitle("Private website preview");
    expect(scroller.contains(iframe)).toBe(true);
    fireEvent.load(iframe);
    expect(footer.textContent).toContain(coreMessagesByLocale.en.airapp.site.publish.checking);
    expect(publish).toHaveProperty("disabled", true);
    finishCheck({ ok: true });
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    expect(footer.textContent).toContain(
      coreMessagesByLocale.en.airapp.site.publish.readyToPublish,
    );
    let finishPublish!: (value: { outcome: string; state: AirAppSiteStateVO }) => void;
    goLive.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPublish = resolve;
        }),
    );
    fireEvent.click(publish);
    await waitFor(() => expect(publish.getAttribute("aria-busy")).toBe("true"));
    expect(publish).toHaveProperty("disabled", true);
    expect(footer.textContent).toContain(coreMessagesByLocale.en.common.working);
    expect(toast.success).not.toHaveBeenCalled();
    expect(footer.textContent).not.toContain(
      coreMessagesByLocale.en.airapp.site.publish.readyToPublish,
    );
    finishPublish({
      outcome: "ok",
      state: stateOf({
        previewUrl: "/api/airapp-preview/node/",
        previewVersion: "v1",
        liveVersion: "v1",
        isPublic: true,
        publication: "live",
      }),
    });
    await waitFor(() =>
      expect(footer.textContent).toContain(coreMessagesByLocale.en.airapp.site.publish.alreadyLive),
    );
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      coreMessagesByLocale.en.airapp.site.goLiveDone,
    );
  });

  it.each(["en", "zh-CN"] as const)(
    "shows a localized success toast after publishing an update in %s",
    async (locale) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
      const state = stateOf({
        liveVersion: "v0",
        isPublic: true,
        publication: "live-with-changes",
      });
      const { deploy, goLive } = renderPublish({ state, locale, showButton: true });
      const copy = coreMessagesByLocale[locale].airapp.site;
      const action = await screen.findByRole("button", {
        name: airAppToolbarMessages[locale].publishUpdate,
      });
      deploy.mockResolvedValueOnce({
        outcome: "ok",
        state: { ...state, previewUrl: "/api/airapp-preview/node/", previewVersion: "v1" },
      });
      fireEvent.click(action);
      fireEvent.load(await screen.findByTitle(copy.publish.previewTitle));
      const publish = within(screen.getByRole("dialog")).getByRole("button", {
        name: airAppToolbarMessages[locale].publishUpdate,
      });
      await waitFor(() => expect(publish).toHaveProperty("disabled", false));
      expect(toast.success).not.toHaveBeenCalled();
      fireEvent.click(publish);
      await waitFor(() => expect(toast.success).toHaveBeenCalledExactlyOnceWith(copy.goLiveDone));
      expect(goLive).toHaveBeenCalledExactlyOnceWith({ nodeId: "node" });
    },
  );

  it("explains an already-live version instead of silently disabling Publish update", async () => {
    renderPublish({
      state: stateOf({
        isPublic: true,
        publication: "live",
        liveVersion: "v1",
        previewVersion: "v1",
      }),
      showButton: true,
    });
    const action = await screen.findByRole("button", { name: "Published" });
    await waitFor(() => expect(action).toHaveProperty("disabled", false));
    expect(action.textContent).toContain("Published");
    fireEvent.click(action);
    const footer = document.querySelector("[data-airapp-publish-footer]") as HTMLElement;
    await waitFor(() =>
      expect(footer.textContent).toContain(coreMessagesByLocale.en.airapp.site.publish.alreadyLive),
    );
    expect(screen.getByRole("button", { name: "Publish update" })).toHaveProperty("disabled", true);
    expect(screen.queryByText(coreMessagesByLocale.en.airapp.site.publish.previewHint)).toBeNull();
  });

  it("shares the private capability URL while the iframe and HTTP review keep the owner URL", async () => {
    const previewShareUrl =
      "https://workspace.busabase.com/api/airapp-preview/node/?__busabase_site_version=v1&__busabase_preview=bounded-share-link";
    const fetchPreview = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchPreview);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderPublish({ previewShareUrl });
    openPublish();
    await screen.findByTitle("Private website preview");
    const iframe = await screen.findByTitle("Private website preview");
    const ownerUrl = "/api/airapp-preview/node/?__busabase_site_version=v1";
    expect(iframe.getAttribute("src")).toBe(ownerUrl);
    const address = screen.getByRole("textbox", { name: "Preview link" }) as HTMLInputElement;
    expect(address.value).toBe(previewShareUrl);
    expect(address.value).not.toBe("https://lead-engine.sites.test");
    expect(screen.getByRole("button", { name: "Copy link" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Open preview in new window" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Preview on your phone" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.load(iframe);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy link" })).toHaveProperty("disabled", false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(previewShareUrl));
    fireEvent.click(screen.getByRole("button", { name: "Open preview in new window" }));
    expect(open).toHaveBeenCalledExactlyOnceWith(
      previewShareUrl,
      "_blank",
      "noopener,noreferrer,popup",
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview on your phone" }));
    await screen.findByRole("img");
    expect(encodeQr).toHaveBeenCalledExactlyOnceWith(previewShareUrl, expect.any(Object));
    expect(screen.queryByText(/Sign in with the same account/)).toBeNull();
    fireEvent.keyDown(await screen.findByRole("dialog", { name: "Preview on your phone" }), {
      key: "Escape",
    });
    fireEvent.load(iframe);
    await waitFor(() =>
      expect(fetchPreview).toHaveBeenCalledWith(
        ownerUrl,
        expect.objectContaining({ method: "HEAD", credentials: "same-origin" }),
      ),
    );
    expect(fetchPreview).not.toHaveBeenCalledWith(previewShareUrl, expect.anything());
  });

  it("can refresh an unavailable share URL and enables sharing only after the new owner preview is ready", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const previewShareUrl =
      "https://workspace.busabase.com/api/airapp-preview/node/?__busabase_site_version=v1&__busabase_preview=renewed-share-link";
    const { deploy, setState } = renderPublish({ previewShareUrl: null });
    openPublish();
    await screen.findByTitle("Private website preview");
    const iframe = await screen.findByTitle("Private website preview");
    expect(iframe.getAttribute("src")).toBe("/api/airapp-preview/node/?__busabase_site_version=v1");
    const address = screen.getByRole("textbox", { name: "Preview link" }) as HTMLInputElement;
    expect(address.value).toBe("");
    expect(screen.getByRole("button", { name: "Copy link" })).toHaveProperty("disabled", true);
    const refresh = screen.getByRole("button", { name: "Refresh website preview" });
    expect(refresh).toHaveProperty("disabled", false);
    const renewed = stateOf({
      previewUrl: "/api/airapp-preview/node/",
      previewVersion: "v1",
      previewShareUrl,
    });
    setState(renewed);
    deploy.mockResolvedValueOnce({ outcome: "ok", state: renewed });
    fireEvent.click(refresh);
    await waitFor(() => expect(address.value).toBe(previewShareUrl));
    expect(screen.getByRole("button", { name: "Copy link" })).toHaveProperty("disabled", true);
    fireEvent.load(screen.getByTitle("Private website preview"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy link" })).toHaveProperty("disabled", false),
    );
  });

  it("keeps publication on the primary button and leaves More for preview tools", async () => {
    renderPublish({
      showButton: true,
      toolbar: true,
      state: stateOf({ liveVersion: "v0", isPublic: true, publication: "live-with-changes" }),
    });
    const primary = await screen.findByRole("button", { name: "Publish update" });
    expect(screen.queryByRole("button", { name: "Deployments" })).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Preview & publish" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Publish update" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Unpublish" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(primary);
    await screen.findByRole("heading", { name: "Publish update" });
    expect(screen.queryByRole("menu")).toBeNull();
    await screen.findByTitle("Private website preview");
  });

  it("refreshes from the address bar without losing the control and waits for the new preview review", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const { deploy, goLive, setState } = renderPublish();
    openPublish();
    await screen.findByTitle("Private website preview");
    const firstFrame = await screen.findByTitle("Private website preview");
    fireEvent.load(firstFrame);
    const publish = screen.getByRole("button", { name: "Publish" });
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    fireEvent.click(screen.getByRole("radio", { name: "Mobile" }));
    let completeRefresh!: (value: { outcome: string; state: AirAppSiteStateVO }) => void;
    deploy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeRefresh = resolve;
        }),
    );
    const refresh = screen.getByRole("button", { name: "Refresh website preview" });
    const address = screen.getByRole("textbox", { name: "Preview link" }) as HTMLInputElement;
    expect(address.value).toContain("__busabase_site_version=v1");
    fireEvent.click(refresh);
    await waitFor(() => expect(refresh).toHaveProperty("disabled", true));
    expect(screen.getByRole("button", { name: "Refresh website preview" })).toBe(refresh);
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("button", { name: "Create website preview" })).toBeNull();
    expect(screen.queryByTitle("Private website preview")).toBeNull();
    expect(address.value).toContain("__busabase_site_version=v1");
    expect(publish).toHaveProperty("disabled", true);
    const next = stateOf({
      previewUrl: "/api/airapp-preview/node/",
      previewVersion: "v2",
      currentVersion: "v2",
    });
    setState(next);
    completeRefresh({ outcome: "ok", state: next });
    const nextFrame = await screen.findByTitle("Private website preview");
    expect(nextFrame).not.toBe(firstFrame);
    expect(nextFrame.getAttribute("src")).toContain("__busabase_site_version=v2");
    expect(address.value).toContain("__busabase_site_version=v2");
    expect(document.querySelector('[data-airapp-preview-viewport="mobile"]')).toBeTruthy();
    expect(publish).toHaveProperty("disabled", true);
    fireEvent.load(nextFrame);
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    expect(goLive).not.toHaveBeenCalled();
  });

  it("shows first publication directly in the topbar in Simplified Chinese", async () => {
    const { read } = renderPublish({ showButton: true, locale: "zh-CN" });
    const action = await screen.findByRole("button", { name: "发布" });
    await waitFor(() => expect(action).toHaveProperty("disabled", false));
    expect(screen.queryByRole("button", { name: "发布管理" })).toBeNull();
    expect(read).toHaveBeenCalled();
    fireEvent.click(action);
    await screen.findByRole("heading", { name: "发布" });
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "发布" })).toBeTruthy();
    await screen.findByTitle(coreMessagesByLocale["zh-CN"].airapp.site.publish.previewTitle);
  });

  it("offers Publish again for a previously published Site that is now offline", async () => {
    renderPublish({
      showButton: true,
      locale: "zh-CN",
      state: stateOf({ liveVersion: "v1", isPublic: false, publication: "not-live" }),
    });
    const action = await screen.findByRole("button", { name: "发布" });
    await waitFor(() => expect(action).toHaveProperty("disabled", false));
    expect(screen.queryByRole("button", { name: "发布更新" })).toBeNull();
    expect(screen.queryByRole("button", { name: "发布操作" })).toBeNull();
    fireEvent.click(action);
    await screen.findByRole("heading", { name: "发布" });
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "发布" })).toBeTruthy();
  });

  it("does not query or expose direct publication controls to a read-only visitor", () => {
    const { read } = renderPublish({ showButton: true, permission: "read" });
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deployments" })).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("checks publication state for menu actions and prepares a preview only after selection", async () => {
    const { read, deploy, goLive } = renderPublish();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Publish" })).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Publish" }));
    await screen.findByTitle("Private website preview");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(read).toHaveBeenCalledOnce();
    expect(deploy).toHaveBeenCalledOnce();
    expect(goLive).not.toHaveBeenCalled();
    expect(
      screen.getByText("Your browser preview keeps running while you prepare the website."),
    ).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
    openPublish();
    await screen.findByTitle("Private website preview");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps preparation visible on Free and closes before opening the existing upgrade flow", async () => {
    const onUpgrade = vi.fn();
    const { deploy, goLive } = renderPublish({
      state: stateOf({ engine: "locked", blockers: [{ code: "not-a-site-app" }] }),
      planGate: { lockedEngines: ["site"], planLabel: "Plus", onUpgrade },
    });
    openPublish();
    await screen.findByText("Public website publishing is included with Plus and above.");
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
    const { deploy, goLive, queryClient } = renderPublish();
    queryClient.setQueryData(["site-releases", "node"], { history: [] });
    openPublish();
    await screen.findByTitle("Private website preview");
    await waitFor(() => expect(deploy).toHaveBeenCalledExactlyOnceWith({ nodeId: "node" }));
    const iframe = await screen.findByTitle("Private website preview");
    expect(iframe.getAttribute("src")).toBe("/api/airapp-preview/node/?__busabase_site_version=v1");
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(publish).toHaveProperty("disabled", true);
    fireEvent.load(iframe);
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    expect(fetchPreview).toHaveBeenCalledWith(
      "/api/airapp-preview/node/?__busabase_site_version=v1",
      expect.objectContaining({ method: "HEAD", credentials: "same-origin", cache: "no-store" }),
    );
    expect(goLive).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(["site-releases", "node"])?.isInvalidated).toBe(false);
    fireEvent.click(publish);
    await waitFor(() => expect(goLive).toHaveBeenCalledOnce());
    expect(goLive).toHaveBeenCalledExactlyOnceWith({ nodeId: "node" });
    expect(queryClient.getQueryState(["site-releases", "node"])?.isInvalidated).toBe(true);
    expect(document.querySelector("[data-airapp-published-summary]")).toBeNull();
    expect(screen.queryByRole("link", { name: "https://lead-engine.sites.test" })).toBeNull();
    expect(publish).toHaveProperty("disabled", true);
  });

  it("publishes an environment-only update with a clear latest-Vault-values notice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const { goLive } = renderPublish({
      state: stateOf({
        publication: "live-with-changes",
        isPublic: true,
        previewUrl: "/api/airapp-preview/node/",
        previewVersion: "v1",
        liveVersion: "v1",
        previewEnvironmentStale: true,
        liveEnvironmentStale: true,
      }),
    });
    openPublish();
    const iframe = await screen.findByTitle("Private website preview");
    fireEvent.load(iframe);
    const publish = screen.getByRole("button", { name: "Publish update" });
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    expect(
      screen.getByText(coreMessagesByLocale.en.airapp.site.environment.latestOnPublish),
    ).toBeTruthy();
    expect(screen.queryByText(coreMessagesByLocale.en.airapp.site.publish.alreadyLive)).toBeNull();
    fireEvent.click(publish);
    await waitFor(() => expect(goLive).toHaveBeenCalledExactlyOnceWith({ nodeId: "node" }));
  });

  it("registers the current member's saved preview automatically", async () => {
    const { deploy, goLive } = renderPublish({
      state: stateOf({ previewUrl: "/api/airapp-preview/node/", previewVersion: "v1" }),
    });
    openPublish();
    await screen.findByTitle("Private website preview");
    expect(deploy).toHaveBeenCalledOnce();
    expect(goLive).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", true);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not enable Go live for a 404 preview document", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { goLive } = renderPublish();
    openPublish();
    await screen.findByTitle("Private website preview");
    fireEvent.load(await screen.findByTitle("Private website preview"));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      coreMessagesByLocale.en.airapp.site.publish.previewUnavailable,
    );
    expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", true);
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
    await screen.findByTitle("Private website preview");
    fireEvent.load(await screen.findByTitle("Private website preview"));
    const publish = screen.getByRole("button", { name: "Publish" });
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
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
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
    await screen.findByTitle("Private website preview");
    fireEvent.load(await screen.findByTitle("Private website preview"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      coreMessagesByLocale.en.airapp.site.publish.previewStale,
    );
    expect(
      screen.getAllByText(coreMessagesByLocale.en.airapp.site.publish.previewStale),
    ).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByTitle("Private website preview")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    const before = read.mock.calls.length;
    openPublish();
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
  });

  it("does not show a success toast when publishing fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const { goLive } = renderPublish();
    goLive.mockRejectedValueOnce(new Error("Publishing failed"));
    openPublish();
    fireEvent.load(await screen.findByTitle("Private website preview"));
    const publish = screen.getByRole("button", { name: "Publish" });
    await waitFor(() => expect(publish).toHaveProperty("disabled", false));
    fireEvent.click(publish);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Publishing failed");
    expect(toast.success).not.toHaveBeenCalled();
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
    await screen.findByTitle("Private website preview");
    expect(deploy).toHaveBeenCalledOnce();
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
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    if (!("anonymous" in overrides && overrides.anonymous)) openMenu();
    expect(screen.queryByRole("menuitem", { name: "Publish" })).toBeNull();
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
    expect(screen.getByText("Plus 及以上套餐支持公开发布网站。")).toBeTruthy();
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

describe("a Free space's website preview", () => {
  it("allows private preview while keeping public publishing behind upgrade", async () => {
    const onUpgrade = vi.fn();
    const shareUrl = "https://free-preview.busabase.app/?__busabase_preview=free-share";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { deploy, goLive } = renderPublish({
      state: stateOf({ publicationLock: { planLabel: "Plus" } }),
      previewShareUrl: shareUrl,
      planGate: {
        lockedEngines: ["remote"],
        sitePublishingLocked: true,
        planLabel: "Plus",
        onUpgrade,
      },
    });
    openPublish();
    await screen.findByTitle("Private website preview");
    expect(screen.getByText(/preview privately now/i)).toBeTruthy();
    await waitFor(() => expect(deploy).toHaveBeenCalledTimes(1));
    const iframe = await screen.findByTitle("Private website preview");
    expect(iframe.getAttribute("src")).toBe("/api/airapp-preview/node/?__busabase_site_version=v1");
    const copy = screen.getByRole("button", { name: "Copy link" });
    expect(copy).toHaveProperty("disabled", true);
    fireEvent.load(iframe);
    await waitFor(() => expect(copy).toHaveProperty("disabled", false));
    expect(screen.getByRole("textbox", { name: "Preview link" })).toHaveProperty("value", shareUrl);
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(shareUrl));
    fireEvent.click(screen.getByRole("button", { name: "Open preview in new window" }));
    expect(open).toHaveBeenCalledExactlyOnceWith(shareUrl, "_blank", "noopener,noreferrer,popup");
    expect(screen.queryByRole("button", { name: airAppToolbarMessages.en.publish })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: /upgrade to plus/i })
        .closest("[data-airapp-publish-footer]"),
    ).not.toBeNull();
    expect(goLive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /upgrade to plus/i }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });
});

describe("Space Vault deployment permission", () => {
  it("explains the lock without automatically preparing a preview or enabling publication", async () => {
    const { deploy, goLive } = renderPublish({
      state: stateOf({ environmentDeploymentLock: { reason: "SPACE_VAULT_MANAGE_REQUIRED" } }),
    });
    await openPublish();
    expect(await screen.findByText(/A workspace owner or admin/)).toBeTruthy();
    expect(deploy).not.toHaveBeenCalled();
    expect(goLive).not.toHaveBeenCalled();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Create website preview" }).disabled,
    ).toBe(true);
    const footer = document.querySelector("[data-airapp-publish-footer]");
    if (!footer) throw new Error("Expected publication footer");
    expect(
      within(footer as HTMLElement).getByRole<HTMLButtonElement>("button", { name: /^Publish$/ })
        .disabled,
    ).toBe(true);
  });
  it("turns a generic forbidden preview response into permission guidance with no retry action", async () => {
    const { deploy } = renderPublish();
    deploy.mockRejectedValueOnce(
      new ORPCError("FORBIDDEN", { message: "private-permission-debug" }),
    );
    await openPublish();
    await screen.findByText(/You do not have permission to manage this website/);
    expect(document.body.textContent).not.toContain("private-permission-debug");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Create website preview" }).disabled,
    ).toBe(true);
    expect(deploy).toHaveBeenCalledTimes(1);
  });
  it("restores manual actions when the binding lock clears without deploying as a side effect of saving", async () => {
    const { deploy, queryClient, setState } = renderPublish({
      state: stateOf({ environmentDeploymentLock: { reason: "SPACE_VAULT_MANAGE_REQUIRED" } }),
    });
    await openPublish();
    await screen.findByText(/A workspace owner or admin/);
    setState(stateOf({ environmentDeploymentLock: null }));
    await queryClient.invalidateQueries({ queryKey: ["site", "node"] });
    const prepare = await screen.findByRole<HTMLButtonElement>("button", {
      name: "Create website preview",
    });
    await waitFor(() => expect(prepare.disabled).toBe(false));
    expect(deploy).not.toHaveBeenCalled();
    fireEvent.click(prepare);
    await screen.findByTitle("Private website preview");
    expect(deploy).toHaveBeenCalledTimes(1);
  });
});
