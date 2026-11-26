"use client";

import { useQuery } from "@tanstack/react-query";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { type ComponentProps, type ReactNode, useCallback, useMemo, useState } from "react";
import { type AroundNavHandler, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { BusabaseDashboard } from "../../dashboard";
import { BusabaseDashboardRouteRenderer } from "../../dashboard/components/dashboard-route-renderer";
import { getBusabaseDashboardRoutes } from "../../dashboard/routes";
import type { EmbedTargetNodeVO } from "../types";
import { embedNodeInitialPath, isEmbedNodeRoute } from "../utils/node-route";
import { EmbedContentNavigation } from "./embed-content-navigation";
import { EmbedSessionBoundary } from "./embed-session-boundary";

const EMPTY: never[] = [];

export interface PublicEmbedNodeHostProps {
  /** The node the link points at, resolved server-side under the link's capability. */
  node: EmbedTargetNodeVO;
  publicId: string;
  spaceId: string;
  /** The server-verified deadline, so an open page stops even while offline. */
  expiresAt: string;
}

export interface PublicEmbedNodeViewProps extends PublicEmbedNodeHostProps {
  apiBasePath?: string;
  /** Carries the link capability (and, on Cloud, the Space) on every RPC call. */
  apiClientOptions?: ComponentProps<typeof BusabaseDashboard>["apiClientOptions"];
  locale?: string;
  /**
   * The link secret, for asset URLs. An `<img>` cannot send the capability
   * header, so Doc images, readmes and downloads go through
   * `/embed/:publicId/assets/:assetId/raw?token=…` instead.
   */
  secret: string;
  /**
   * Optional wrapper around the detail pane — Cloud registers its file viewer
   * here (`FileViewerSlotProvider`) so a File previews the way it does in the
   * Cloud workbench.
   */
  wrapContent?: (content: ReactNode) => ReactNode;
}

/**
 * An Embed Link's page for an ordinary node (Base, Doc, File, Drive, Skill,
 * Folder) — the workbench's own Node Detail view, not a separate renderer.
 *
 * The page used to be a hand-written HTML document, which drifted from what
 * the node looked like in Busabase: a Base became a 50-row text table, a File
 * a list of properties, a Folder lost its readme. Now the embed is the same
 * component tree the workbench mounts, so it cannot drift:
 *
 * - The workbench in `chromeless` mode renders the node's detail pane and
 *   nothing around it — no sidebar, topbar, inbox or navigation into the Space.
 * - `visitorKind="embed"` keeps every space-wide query off and hides member
 *   affordances (the same session-less render a public share gets), while the
 *   server serves each call under the link's capability and
 *   `EMBED_READ_ALLOWLIST`, capped at `read`.
 * - A memory router pinned to the node: a Base can still switch views and open
 *   records, a Drive can still select files, but nothing navigates to another
 *   node or to an editor (`isEmbedNodeRoute`). The browser URL never changes.
 * - Its own QueryClient, so nothing is shared with any other cache on the page.
 */
export function PublicEmbedNodeView(props: PublicEmbedNodeViewProps) {
  // A new link gets its own lifetime and cache, even if a host reuses this component.
  return (
    <EmbedSessionBoundary {...props}>
      <PublicEmbedNodeContent {...props} />
    </EmbedSessionBoundary>
  );
}

function PublicEmbedNodeContent({
  apiBasePath = "/api/rpc",
  apiClientOptions,
  locale,
  node,
  publicId,
  spaceId,
  wrapContent = (content) => content,
}: PublicEmbedNodeViewProps) {
  const initialPath = embedNodeInitialPath(node);
  const [location] = useState(() => memoryLocation({ path: initialPath }));
  const stayOnNode = useCallback<AroundNavHandler>(
    (navigate, to, options) => {
      if (isEmbedNodeRoute(to, node)) navigate(to, options);
    },
    [node],
  );

  // A shared Base is seeded the way the public-share page seeds it: the
  // session-less workbench reads `activeBase` from its `bases` prop rather than
  // asking for the Space's Base list.
  // Cache keys are scoped to this link, never just the Space.
  const cacheKey = `${spaceId}:embed:${publicId}`;
  const orpc = useMemo(
    () => createBusabaseQueryUtils(apiBasePath, apiClientOptions ?? {}, cacheKey),
    [apiBasePath, apiClientOptions, cacheKey],
  );
  const baseQuery = useQuery({
    ...orpc.bases.get.queryOptions({ input: { baseId: node.slug } }),
    enabled: node.type === "base",
  });
  const bases = useMemo(() => (baseQuery.data ? [baseQuery.data] : EMPTY), [baseQuery.data]);

  const dashboard = useMemo(
    () => (
      <BusabaseDashboard
        apiBasePath={apiBasePath}
        apiClientOptions={apiClientOptions}
        auditEvents={EMPTY}
        bases={bases}
        cacheSpaceKey={cacheKey}
        changeRequests={EMPTY}
        chromeless
        embedded
        currentUserId={null}
        locale={locale}
        nodes={EMPTY}
        provideQueryClient={false}
        records={EMPTY}
        submitPermissionLevel="read"
        views={EMPTY}
        visitorKind="embed"
      />
    ),
    [apiBasePath, apiClientOptions, bases, cacheKey, locale],
  );
  const routes = useMemo(() => getBusabaseDashboardRoutes(dashboard), [dashboard]);

  return (
    <div
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background"
      data-embed-node-type={node.type}
      data-testid="embed-node-view"
    >
      <Router
        aroundNav={stayOnNode}
        hook={location.hook}
        searchHook={location.searchHook}
        ssrPath={initialPath}
      >
        <EmbedContentNavigation locale={locale} node={node}>
          {wrapContent(
            <BusabaseDashboardRouteRenderer
              NotFoundComponent={() => null}
              className="flex min-h-0 flex-1 flex-col"
              routes={routes}
            />,
          )}
        </EmbedContentNavigation>
      </Router>
    </div>
  );
}
