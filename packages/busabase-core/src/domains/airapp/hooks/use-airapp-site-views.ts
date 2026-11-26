"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppSiteStateVO } from "busabase-contract/domains/airapp/contract";
import type { AirAppVO } from "busabase-contract/types";
import { useEffect, useState } from "react";
import { useWorkspacePermissionLevel } from "../../dashboard/components/split-submit-button";
import { useIsAnonymousVisitor } from "../../dashboard/visitor-context";
import { absolutePreviewUrl } from "../components/AirAppPreviewTools";
import type { AirAppRunnerKind } from "../components/runners/types";
import type { AirAppRunStatus } from "../store/airapp-runner-store";
import { readSiteAccessDenial } from "../utils/site-access";
import { useAirAppPreviewState } from "./use-airapp-preview-state";

export type AirAppSiteView = "preview" | "deployed";
export type AirAppSitePanel = "content" | "files" | "logs";

/** The two destinations share controls, while each iframe keeps its own state. */
export function useAirAppSiteViews({
  orpc,
  airapp,
  kind,
  previewUrl,
  status,
}: {
  orpc: BusabaseQueryUtils;
  airapp: AirAppVO | null;
  kind: AirAppRunnerKind;
  previewUrl: string | null;
  status: AirAppRunStatus;
}) {
  const permission = useWorkspacePermissionLevel();
  const isAnonymous = useIsAnonymousVisitor();
  const nodeId = airapp?.node.id ?? null;
  const isSite = kind === "site" && Boolean(nodeId);
  // A node-specific write grant can authorize Site state even for a workspace
  // Viewer. Ask the node-write-gated server; workspace role alone cannot decide.
  const canReadState = isSite && !isAnonymous;
  const requiresFreshGrantCheck = !hasApiKeyLevel(permission, "write");
  const query = useQuery<AirAppSiteStateVO>({
    ...(canReadState && nodeId
      ? orpc.airapps.siteState.queryOptions({ input: { nodeId } })
      : { queryKey: ["airapp-site-views", nodeId, "disabled"], queryFn: skipToken }),
    enabled: canReadState,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: (query) => !readSiteAccessDenial(query.state.error),
    refetchOnReconnect: (query) => !readSiteAccessDenial(query.state.error),
    retry: false,
  });
  const state =
    canReadState && !query.isError && (!requiresFreshGrantCheck || query.isFetchedAfterMount)
      ? query.data
      : undefined;
  const deployedUrl =
    state?.isPublic && state.liveVersion && state.publication !== "not-live" && state.address
      ? absolutePreviewUrl(state.address, state.address)
      : null;
  const [selection, setSelection] = useState<{
    nodeId: string | null;
    view: AirAppSiteView;
    deployedUrl: string | null;
    panel: AirAppSitePanel;
  }>({ nodeId: null, view: "preview", deployedUrl: null, panel: "content" });
  const deployedVisited = Boolean(
    deployedUrl && selection.nodeId === nodeId && selection.deployedUrl === deployedUrl,
  );
  const view: AirAppSiteView =
    isSite && deployedVisited && selection.view === "deployed" ? "deployed" : "preview";
  useEffect(() => {
    if (!deployedUrl) {
      setSelection((previous) =>
        previous.deployedUrl
          ? { nodeId, view: "preview", deployedUrl: null, panel: "content" }
          : previous,
      );
    }
  }, [deployedUrl, nodeId]);
  const selectView = (next: AirAppSiteView) => {
    setSelection((previous) => ({
      nodeId,
      view: next === "deployed" && deployedUrl ? "deployed" : "preview",
      panel: "content",
      deployedUrl:
        next === "deployed" && deployedUrl
          ? deployedUrl
          : previous.nodeId === nodeId
            ? previous.deployedUrl
            : null,
    }));
  };
  const panel =
    selection.nodeId === nodeId && selection.view === view ? selection.panel : "content";
  const togglePanel = (next: "files" | "logs") => {
    if (next === "files" && view !== "preview") return;
    setSelection((previous) => ({
      nodeId,
      view,
      deployedUrl: previous.nodeId === nodeId ? previous.deployedUrl : null,
      panel: panel === next ? "content" : next,
    }));
  };
  const owner = absolutePreviewUrl(previewUrl, "https://preview.invalid");
  const ownerVersion = owner ? new URL(owner).searchParams.get("__busabase_site_version") : null;
  const sharedUrl =
    canReadState && previewUrl && ownerVersion && state?.previewVersion === ownerVersion
      ? state.previewShareUrl
      : null;
  const sharingPending =
    canReadState &&
    (status !== "ready" ||
      !state ||
      state.previewShareUrl === null ||
      (ownerVersion && state.previewVersion !== ownerVersion));
  const previewLink = sharingPending ? null : (sharedUrl ?? previewUrl);
  const preview = useAirAppPreviewState(previewUrl);
  const deployed = useAirAppPreviewState(deployedUrl);

  return {
    isSite,
    view,
    selectView,
    panel,
    togglePanel,
    deployedUrl,
    deployedVersion: state?.liveVersion ?? null,
    deployedVisited,
    preview,
    deployed,
    activePreview: view === "deployed" ? deployed : preview,
    activeFrameUrl: view === "deployed" ? deployedUrl : previewUrl,
    activeUrl: view === "deployed" ? deployedUrl : previewLink,
    activeShareable: view === "preview" && Boolean(sharedUrl),
  };
}

export type AirAppSiteViewsState = ReturnType<typeof useAirAppSiteViews>;
