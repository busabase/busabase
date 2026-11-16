import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AirAppRunner } from "../src/domains/airapp/components/runners/types";
import {
  airAppSidePanelTabId,
  useAirAppKeepAliveStore,
} from "../src/domains/airapp/store/airapp-keepalive-store";
import { useAirAppRunnerStore } from "../src/domains/airapp/store/airapp-runner-store";
import { disposeDeletedAirAppSession } from "../src/domains/airapp/store/airapp-session-cleanup";
import { airAppSiteReleasesTabId } from "../src/domains/airapp/utils/site-release-panel";
import { useSidePanelStore } from "../src/domains/dashboard/store/side-panel-store";

describe("AirApp keepalive store", () => {
  beforeEach(() => {
    useAirAppKeepAliveStore.getState().reset();
    useAirAppRunnerStore.setState({ entries: {}, selectedKinds: {} });
    useSidePanelStore.setState({ activeTabId: null, isOpen: false, tabs: [] });
  });

  it("deduplicates a slug within one workspace scope", () => {
    const store = useAirAppKeepAliveStore.getState();

    store.register("space-a", "demo-airapp");
    store.register("space-a", "demo-airapp");

    expect(useAirAppKeepAliveStore.getState().scopes).toEqual({
      "space-a": ["demo-airapp"],
    });
  });

  it("releases only the requested workspace/actor scope for a shared slug", () => {
    const store = useAirAppKeepAliveStore.getState();

    store.register("space-a", "demo-airapp");
    store.register("space-b", "demo-airapp");
    store.register("space-b", "other-airapp");
    store.release("space-a", "demo-airapp");

    expect(useAirAppKeepAliveStore.getState().scopes).toEqual({
      "space-b": ["demo-airapp", "other-airapp"],
    });
  });

  it("releases a deleted slug from every workspace scope", () => {
    const store = useAirAppKeepAliveStore.getState();

    store.register("space-a", "deleted-airapp");
    store.register("space-a", "kept-airapp");
    store.register("space-b", "deleted-airapp");
    store.releaseSlug("deleted-airapp");

    expect(useAirAppKeepAliveStore.getState().scopes).toEqual({
      "space-a": ["kept-airapp"],
    });
  });

  it("does not publish a store update when a released slug is absent", () => {
    const store = useAirAppKeepAliveStore.getState();
    store.register("space-a:user-a", "kept-airapp");
    const scopesBeforeRelease = useAirAppKeepAliveStore.getState().scopes;

    store.releaseSlug("missing-airapp");

    expect(useAirAppKeepAliveStore.getState().scopes).toBe(scopesBeforeRelease);
  });

  it("cleans up the deleted node runner, current scope, and pinned tab together", () => {
    const dispose = vi.fn();
    const runner: AirAppRunner = {
      dispose,
      install: vi.fn(),
      mount: vi.fn(),
      onLog: vi.fn(),
      onReady: vi.fn(),
      start: vi.fn(),
    };
    useAirAppRunnerStore.setState({
      entries: {
        "node-a": {
          error: null,
          logLines: [],
          previewUrl: "/preview/node-a",
          runner,
          runnerKind: "browser",
          status: "ready",
        },
      },
    });
    const keepAliveStore = useAirAppKeepAliveStore.getState();
    keepAliveStore.register("space-a:user-a", "shared-slug");
    keepAliveStore.register("space-b:user-b", "shared-slug");
    useSidePanelStore.getState().openTab({
      id: airAppSidePanelTabId("node-a"),
      payload: { nodeId: "node-a" },
      title: "AirApp A",
      type: "airapp-preview",
    });
    useSidePanelStore.getState().openTab({
      id: airAppSiteReleasesTabId("node-a"),
      payload: { nodeId: "node-a", nodeName: "AirApp A" },
      title: "AirApp A releases",
      type: "airapp-site-releases",
    });
    useSidePanelStore.getState().openTab({
      id: airAppSiteReleasesTabId("node-b"),
      payload: { nodeId: "node-b", nodeName: "AirApp B" },
      title: "AirApp B releases",
      type: "airapp-site-releases",
    });
    useSidePanelStore.getState().openTab({
      id: "agent-research",
      payload: { agentSlug: "research" },
      title: "Research",
      type: "agent-chat",
    });

    disposeDeletedAirAppSession({
      keepAliveScopeKey: "space-a:user-a",
      nodeId: "node-a",
      routeSlug: "shared-slug",
    });

    expect(dispose).toHaveBeenCalledOnce();
    expect(useAirAppRunnerStore.getState().entries).not.toHaveProperty("node-a");
    expect(useAirAppKeepAliveStore.getState().scopes).toEqual({
      "space-b:user-b": ["shared-slug"],
    });
    expect(useSidePanelStore.getState().tabs.map((tab) => tab.id)).toEqual([
      airAppSiteReleasesTabId("node-b"),
      "agent-research",
    ]);
  });
});
