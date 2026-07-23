import { getNodeType } from "busabase-contract/domains";
import { useMemo } from "react";
import { useLocation, useRoute } from "wouter";

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
  const [isOperationRoute, operationParams] = useRoute("/inbox/:changeRequestId/:operationId");
  const [isChangeRequestRoute, changeRequestParams] = useRoute("/inbox/:changeRequestId");
  const [isBaseDesignRoute, baseDesignParams] = useRoute("/base/:slug/design");
  const [isLegacyBaseSetupRoute, legacyBaseSetupParams] = useRoute("/base/:slug/setup");
  const [isNewRecordRoute, newRecordParams] = useRoute("/base/:slug/new");
  const [isEditRecordRoute, editRecordParams] = useRoute("/base/:slug/:recordId/edit");
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
    baseParams?.slug ??
    baseChildParams?.slug ??
    null;
  const selectedSkillSlug = isSkillRoute ? (skillParams?.slug ?? null) : null;
  const selectedDriveSlug = isDriveRoute ? (driveParams?.slug ?? null) : null;
  const selectedAirappSlug = isAirappRoute ? (airappParams?.slug ?? null) : null;
  const selectedFileSlug = isFileRoute ? (fileParams?.slug ?? null) : null;
  const selectedDocSlug = isDocRoute ? (docParams?.slug ?? null) : null;
  const selectedFolderSlug = isFolderRoute ? (folderParams?.slug ?? null) : null;
  const nodeDetailRoute = useMemo(() => {
    const pathname = location.split("?", 1)[0] ?? "";
    const match = pathname.match(/^\/([^/]+)\/([^/]+)$/);
    if (!match) return null;
    const [, type, encodedSlug] = match;
    const definition = getNodeType(type);
    if (!definition?.capabilities.hasDetail || type === "base") return null;
    try {
      return { type, slug: decodeURIComponent(encodedSlug) };
    } catch {
      return { type, slug: encodedSlug };
    }
  }, [location]);
  const selectedChangeRequestId =
    operationParams?.changeRequestId ?? changeRequestParams?.changeRequestId ?? null;

  return {
    isArchivedRoute,
    isGraphRoute,
    isAssetDetailRoute,
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
    selectedChangeRequestId,
  };
}
