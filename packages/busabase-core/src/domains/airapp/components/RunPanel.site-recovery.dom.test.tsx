// @vitest-environment jsdom
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AirAppSiteActionVO,
  AirAppSiteBlocker,
} from "busabase-contract/domains/airapp/contract";
import type { AirAppVO } from "busabase-contract/types";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SubmitPermissionProvider } from "../../dashboard/components/split-submit-button";
import { useAirAppRunnerStore } from "../store/airapp-runner-store";
import { AirAppEngineAvailabilityProvider } from "./engine-availability-context";
import { AirAppRunPreview, useAirAppRunner } from "./RunPanel";

const NODE_ID = "site-recovery";
const missingSite: AirAppSiteBlocker = { code: "not-a-site-app" };
const missingEntry: AirAppSiteBlocker = { code: "entry-missing", path: "site-worker.js" };
const app = (revision: string): AirAppVO =>
  ({
    node: { id: NODE_ID, name: "Website", settings: { airappEngine: "site" } },
    files: [
      { path: "airapp.json", updatedAt: revision },
      { path: "index.html", updatedAt: "unchanged" },
    ],
  }) as unknown as AirAppVO;

const response = (blockers: AirAppSiteBlocker[] = [], version = "latest"): AirAppSiteActionVO => ({
  outcome: blockers.length ? "blocked" : "ok",
  state: {
    engine: "available",
    blockers,
    previewUrl: blockers.length ? null : `/api/airapp-preview/${NODE_ID}/`,
    previewVersion: blockers.length ? null : version,
    currentVersion: blockers.length ? null : version,
    liveVersion: null,
    isPublic: false,
    publication: "not-live",
    previewStale: false,
    previewDeployedAt: null,
    liveDeployedAt: null,
    address: null,
  },
});

const deploy = vi.fn<() => Promise<AirAppSiteActionVO>>();
const goLive = vi.fn();
const readState = vi.fn(async () => response().state);
const clients: QueryClient[] = [];
const readFile = vi.fn(async () => ({
  encoding: "utf8",
  content: JSON.stringify({ runtime: "node", preferredEngine: "site" }),
}));
const orpc = {
  fileTrees: { readFile: { call: readFile } },
  airapps: {
    siteDeployPreview: { call: deploy },
    siteGoLive: { call: goLive },
    siteState: {
      call: readState,
      queryOptions: ({ input }: { input: { nodeId: string } }) => ({
        queryKey: ["site-state", input.nodeId],
        queryFn: readState,
      }),
    },
  },
} as unknown as BusabaseQueryUtils;

function Surface({ airapp, showToolbar = false }: { airapp: AirAppVO; showToolbar?: boolean }) {
  const runner = useAirAppRunner({ orpc, airapp });
  return (
    <div>
      <button type="button" onClick={() => void runner.run()}>
        Run manually
      </button>
      <output data-testid="run-status">{runner.status}</output>
      <AirAppRunPreview airapp={airapp} runner={runner} showToolbar={showToolbar} />
    </div>
  );
}

function View({
  airapp,
  surfaces = 1,
  secondAirapp = airapp,
  showToolbar = false,
}: {
  airapp: AirAppVO;
  surfaces?: number;
  secondAirapp?: AirAppVO;
  showToolbar?: boolean;
}) {
  const [client] = useState(() => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(queryClient);
    return queryClient;
  });
  return (
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={client}>
        <AirAppEngineAvailabilityProvider engines={["browser", "site", "remote"]}>
          <Surface airapp={airapp} showToolbar={showToolbar} />
          {surfaces > 1 ? <Surface airapp={secondAirapp} /> : null}
        </AirAppEngineAvailabilityProvider>
      </QueryClientProvider>
    </CoreI18nProvider>
  );
}

const waitForStatus = async (status: string) => {
  await vi.waitFor(() =>
    expect(
      screen.getAllByTestId("run-status").every((element) => element.textContent === status),
    ).toBe(true),
  );
};
const deferred = () => {
  let resolve!: (value: AirAppSiteActionVO) => void;
  const promise = new Promise<AirAppSiteActionVO>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(async () => {
  cleanup();
  useAirAppRunnerStore.getState().disposeEntry(NODE_ID);
  useAirAppRunnerStore.setState({ lastEffectiveKinds: {}, selectionsHydrated: true });
  await useAirAppRunnerStore.persist.rehydrate();
  deploy.mockReset().mockResolvedValue(response([missingSite]));
  goLive.mockReset();
  readState.mockReset().mockResolvedValue(response().state);
  readFile.mockReset().mockResolvedValue({
    encoding: "utf8",
    content: JSON.stringify({ runtime: "node", preferredEngine: "site" }),
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  useAirAppRunnerStore.getState().disposeEntry(NODE_ID);
});

describe("recovering an edited, blocked website preview", () => {
  it("recovers after a file edit, then leaves a healthy preview alone on further edits", async () => {
    const view = render(<View airapp={app("one")} />);
    await waitForStatus("error");
    expect(document.querySelector('[data-airapp-site-blocker="not-a-site-app"]')).toBeTruthy();
    deploy.mockResolvedValue(response());

    view.rerender(<View airapp={app("two")} />);
    await waitForStatus("ready");
    expect(document.querySelector("[data-airapp-site-blockers]")).toBeNull();
    expect(document.querySelector("iframe")?.getAttribute("src")).toContain("latest");
    expect(deploy).toHaveBeenCalledTimes(2);
    expect(goLive).not.toHaveBeenCalled();

    view.rerender(<View airapp={app("three")} />);
    await act(async () => {});
    expect(deploy).toHaveBeenCalledTimes(2);
  });

  it("refreshes unresolved blockers once and does not loop on rerender or remount", async () => {
    const view = render(<View airapp={app("one")} />);
    await waitForStatus("error");
    deploy.mockResolvedValue(response([missingEntry]));
    view.rerender(<View airapp={app("two")} />);
    await vi.waitFor(() =>
      expect(document.querySelector('[data-airapp-site-blocker="entry-missing"]')).toBeTruthy(),
    );
    expect(document.querySelector('[data-airapp-site-blocker="not-a-site-app"]')).toBeNull();
    expect(deploy).toHaveBeenCalledTimes(2);

    view.rerender(<View airapp={app("two")} />);
    view.unmount();
    render(<View airapp={app("two")} />);
    await act(async () => {});
    expect(deploy).toHaveBeenCalledTimes(2);
  });

  it("claims a changed blocked preview once when detail and side panel mount together", async () => {
    const view = render(<View airapp={app("one")} />);
    await waitForStatus("error");
    const pending = deferred();
    deploy.mockReturnValueOnce(pending.promise);
    view.rerender(<View airapp={app("two")} surfaces={2} />);
    await vi.waitFor(() => expect(deploy).toHaveBeenCalledTimes(2));
    expect(readFile).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(response()));
    await waitForStatus("ready");
    expect(deploy).toHaveBeenCalledTimes(2);
  });

  it.each(["blocked", "ready"])(
    "checks edits made while recovery is in flight after an older %s result",
    async (outcome) => {
      const view = render(<View airapp={app("one")} />);
      await waitForStatus("error");
      const pending = deferred();
      deploy.mockReturnValueOnce(pending.promise).mockResolvedValue(response([], "three"));
      view.rerender(<View airapp={app("two")} />);
      await vi.waitFor(() => expect(deploy).toHaveBeenCalledTimes(2));
      view.rerender(<View airapp={app("three")} />);
      await act(async () =>
        pending.resolve(outcome === "blocked" ? response([missingEntry]) : response([], "two")),
      );
      await waitForStatus("ready");
      await vi.waitFor(() => expect(deploy).toHaveBeenCalledTimes(3));
      expect(document.querySelector("iframe")?.getAttribute("src")).toContain("three");
    },
  );

  it("checks the latest files when an initial blocked result arrives after an edit", async () => {
    const pending = deferred();
    deploy.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
    const view = render(<View airapp={app("one")} />);
    await vi.waitFor(() => expect(deploy).toHaveBeenCalledTimes(1));
    view.rerender(<View airapp={app("two")} />);
    await act(async () => pending.resolve(response([missingSite])));
    await waitForStatus("ready");
    expect(deploy).toHaveBeenCalledTimes(2);
  });

  it("keeps real runtime errors visible instead of retrying them on edits", async () => {
    deploy.mockRejectedValue(new Error("Preview service unavailable"));
    const view = render(<View airapp={app("one")} />);
    await waitForStatus("error");
    view.rerender(<View airapp={app("two")} />);
    await act(async () => {});
    expect(screen.getByText("Preview service unavailable")).toBeTruthy();
    expect(deploy).toHaveBeenCalledTimes(1);
  });

  it("leaves manual restart available after automatic recovery fails with a runtime error", async () => {
    const view = render(<View airapp={app("one")} />);
    await waitForStatus("error");
    deploy.mockRejectedValue(new Error("Preview service unavailable"));
    view.rerender(<View airapp={app("two")} />);
    await vi.waitFor(() => expect(screen.getByText("Preview service unavailable")).toBeTruthy());
    view.rerender(<View airapp={app("three")} />);
    await act(async () => {});
    expect(deploy).toHaveBeenCalledTimes(2);

    deploy.mockResolvedValue(response());
    fireEvent.click(screen.getByRole("button", { name: "Run manually" }));
    await waitForStatus("ready");
    expect(deploy).toHaveBeenCalledTimes(3);
  });

  it("does not alternate rejected revisions when the side panel has an older listing", async () => {
    const view = render(<View airapp={app("one")} />);
    await waitForStatus("error");
    deploy.mockResolvedValue(response([missingEntry]));
    let expectedCalls = 1;
    for (const revision of ["two", "three", "four"]) {
      // The first surface remains on its stale slug snapshot. The second
      // receives each new id-query result without requiring navigation.
      view.rerender(<View airapp={app("one")} surfaces={2} secondAirapp={app(revision)} />);
      expectedCalls += 1;
      await vi.waitFor(() => expect(deploy).toHaveBeenCalledTimes(expectedCalls));
      await waitForStatus("error");
      await act(async () => {});
      expect(deploy).toHaveBeenCalledTimes(expectedCalls);
    }
  });

  it("keeps a newer edit pending when an earlier stale surface observes recovery first", async () => {
    const view = render(<View airapp={app("one")} />);
    await waitForStatus("error");
    const pending = deferred();
    deploy.mockReturnValueOnce(pending.promise).mockResolvedValue(response([], "three"));
    view.rerender(<View airapp={app("one")} surfaces={2} secondAirapp={app("two")} />);
    await vi.waitFor(() => expect(deploy).toHaveBeenCalledTimes(2));
    view.rerender(<View airapp={app("one")} surfaces={2} secondAirapp={app("three")} />);
    await act(async () => pending.resolve(response([], "two")));
    await waitForStatus("ready");
    expect(deploy).toHaveBeenCalledTimes(3);
    expect(document.querySelector("iframe")?.getAttribute("src")).toContain("three");
    view.rerender(<View airapp={app("one")} surfaces={2} secondAirapp={app("four")} />);
    await act(async () => {});
    expect(deploy).toHaveBeenCalledTimes(3);
  });

  it("does not follow an edited manifest into a paid engine or publish the site", async () => {
    const view = render(<View airapp={app("one")} />);
    await waitForStatus("error");
    readFile.mockResolvedValue({
      encoding: "utf8",
      content: JSON.stringify({ runtime: "node", requiredEngine: "remote" }),
    });
    deploy.mockResolvedValue(response());
    view.rerender(<View airapp={app("two")} />);
    await waitForStatus("ready");
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(useAirAppRunnerStore.getState().entries[NODE_ID]?.runnerKind).toBe("site");
    expect(goLive).not.toHaveBeenCalled();
  });

  it("does not treat a reordered listing as an edit", async () => {
    const view = render(<View airapp={app("one")} />);
    await waitForStatus("error");
    const reordered = app("one");
    reordered.files.reverse();
    view.rerender(<View airapp={reordered} />);
    await act(async () => {});
    expect(deploy).toHaveBeenCalledTimes(1);
  });
});

describe("website access guidance", () => {
  it("keeps manual refresh on Site and coalesces clicks after the manifest changes", async () => {
    deploy.mockResolvedValue(response());
    render(
      <SubmitPermissionProvider permissionLevel="changeRequest">
        <View airapp={app("one")} showToolbar />
      </SubmitPermissionProvider>,
    );
    await waitForStatus("ready");
    readFile.mockResolvedValue({
      encoding: "utf8",
      content: JSON.stringify({ runtime: "node", requiredEngine: "remote" }),
    });
    deploy.mockResolvedValue(response([missingSite]));

    const refresh = screen.getByRole("button", { name: "Refresh page" });
    fireEvent.click(refresh);
    fireEvent.click(refresh);

    await waitForStatus("error");
    expect(useAirAppRunnerStore.getState().entries[NODE_ID]?.runnerKind).toBe("site");
    expect(document.querySelector('[data-airapp-site-blocker="not-a-site-app"]')).toBeTruthy();
    expect(deploy).toHaveBeenCalledTimes(2);
    expect(goLive).not.toHaveBeenCalled();
  });
  it("shows manager guidance when a locked preview needs deployment", async () => {
    readState.mockResolvedValue({
      ...response().state,
      previewStale: true,
      environmentDeploymentLock: { reason: "SPACE_VAULT_MANAGE_REQUIRED" },
    });
    const view = render(<View airapp={app("one")} />);
    await waitForStatus("error");
    expect(await screen.findByText(/A workspace owner or admin/)).toBeTruthy();
    expect(document.querySelector("[data-airapp-site-access-denied]")).toBeTruthy();
    expect(screen.queryByText("The app failed to start.")).toBeNull();
    expect(deploy).not.toHaveBeenCalled();
    view.rerender(<View airapp={app("two")} />);
    await act(async () => {});
    expect(deploy).not.toHaveBeenCalled();
    expect(readState).toHaveBeenCalledTimes(2);
  });
  it("lets a member retry after an owner prepares the locked preview", async () => {
    readState.mockResolvedValue({
      ...response().state,
      previewStale: true,
      environmentDeploymentLock: { reason: "SPACE_VAULT_MANAGE_REQUIRED" },
    });
    render(
      <SubmitPermissionProvider permissionLevel="changeRequest">
        <View airapp={app("one")} showToolbar />
      </SubmitPermissionProvider>,
    );
    await waitForStatus("error");
    expect(deploy).not.toHaveBeenCalled();

    readState.mockResolvedValue({
      ...response().state,
      environmentDeploymentLock: { reason: "SPACE_VAULT_MANAGE_REQUIRED" },
    });
    deploy.mockResolvedValue(response());
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));

    await waitForStatus("ready");
    expect(deploy).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-airapp-site-access-denied]")).toBeNull();
  });
  it("classifies a generic FORBIDDEN deployment race and preserves manual retries only for transient errors", async () => {
    deploy.mockRejectedValue(new ORPCError("FORBIDDEN", { message: "internal-permission-detail" }));
    const view = render(<View airapp={app("one")} />);
    await waitForStatus("error");
    expect(
      await screen.findByText(/You do not have permission to manage this website/),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("internal-permission-detail");
    view.rerender(<View airapp={app("two")} />);
    await act(async () => {});
    expect(deploy).toHaveBeenCalledTimes(1);
  });
});
