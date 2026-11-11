// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AirAppSiteActionVO,
  AirAppSiteBlocker,
} from "busabase-contract/domains/airapp/contract";
import type { AirAppVO } from "busabase-contract/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
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
const readFile = vi.fn(async () => ({
  encoding: "utf8",
  content: JSON.stringify({ runtime: "node", preferredEngine: "site" }),
}));
const orpc = {
  fileTrees: { readFile: { call: readFile } },
  airapps: { siteDeployPreview: { call: deploy }, siteGoLive: { call: goLive } },
} as unknown as BusabaseQueryUtils;

function Surface({ airapp }: { airapp: AirAppVO }) {
  const runner = useAirAppRunner({ orpc, airapp });
  return (
    <>
      <button type="button" onClick={() => void runner.run()}>
        Run manually
      </button>
      <output data-testid="run-status">{runner.status}</output>
      <AirAppRunPreview airapp={airapp} runner={runner} showToolbar={false} />
    </>
  );
}

function View({
  airapp,
  surfaces = 1,
  secondAirapp = airapp,
}: {
  airapp: AirAppVO;
  surfaces?: number;
  secondAirapp?: AirAppVO;
}) {
  return (
    <CoreI18nProvider locale="en">
      <AirAppEngineAvailabilityProvider engines={["browser", "site", "remote"]}>
        <Surface airapp={airapp} />
        {surfaces > 1 ? <Surface airapp={secondAirapp} /> : null}
      </AirAppEngineAvailabilityProvider>
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
  readFile.mockReset().mockResolvedValue({
    encoding: "utf8",
    content: JSON.stringify({ runtime: "node", preferredEngine: "site" }),
  });
});
afterEach(() => {
  cleanup();
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
