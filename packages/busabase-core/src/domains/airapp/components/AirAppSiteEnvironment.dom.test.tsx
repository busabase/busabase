// @vitest-environment jsdom
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AirAppSiteEnvironmentBinding,
  AirAppSiteEnvironmentVO,
  AirAppSiteStateVO,
} from "busabase-contract/domains/airapp/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesEn } from "../../../i18n/messages";
import { AirAppSiteEnvironmentSettings } from "./AirAppSiteControls";
import { AirAppSiteEnvironment } from "./AirAppSiteEnvironment";

const copy = coreMessagesEn.airapp.site.environment;
const sources: AirAppSiteEnvironmentVO["sources"] = [
  { id: "secret-1", key: "PAYMENT_TOKEN", kind: "secret" },
  { id: "variable-1", key: "PAYMENT_ORIGIN", kind: "variable" },
];
const emptyEnvironment = (): AirAppSiteEnvironmentVO => ({
  available: true,
  sources,
  bindings: [],
});
const state = (overrides: Partial<AirAppSiteStateVO> = {}): AirAppSiteStateVO => ({
  engine: "available",
  address: "https://shop.sites.test",
  publication: "live",
  isPublic: true,
  previewUrl: "/api/airapp-preview/node/",
  previewVersion: "v1",
  liveVersion: "v1",
  currentVersion: "v1",
  previewStale: false,
  previewDeployedAt: null,
  liveDeployedAt: null,
  blockers: [],
  ...overrides,
});
const clients: QueryClient[] = [];

function renderEditor({
  environment = emptyEnvironment(),
  site = state(),
  enabled = true,
  settings = false,
  loadError,
  siteLoadError,
  observeReleases = false,
}: {
  environment?: AirAppSiteEnvironmentVO;
  site?: AirAppSiteStateVO;
  enabled?: boolean;
  settings?: boolean;
  loadError?: Error;
  siteLoadError?: Error;
  observeReleases?: boolean;
} = {}) {
  let stored = environment;
  const read = vi.fn().mockImplementation(async () => stored);
  if (loadError) read.mockRejectedValueOnce(loadError);
  const readSite = vi.fn().mockImplementation(async () => site);
  if (siteLoadError) readSite.mockRejectedValueOnce(siteLoadError);
  const save = vi
    .fn()
    .mockImplementation(async ({ bindings }: { bindings: AirAppSiteEnvironmentBinding[] }) => {
      stored = {
        ...stored,
        bindings: bindings.map((binding) => {
          const source = sources.find((item) => item.id === binding.vaultItemId);
          if (!source) throw new Error("Unexpected test source");
          return { ...binding, sourceKey: source.key, kind: source.kind, status: "ready" };
        }),
      };
      return stored;
    });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(queryClient);
  const orpc = {
    airapps: {
      siteEnvironment: {
        queryOptions: () => ({ queryKey: ["siteEnvironment", "node"], queryFn: read }),
      },
      siteSaveEnvironment: { call: save },
      siteState: {
        queryOptions: () => ({ queryKey: ["siteState", "node"], queryFn: readSite }),
      },
      siteReleases: {
        queryOptions: () => ({
          queryKey: ["siteReleases", "node"],
          queryFn: async () => ({ canRollback: stored.bindings.length === 0 }),
        }),
      },
    },
  } as unknown as BusabaseQueryUtils;
  function ReleaseObserver() {
    const release = useQuery({
      queryKey: ["siteReleases", "node"],
      queryFn: async () => ({ canRollback: stored.bindings.length === 0 }),
      staleTime: Number.POSITIVE_INFINITY,
    });
    return (
      <output>
        {release.data?.canRollback
          ? "Historical rollback available"
          : "Historical rollback unavailable"}
      </output>
    );
  }
  const tree = (active: boolean) => (
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={queryClient}>
        {observeReleases ? <ReleaseObserver /> : null}
        {settings ? (
          <AirAppSiteEnvironmentSettings enabled={active} nodeId="node" orpc={orpc} />
        ) : (
          <AirAppSiteEnvironment enabled={active} nodeId="node" orpc={orpc} state={site} />
        )}
      </QueryClientProvider>
    </CoreI18nProvider>
  );
  const view = render(tree(enabled));
  return { ...view, read, readSite, save, queryClient, tree };
}

const addBinding = async (sourceId: string) => {
  fireEvent.click(await screen.findByRole("button", { name: copy.add }));
  const select = screen.getAllByRole("combobox", { name: copy.source }).at(-1);
  if (!select) throw new Error("A new row must offer a Vault source");
  fireEvent.change(select, { target: { value: sourceId } });
};

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

describe("Site Vault environment editor", () => {
  it("adds a reference, defaults its name, persists an alias, and restores it after reopening", async () => {
    const view = renderEditor();
    await addBinding("secret-1");
    const name = screen.getByRole("textbox", { name: copy.name }) as HTMLInputElement;
    expect(name.value).toBe("PAYMENT_TOKEN");
    fireEvent.change(name, { target: { value: "STRIPE_TOKEN" } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    await screen.findByText(copy.saved);
    expect(view.save).toHaveBeenCalledExactlyOnceWith({
      nodeId: "node",
      bindings: [{ envName: "STRIPE_TOKEN", vaultItemId: "secret-1" }],
    });
    view.rerender(view.tree(false));
    expect(document.querySelector("[data-airapp-site-environment]")).toBeNull();
    view.rerender(view.tree(true));
    expect(
      ((await screen.findByRole("textbox", { name: copy.name })) as HTMLInputElement).value,
    ).toBe("STRIPE_TOKEN");
    fireEvent.click(screen.getByRole("button", { name: copy.remove }));
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    await waitFor(() =>
      expect(view.save).toHaveBeenLastCalledWith({ nodeId: "node", bindings: [] }),
    );
    await screen.findByText(copy.empty);
  });

  it("announces only the node identity after a confirmed save and never publishes a failed draft", async () => {
    const postMessage = vi.fn();
    const close = vi.fn();
    const names: string[] = [];
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor(name: string) {
          names.push(name);
        }
        postMessage = postMessage;
        close = close;
      },
    );
    const view = renderEditor();
    view.save.mockRejectedValueOnce(new Error("save refused"));
    await addBinding("secret-1");
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    await screen.findByText(copy.saveFailed);
    expect(postMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    await screen.findByText(copy.saved);
    expect(names).toEqual(["busabase-vault", "busabase-site-environment"]);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      type: "site-environment-saved",
      nodeId: "node",
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps an alias when its source is replaced and shows only source metadata", async () => {
    const view = renderEditor();
    await addBinding("secret-1");
    fireEvent.change(screen.getByRole("textbox", { name: copy.name }), {
      target: { value: "BACKEND_SETTING" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: copy.source }), {
      target: { value: "variable-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    await screen.findByText(copy.saved);
    expect(view.save).toHaveBeenLastCalledWith({
      nodeId: "node",
      bindings: [{ envName: "BACKEND_SETTING", vaultItemId: "variable-1" }],
    });
    expect(screen.getByRole("option", { name: "PAYMENT_TOKEN · Secret" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "PAYMENT_ORIGIN · Variable" })).toBeTruthy();
    expect(document.querySelector("[data-airapp-site-environment-kind]")?.textContent).toBe(
      copy.variable,
    );
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.querySelectorAll("input")).toHaveLength(1);
  });

  it.each(["BUSABASE_API_KEY", "ASSETS", "1TOKEN", "TOKEN-NAME"])(
    "rejects an invalid or protected name: %s",
    async (name) => {
      const view = renderEditor();
      await addBinding("secret-1");
      fireEvent.change(screen.getByRole("textbox", { name: copy.name }), {
        target: { value: name },
      });
      expect((screen.getByRole("button", { name: copy.save }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(screen.getByText(copy.invalid)).toBeTruthy();
      expect(view.save).not.toHaveBeenCalled();
    },
  );

  it("rejects duplicate target names while allowing a Vault item to have distinct aliases", async () => {
    const view = renderEditor();
    await addBinding("secret-1");
    await addBinding("secret-1");
    expect((screen.getByRole("button", { name: copy.save }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getAllByRole("textbox", { name: copy.name })[1], {
      target: { value: "SECOND_TOKEN" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    await screen.findByText(copy.saved);
    expect(view.save).toHaveBeenCalledExactlyOnceWith({
      nodeId: "node",
      bindings: [
        { envName: "PAYMENT_TOKEN", vaultItemId: "secret-1" },
        { envName: "SECOND_TOKEN", vaultItemId: "secret-1" },
      ],
    });
  });

  it.each(["missing", "runtime-disabled"] as const)(
    "keeps a %s reference visible and lets the user remove it",
    async (status) => {
      const view = renderEditor({
        environment: {
          ...emptyEnvironment(),
          bindings: [
            {
              envName: "OLD_TOKEN",
              vaultItemId: "old-secret",
              sourceKey: "OLD_TOKEN",
              kind: "secret",
              status,
            },
          ],
        },
      });
      expect(
        await screen.findByText(status === "missing" ? copy.missing : copy.runtimeDisabled),
      ).toBeTruthy();
      expect((screen.getByRole("textbox", { name: copy.name }) as HTMLInputElement).value).toBe(
        "OLD_TOKEN",
      );
      fireEvent.click(screen.getByRole("button", { name: copy.remove }));
      fireEvent.click(screen.getByRole("button", { name: copy.save }));
      await waitFor(() =>
        expect(view.save).toHaveBeenCalledExactlyOnceWith({ nodeId: "node", bindings: [] }),
      );
    },
  );

  it("explains duplicate names after whitespace normalization", async () => {
    renderEditor();
    await addBinding("secret-1");
    await addBinding("variable-1");
    fireEvent.change(screen.getAllByRole("textbox", { name: copy.name })[1], {
      target: { value: " PAYMENT_TOKEN " },
    });
    expect((screen.getByRole("button", { name: copy.save }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(copy.invalid)).toBeTruthy();
  });

  it("retains the user's draft on save failure and permits retry", async () => {
    const view = renderEditor();
    view.save.mockRejectedValueOnce(new Error("provider-secret-sentinel"));
    await addBinding("secret-1");
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    await screen.findByText(copy.saveFailed);
    expect((screen.getByRole("textbox", { name: copy.name }) as HTMLInputElement).value).toBe(
      "PAYMENT_TOKEN",
    );
    expect(document.body.textContent).not.toContain("provider-secret-sentinel");
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    await screen.findByText(copy.saved);
    expect(view.save).toHaveBeenCalledTimes(2);
  });

  it("shows pending preview and live configuration without deploying anything", async () => {
    const view = renderEditor({
      site: state({ previewEnvironmentStale: true, liveEnvironmentStale: true }),
    });
    await screen.findByText(copy.pendingPreview);
    expect(screen.getByText(copy.pendingLive)).toBeTruthy();
    expect(screen.getByText(copy.latestOnPublish)).toBeTruthy();
    expect(view.save).not.toHaveBeenCalled();
  });

  it("recovers from a failed load without showing the raw error", async () => {
    const view = renderEditor({ loadError: new Error("secret-in-error-sentinel") });
    await screen.findByText(copy.loadFailed);
    expect(document.body.textContent).not.toContain("secret-in-error-sentinel");
    fireEvent.click(screen.getByRole("button", { name: copy.retry }));
    await screen.findByText(copy.empty);
    expect(view.read).toHaveBeenCalledTimes(2);
  });

  it("does not fetch an inactive settings panel", () => {
    const view = renderEditor({ enabled: false });
    expect(view.read).not.toHaveBeenCalled();
    expect(document.querySelector("[data-airapp-site-environment]")).toBeNull();
  });

  it("has an actionable empty state when the Vault has no eligible sources", async () => {
    renderEditor({ environment: { available: true, sources: [], bindings: [] } });
    await screen.findByText(copy.noSources);
    expect((screen.getByRole("button", { name: copy.add }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("allows a Free space to configure its private preview before public publishing is unlocked", async () => {
    renderEditor({
      settings: true,
      site: state({ publicationLock: { planLabel: "Plus" }, liveVersion: null, isPublic: false }),
    });
    await screen.findByRole("button", { name: copy.add });
    expect(document.querySelector("[data-airapp-site-public]")).toBeNull();
  });

  it("hides the editor on an unsupported host", async () => {
    const view = renderEditor({ environment: { available: false, sources: [], bindings: [] } });
    await waitFor(() => expect(view.read).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(document.querySelector("[data-airapp-site-environment]")).toBeNull(),
    );
  });
});

describe("Site environment access guidance", () => {
  it("recovers from a failed Site state read before loading the editor", async () => {
    const view = renderEditor({
      settings: true,
      siteLoadError: new Error("hidden-site-state-detail"),
    });
    await screen.findByText(copy.loadFailed);
    expect(document.body.textContent).not.toContain("hidden-site-state-detail");
    expect(view.read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: copy.retry }));
    await screen.findByRole("button", { name: copy.add });
    expect(view.readSite).toHaveBeenCalledTimes(2);
    expect(view.read).toHaveBeenCalledTimes(1);
  });

  it("explains a forbidden Site state read without offering a misleading retry", async () => {
    const view = renderEditor({
      settings: true,
      siteLoadError: new ORPCError("FORBIDDEN", { message: "hidden-site-denial-detail" }),
    });
    await screen.findByText(copy.forbidden);
    expect(screen.queryByText(copy.loadFailed)).toBeNull();
    expect(screen.queryByRole("button", { name: copy.retry })).toBeNull();
    expect(document.body.textContent).not.toContain("hidden-site-denial-detail");
    expect(view.readSite).toHaveBeenCalledTimes(1);
    expect(view.read).not.toHaveBeenCalled();
  });

  it("explains an unconfigured Site engine instead of opening an empty panel", async () => {
    const view = renderEditor({
      settings: true,
      site: state({ engine: "not-configured", address: null }),
    });
    await screen.findByText(coreMessagesEn.airapp.requiredEngineUnavailable.site);
    expect(document.querySelector("[data-airapp-site-environment]")).toBeNull();
    expect(view.read).not.toHaveBeenCalled();
  });

  it("keeps binding editing available while deployment needs a workspace manager", async () => {
    const view = renderEditor({
      site: state({ environmentDeploymentLock: { reason: "SPACE_VAULT_MANAGE_REQUIRED" } }),
    });
    await screen.findByText(copy.manageRequired);
    await addBinding("secret-1");
    const save = screen.getByRole<HTMLButtonElement>("button", { name: copy.save });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await screen.findByText(copy.saved);
    expect(view.save).toHaveBeenCalledTimes(1);
  });
  it("explains a stable forbidden read without a misleading retry control", async () => {
    const view = renderEditor({
      loadError: new ORPCError("FORBIDDEN", { message: "hidden-denial-detail" }),
    });
    await screen.findByText(copy.forbidden);
    expect(screen.queryByText(copy.loadFailed)).toBeNull();
    expect(screen.queryByRole("button", { name: copy.retry })).toBeNull();
    expect(document.body.textContent).not.toContain("hidden-denial-detail");
    expect(view.read).toHaveBeenCalledTimes(1);
  });
});

it("refreshes release permission after removing the final Space binding without reloading", async () => {
  renderEditor({
    observeReleases: true,
    environment: {
      ...emptyEnvironment(),
      bindings: [
        {
          envName: "SERVICE_TOKEN",
          vaultItemId: "secret-1",
          sourceKey: "PAYMENT_TOKEN",
          kind: "secret",
          status: "ready",
        },
      ],
    },
    site: state({ environmentDeploymentLock: { reason: "SPACE_VAULT_MANAGE_REQUIRED" } }),
  });
  await screen.findByText("Historical rollback unavailable");
  fireEvent.click(await screen.findByRole("button", { name: copy.remove }));
  fireEvent.click(screen.getByRole("button", { name: copy.save }));
  await screen.findByText(copy.saved);
  await screen.findByText("Historical rollback available");
});
