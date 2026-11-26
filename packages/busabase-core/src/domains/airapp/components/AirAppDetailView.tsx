"use client";

import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { Files, MonitorPlay, Terminal } from "lucide-react";
import { useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { NodeActionsMenu } from "../../dashboard/components/node-actions-menu";
import { NodeAgentPromptsButton } from "../../dashboard/components/node-agent-prompts-button";
import {
  PREVIEW_DETAIL_TAB_LIST_CLASS,
  PREVIEW_DETAIL_TAB_TRIGGER_CLASS,
} from "../../dashboard/components/preview-fullscreen";
import { EmptyState } from "../../dashboard/components/primitives";
import { NodeDetailSkeleton } from "../../dashboard/components/skeletons";
import { asNodeDetail } from "../../dashboard/helpers/node-detail";
import { useRegisterTopbarNodeActions } from "../../dashboard/hooks/use-register-topbar-node-actions";
import { useRegisterTopbarNodeInfo } from "../../dashboard/hooks/use-register-topbar-node-info";
import { useReportLoadedNode } from "../../dashboard/hooks/use-report-loaded-node";
import type { NodeDetailProps } from "../../dashboard/node-detail-registry";
import { type AirAppSiteViewsState, useAirAppSiteViews } from "../hooks/use-airapp-site-views";
import { disposeDeletedAirAppSession } from "../store/airapp-session-cleanup";
import { AirAppFilesPanel } from "./AirAppFilesPanel";
import { useAirAppKeepAliveActive, useAirAppKeepAliveScope } from "./AirAppKeepAliveHost";
import { AirAppPublishToSite } from "./AirAppPublishToSite";
import {
  AirAppSiteContextActions,
  AirAppSiteModeSwitch,
  AirAppSiteToolbarActions,
} from "./AirAppSiteViews";
import {
  AirAppPinButton,
  AirAppRunControls,
  AirAppRunLogs,
  AirAppRunPreview,
  useAirAppFullscreen,
  useAirAppRunner,
} from "./RunPanel";

/** Keeps forceMount'd inactive tab panels out of the layout flow without
 *  unmounting them — unmounting the "App" tab would dispose the live Nodepod
 *  runner every time the user switched to Files or Logs. */
const TAB_CONTENT_CLASS =
  "mt-0 flex min-h-0 min-w-0 flex-1 flex-col data-[state=inactive]:hidden data-[state=inactive]:pointer-events-none";

/** Primary Site modes precede subordinate actions; other engines keep their view tabs. */
export function AirAppDetailViewSwitcher({ siteViews }: { siteViews?: AirAppSiteViewsState }) {
  const messages = useCoreI18n();
  if (siteViews?.isSite)
    return (
      <div className="flex shrink-0 items-center gap-1" data-airapp-view-switcher="">
        <AirAppSiteModeSwitch views={siteViews} />
        <AirAppSiteContextActions views={siteViews} />
      </div>
    );
  return (
    <div className="flex min-w-0 max-w-full items-center gap-1" data-airapp-view-switcher="">
      <TabsList className={PREVIEW_DETAIL_TAB_LIST_CLASS}>
        <TabsTrigger
          aria-label={messages.airapp.tabFiles}
          className={`${PREVIEW_DETAIL_TAB_TRIGGER_CLASS} w-8 px-0 @min-[500px]/airapp-toolbar:w-auto @min-[500px]/airapp-toolbar:px-2.5`}
          value="files"
        >
          <Files className="size-3.5" />
          <span className="hidden @min-[500px]/airapp-toolbar:inline">
            {messages.airapp.tabFiles}
          </span>
        </TabsTrigger>
        <TabsTrigger
          aria-label={messages.airapp.tabPreview}
          className={`${PREVIEW_DETAIL_TAB_TRIGGER_CLASS} w-8 px-0 @min-[500px]/airapp-toolbar:w-auto @min-[500px]/airapp-toolbar:px-2.5`}
          value="app"
        >
          <MonitorPlay className="size-3.5" />
          <span className="hidden @min-[500px]/airapp-toolbar:inline">
            {messages.airapp.tabPreview}
          </span>
        </TabsTrigger>
        <TabsTrigger
          aria-label={messages.airapp.tabLogs}
          className={`${PREVIEW_DETAIL_TAB_TRIGGER_CLASS} w-8 px-0 @min-[500px]/airapp-toolbar:w-auto @min-[500px]/airapp-toolbar:px-2.5`}
          value="logs"
        >
          <Terminal className="size-3.5" />
          <span className="hidden @min-[500px]/airapp-toolbar:inline">
            {messages.airapp.tabLogs}
          </span>
        </TabsTrigger>
      </TabsList>
    </div>
  );
}

export { AirAppFileViewer } from "./AirAppFilesPanel";

/**
 * AirApp node detail: the shared topbar owns identity, Agent prompts, Pin and node settings;
 * Sites use a primary Preview/Deployed Site mode switch with contextual
 * Files/Logs actions; other engines retain Files/App/Logs tabs. The running
 * preview gets the remaining vertical space, and inactive frames stay mounted
 * so changing modes or opening source/logs preserves their app state.
 * "Files" is the file-tree browser with reviewable uploads. Non-Site "Logs"
 * is the streaming install/start console. HEAD-only: previewing a
 * pending (unmerged) ChangeRequest's file snapshot is out of scope for V1
 * (see the airapp changelog's Follow-up Tasks).
 */
export function AirAppDetailView({ orpc, slug, onNodeLoaded }: NodeDetailProps) {
  const messages = useCoreI18n();
  const keepAliveScopeKey = useAirAppKeepAliveScope();
  const isKeepAliveActive = useAirAppKeepAliveActive();
  const [selectedTab, setSelectedTab] = useState("app");
  const fullscreenState = useAirAppFullscreen({ syncWithUrl: isKeepAliveActive });

  const airappQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: slug ?? "", type: "airapp" } }),
    enabled: Boolean(slug),
  });
  // `nodes.get` is one route for every node type, so narrow to the AirApp branch.
  const airapp = asNodeDetail(airappQuery.isError ? undefined : airappQuery.data, "airapp");
  useReportLoadedNode(airapp?.node, onNodeLoaded);

  // Always called (before the early-return below) so hook order stays stable
  // across renders; the hook itself is a no-op while `airapp` is null.
  const runner = useAirAppRunner({ orpc, airapp });
  const siteViews = useAirAppSiteViews({
    orpc,
    airapp,
    kind: runner.runnerKind,
    previewUrl: runner.previewUrl,
    status: runner.status,
  });
  const previewState = siteViews.preview;

  // `enabled: isKeepAliveActive` matters here specifically because
  // `AirAppKeepAliveHost` keeps every visited AirApp's detail view mounted
  // (CSS-hidden) after the user navigates away, so a backgrounded instance
  // must stop re-registering its actions once it's no longer the visible
  // one, or it would keep clobbering whatever page the user is actually on.
  useRegisterTopbarNodeActions(
    airapp ? (
      <>
        <NodeAgentPromptsButton
          orpc={orpc}
          nodeId={airapp.node.id}
          nodeName={airapp.node.name}
          nodeType="airapp"
        />
        <AirAppPinButton airapp={airapp} />
        <NodeActionsMenu
          nodeId={airapp.node.id}
          nodeName={airapp.node.name}
          nodeSlug={airapp.node.slug}
          nodeType="airapp"
          onDeleted={() =>
            disposeDeletedAirAppSession({
              keepAliveScopeKey,
              nodeId: airapp.node.id,
              routeSlug: slug ?? airapp.node.slug,
            })
          }
          orpc={orpc}
        />
      </>
    ) : null,
    isKeepAliveActive,
  );
  useRegisterTopbarNodeInfo(
    airapp
      ? {
          description: airapp.node.description,
          nodeId: airapp.node.id,
          nodeName: airapp.node.name,
          nodeSlug: airapp.node.slug,
          nodeType: "airapp",
          orpc,
        }
      : null,
    isKeepAliveActive,
  );

  if (!airapp) {
    return airappQuery.isLoading ? (
      <NodeDetailSkeleton variant="skill" />
    ) : (
      <EmptyState
        title={messages.nodeDetail.airappNotFoundTitle}
        body={
          slug
            ? fmt(messages.nodeDetail.airappNotFoundBody, { slug })
            : messages.nodeDetail.selectAirappBody
        }
      />
    );
  }

  const selectedViewTab = siteViews.view === "deployed" ? "deployed" : "app";
  const activeTab = siteViews.isSite
    ? selectedViewTab
    : fullscreenState.fullscreen
      ? "app"
      : selectedTab;

  const content = (
    <>
      <header
        className={`flex min-h-12 min-w-0 shrink-0 items-center justify-between gap-1 border-border/60 border-b px-2 py-1 @min-[600px]/airapp-toolbar:px-4 ${siteViews.isSite ? "flex-nowrap" : "flex-wrap"}`}
        data-airapp-detail-toolbar=""
      >
        <AirAppDetailViewSwitcher siteViews={siteViews} />
        <AirAppPublishToSite
          buttonWhenNeeded
          compact
          filesRevision={airapp.files.map((file) => `${file.path}:${file.updatedAt}`).join("|")}
          key={airapp.node.id}
          nodeId={airapp.node.id}
          nodeName={airapp.node.name}
          orpc={orpc}
          publicationBusy={runner.runnerKind === "site" && runner.isBusy}
          placement="menu"
          renderButtons={(publishButton, _releases, publish) => {
            const controls = (
              <AirAppRunControls
                airapp={airapp}
                fullscreenState={fullscreenState}
                previewState={siteViews.isSite ? siteViews.activePreview : previewState}
                siteViews={siteViews}
                publishAction={publish}
                publishButton={publishButton}
                runner={runner}
                showPinToSidePanel={false}
                showSitePublish={false}
              />
            );
            return siteViews.isSite ? (
              <AirAppSiteToolbarActions views={siteViews} controls={controls} />
            ) : (
              controls
            );
          }}
          showButton
        />
      </header>

      <div
        className={
          activeTab === "app" || activeTab === "deployed"
            ? "flex min-h-0 min-w-0 flex-1 flex-col"
            : "hidden"
        }
      >
        <AirAppRunPreview
          airapp={airapp}
          fullscreenState={fullscreenState}
          runner={runner}
          previewState={previewState}
          siteViews={siteViews}
          tabbed={!siteViews.isSite}
          showToolbar={false}
        />
      </div>

      {!siteViews.isSite ? (
        <TabsContent className={TAB_CONTENT_CLASS} forceMount value="files">
          <AirAppFilesPanel airapp={airapp} orpc={orpc} />
        </TabsContent>
      ) : null}

      {!siteViews.isSite ? (
        <TabsContent className={TAB_CONTENT_CLASS} forceMount value="logs">
          <AirAppRunLogs runner={runner} />
        </TabsContent>
      ) : null}
    </>
  );
  return (
    <div className="@container/airapp-toolbar flex h-full min-h-0 w-full flex-col bg-background">
      {siteViews.isSite ? (
        <div className="flex min-h-0 flex-1 flex-col">{content}</div>
      ) : (
        <Tabs
          className="flex min-h-0 flex-1 flex-col"
          onValueChange={setSelectedTab}
          value={activeTab}
        >
          {content}
        </Tabs>
      )}
    </div>
  );
}
