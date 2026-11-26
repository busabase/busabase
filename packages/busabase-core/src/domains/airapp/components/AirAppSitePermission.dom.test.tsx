// @vitest-environment jsdom
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppSiteStateVO } from "busabase-contract/domains/airapp/contract";
import type { AirAppVO } from "busabase-contract/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesEn } from "../../../i18n/messages";
import { SubmitPermissionProvider } from "../../dashboard/components/split-submit-button";
import {
  AirAppSiteEnvironmentSettings,
  AirAppSiteSettings,
  canGoLive,
  goLiveNote,
} from "./AirAppSiteControls";
import { AirAppEngineAvailabilityProvider } from "./engine-availability-context";
import { AirAppRunControls, type AirAppRunnerState } from "./RunPanel";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./AirAppSiteDomains", () => ({ AirAppSiteDomains: () => null }));
vi.mock("./AirAppSiteEnvironment", () => ({
  AirAppSiteEnvironment: () => <p>Editable environment</p>,
}));
const clients: QueryClient[] = [];
const state = (isPublic = false, locked = true): AirAppSiteStateVO => ({
  engine: "available",
  address: "https://site.test",
  publication: isPublic ? "live" : "not-live",
  isPublic,
  previewUrl: "/api/airapp-preview/node/",
  previewVersion: "v1",
  liveVersion: "v1",
  currentVersion: "v1",
  previewStale: false,
  previewDeployedAt: null,
  liveDeployedAt: null,
  blockers: [],
  environmentDeploymentLock: locked ? { reason: "SPACE_VAULT_MANAGE_REQUIRED" } : null,
});
const mount = (initial = state()) => {
  let stored = initial;
  const republish = vi.fn(async () => ({ outcome: "ok", state: stored }));
  const unpublish = vi.fn(async () => {
    stored = { ...stored, isPublic: false };
    return { outcome: "ok", state: stored };
  });
  const orpc = {
    airapps: {
      siteState: {
        queryOptions: () => ({ queryKey: ["site", "node"], queryFn: async () => stored }),
      },
      siteRepublish: { call: republish },
      siteUnpublish: { call: unpublish },
    },
  } as unknown as BusabaseQueryUtils;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={client}>
        <>
          <AirAppSiteSettings nodeId="node" orpc={orpc} />
          <AirAppSiteEnvironmentSettings nodeId="node" orpc={orpc} />
        </>
      </QueryClientProvider>
    </CoreI18nProvider>,
  );
  return { republish, unpublish };
};
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

describe("website publishing permission controls", () => {
  it("requires a manager for publication while leaving direct-only sites unchanged", () => {
    expect(canGoLive({ ...state(), liveVersion: null })).toBe(false);
    expect(goLiveNote(coreMessagesEn, state())).toBe(
      coreMessagesEn.airapp.site.environment.manageRequired,
    );
    expect(canGoLive({ ...state(false, false), liveVersion: null })).toBe(true);
  });
  it("disables restoring a public site and explains the permission without blocking environment edits", async () => {
    const { republish } = mount();
    await screen.findByText(coreMessagesEn.airapp.site.environment.manageRequired);
    expect(screen.getByRole<HTMLButtonElement>("switch").disabled).toBe(true);
    expect(screen.getByText("Editable environment")).toBeTruthy();
    expect(republish).not.toHaveBeenCalled();
  });
  it("keeps taking a published site offline available to its ordinary writer", async () => {
    const { unpublish, republish } = mount(state(true));
    const toggle = await screen.findByRole<HTMLButtonElement>("switch");
    expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(unpublish).toHaveBeenCalledTimes(1));
    expect(republish).not.toHaveBeenCalled();
  });
  it("keeps direct-only restoration working and suppresses a second attempt after a permission race", async () => {
    const { republish } = mount(state(false, false));
    const toggle = await screen.findByRole<HTMLButtonElement>("switch");
    expect(toggle.disabled).toBe(false);
    republish.mockRejectedValueOnce(new ORPCError("FORBIDDEN"));
    fireEvent.click(toggle);
    await screen.findByText(coreMessagesEn.airapp.site.environment.forbidden);
    expect(toggle.disabled).toBe(true);
    expect(republish).toHaveBeenCalledTimes(1);
  });
  it("keeps Site retries manual before and after removing Space bindings clears the permission lock", async () => {
    const queryKey = ["site", "permission-node"];
    const read = vi.fn(async () => state());
    const orpc = {
      airapps: {
        siteState: { queryOptions: () => ({ queryKey, queryFn: read }) },
        siteDomains: {
          queryOptions: () => ({ queryKey: ["domains"], queryFn: async () => ({ bindings: [] }) }),
        },
      },
    } as unknown as BusabaseQueryUtils;
    const run = vi.fn();
    const runner = {
      status: "error",
      previewUrl: null,
      runnerKind: "site",
      logLines: [],
      error: "denied",
      errorCode: null,
      engineLock: null,
      siteBlockers: null,
      siteAccessDenied: "space-vault-manage",
      orpc,
      run,
      stop: vi.fn(),
      isBusy: false,
      isLive: false,
    } satisfies AirAppRunnerState;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const app = {
      node: { id: "permission-node", name: "Website" },
      files: [],
    } as unknown as AirAppVO;
    render(
      <CoreI18nProvider locale="en">
        <QueryClientProvider client={client}>
          <SubmitPermissionProvider permissionLevel="write">
            <AirAppEngineAvailabilityProvider engines={["site"]}>
              <AirAppRunControls
                airapp={app}
                fullscreenState={{ fullscreen: false, setFullscreen: vi.fn() }}
                runner={runner}
                showPinToSidePanel={false}
                showSitePublish={false}
              />
            </AirAppEngineAvailabilityProvider>
          </SubmitPermissionProvider>
        </QueryClientProvider>
      </CoreI18nProvider>,
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const retry = screen.getByRole<HTMLButtonElement>("button", {
      name: coreMessagesEn.airapp.runAgain,
    });
    expect(retry.disabled).toBe(false);
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(run).toHaveBeenCalledExactlyOnceWith({ sitePreview: true });
    client.setQueryData(queryKey, state(false, false));
    expect(run).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole("button", { name: coreMessagesEn.airapp.runAgain }));
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith({ sitePreview: true });
  });
});
