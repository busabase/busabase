import { useMemo } from "react";
import { useLocation, useRoute } from "wouter";
import { parseNodeActivityRoute, parseNodeDetailRoute } from "../utils/node-route";

/**
 * Parse the wouter route table for the dashboard SPA into a flat set of route
 * flags + params, plus the route-only derived slugs/ids. Selections that also
 * depend on loaded data (active base/record, selected view/change request) stay
 * in the orchestrator — this hook is pure routing.
 */
export function useDashboardRoutes() {
  const [location] = useLocation();
  const [isArchivedRoute] = useRoute("/archived");
  const [isGraphRoute] = useRoute("/graph");
  const [isAssetDetailRoute] = useRoute("/assets/:assetId");
  // `/agents/new` is checked as an exact string before this in the dispatcher,
  // so its match here (agentSlug === "new") is never rendered as a detail page.
  const [isAgentDetailRoute, agentDetailParams] = useRoute("/agents/:agentSlug");
  // Addressed by name, not by catalog id: an id is `<owner>/<repo>/<subdir>`
  // and its slashes cannot live in one path segment.
  const [isTemplateDetailRoute, templateDetailParams] = useRoute("/templates/:templateName");
  const [isOperationRoute, operationParams] = useRoute("/inbox/:changeRequestId/:operationId");
  const [isChangeRequestRoute, changeRequestParams] = useRoute("/inbox/:changeRequestId");
  const [isBaseDesignRoute, baseDesignParams] = useRoute("/base/:slug/design");
  const [isLegacyBaseSetupRoute, legacyBaseSetupParams] = useRoute("/base/:slug/setup");
  const [isNewRecordRoute, newRecordParams] = useRoute("/base/:slug/new");
  const [isEditRecordRoute, editRecordParams] = useRoute("/base/:slug/:recordId/edit");
  // A 4-segment path — can't be shadowed by (and doesn't need to be checked
  // before) the 3-segment `/base/:slug/:childId` match below.
  const [isRecordActivityRoute, recordActivityParams] = useRoute("/base/:slug/:recordId/activity");
  // Must be checked/used BEFORE `isBaseChildRoute` (`/base/:slug/:childId`)
  // below, so "activity" isn't misparsed as a viewId.
  const [isBaseActivityRoute, baseActivityParams] = useRoute("/base/:slug/activity");
  const [, baseParams] = useRoute("/base/:slug");
  const [isBaseChildRoute, baseChildParams] = useRoute("/base/:slug/:childId");
  const [isSkillRoute, skillParams] = useRoute("/skill/:slug");
  const [isDriveRoute, driveParams] = useRoute("/drive/:slug");
  const [isAirappRoute, airappParams] = useRoute("/airapp/:slug");
  const [isFileRoute, fileParams] = useRoute("/file/:slug");
  const [isDocRoute, docParams] = useRoute("/doc/:slug");
  const [isFolderRoute, folderParams] = useRoute("/folder/:slug");

  const isBaseSetupRoute = isBaseDesignRoute || isLegacyBaseSetupRoute;
  const selectedBaseSlug =
    baseDesignParams?.slug ??
    legacyBaseSetupParams?.slug ??
    newRecordParams?.slug ??
    editRecordParams?.slug ??
    recordActivityParams?.slug ??
    baseActivityParams?.slug ??
    baseParams?.slug ??
    baseChildParams?.slug ??
    null;
  const selectedSkillSlug = isSkillRoute ? (skillParams?.slug ?? null) : null;
  const selectedDriveSlug = isDriveRoute ? (driveParams?.slug ?? null) : null;
  const selectedAirappSlug = isAirappRoute ? (airappParams?.slug ?? null) : null;
  const selectedFileSlug = isFileRoute ? (fileParams?.slug ?? null) : null;
  const selectedDocSlug = isDocRoute ? (docParams?.slug ?? null) : null;
  const selectedFolderSlug = isFolderRoute ? (folderParams?.slug ?? null) : null;
  const nodeDetailRoute = useMemo(() => parseNodeDetailRoute(location), [location]);
  // Same shape, for `/{type}/:slug/activity`.
  const nodeActivityRoute = useMemo(() => parseNodeActivityRoute(location), [location]);
  const routeNodeRef = useMemo(
    () =>
      selectedBaseSlug
        ? ({ type: "base", slug: selectedBaseSlug } as const)
        : (nodeActivityRoute ?? nodeDetailRoute),
    [nodeActivityRoute, nodeDetailRoute, selectedBaseSlug],
  );
  const selectedChangeRequestId =
    operationParams?.changeRequestId ?? changeRequestParams?.changeRequestId ?? null;

  return {
    isArchivedRoute,
    isGraphRoute,
    isAssetDetailRoute,
    isAgentDetailRoute,
    agentDetailParams,
    isTemplateDetailRoute,
    templateDetailParams,
    isOperationRoute,
    operationParams,
    isChangeRequestRoute,
    changeRequestParams,
    isBaseDesignRoute,
    isLegacyBaseSetupRoute,
    isNewRecordRoute,
    newRecordParams,
    isEditRecordRoute,
    editRecordParams,
    isRecordActivityRoute,
    recordActivityParams,
    isBaseActivityRoute,
    baseActivityParams,
    baseParams,
    isBaseChildRoute,
    baseChildParams,
    isSkillRoute,
    isDriveRoute,
    isAirappRoute,
    isFileRoute,
    isDocRoute,
    isFolderRoute,
    isBaseSetupRoute,
    selectedBaseSlug,
    selectedSkillSlug,
    selectedDriveSlug,
    selectedAirappSlug,
    selectedFileSlug,
    selectedDocSlug,
    selectedFolderSlug,
    nodeDetailRoute,
    nodeActivityRoute,
    routeNodeRef,
    selectedChangeRequestId,
  };
}
