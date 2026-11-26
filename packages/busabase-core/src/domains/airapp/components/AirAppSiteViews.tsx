"use client";

import { Button } from "kui/button";
import { ToggleGroup, ToggleGroupItem } from "kui/toggle-group";
import { Files, Globe, MonitorPlay, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { airAppToolbarMessages } from "../../../i18n/airapp-toolbar";
import type { AirAppSiteViewsState } from "../hooks/use-airapp-site-views";
import { AirAppSiteAddressBar } from "./AirAppSiteAddressBar";

/** The selected website mode is primary; Files and Logs are actions within it. */
export function AirAppSiteModeSwitch({ views }: { views: AirAppSiteViewsState }) {
  const copy = airAppToolbarMessages[useCoreLocale()];
  const itemClass =
    "h-7 min-w-8 w-8 gap-1.5 rounded-md px-0 text-foreground/80 text-xs hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm @min-[640px]/airapp-toolbar:w-auto @min-[640px]/airapp-toolbar:px-2.5";
  return (
    <ToggleGroup
      aria-label={copy.viewingMode}
      className="shrink-0 gap-0.5 rounded-lg bg-muted/60 p-0.5"
      data-airapp-site-mode-switch=""
      onValueChange={(value) => {
        if (value === "preview" || value === "deployed") views.selectView(value);
      }}
      orientation="horizontal"
      type="single"
      value={views.view}
    >
      <ToggleGroupItem
        aria-label={copy.menuShort}
        className={itemClass}
        onClick={() => views.selectView("preview")}
        title={copy.menuShort}
        type="button"
        value="preview"
      >
        <MonitorPlay aria-hidden="true" className="size-3.5" />
        <span className="hidden @min-[640px]/airapp-toolbar:inline">{copy.menuShort}</span>
      </ToggleGroupItem>
      {views.deployedUrl ? (
        <ToggleGroupItem
          aria-label={copy.deployedSite}
          className={itemClass}
          data-airapp-deployed-site=""
          onClick={() => views.selectView("deployed")}
          title={copy.deployedSite}
          type="button"
          value="deployed"
        >
          <Globe aria-hidden="true" className="size-3.5" />
          <span className="hidden @min-[640px]/airapp-toolbar:inline">{copy.deployedSite}</span>
        </ToggleGroupItem>
      ) : null}
    </ToggleGroup>
  );
}

/** Contextual Files and Logs are visually subordinate to the mode switch. */
export function AirAppSiteContextActions({ views }: { views: AirAppSiteViewsState }) {
  const messages = useCoreI18n();
  const copy = airAppToolbarMessages[useCoreLocale()];
  const actionClass =
    "h-8 w-8 shrink-0 gap-1.5 px-0 text-foreground/80 text-xs hover:text-foreground @min-[768px]/airapp-toolbar:w-auto @min-[768px]/airapp-toolbar:px-2.5";
  const logsLabel = views.view === "deployed" ? copy.onlineLogs : copy.browserLogs;
  return (
    <div className="flex shrink-0 items-center gap-1" data-airapp-site-context-actions="">
      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border/60" />
      {views.view === "preview" ? (
        <Button
          aria-label={messages.airapp.tabFiles}
          aria-pressed={views.panel === "files"}
          className={actionClass}
          data-airapp-site-files=""
          onClick={() => views.togglePanel("files")}
          size="sm"
          title={messages.airapp.tabFiles}
          variant={views.panel === "files" ? "secondary" : "ghost"}
        >
          <Files aria-hidden="true" className="size-3.5" />
          <span className="hidden @min-[768px]/airapp-toolbar:inline">
            {messages.airapp.tabFiles}
          </span>
        </Button>
      ) : null}
      <Button
        aria-label={logsLabel}
        aria-pressed={views.panel === "logs"}
        className={actionClass}
        data-airapp-site-log-action={views.view}
        onClick={() => views.togglePanel("logs")}
        size="sm"
        title={logsLabel}
        variant={views.panel === "logs" ? "secondary" : "ghost"}
      >
        <Terminal aria-hidden="true" className="size-3.5" />
        <span className="hidden @min-[768px]/airapp-toolbar:inline">{logsLabel}</span>
      </Button>
    </div>
  );
}

/** The live address and tertiary actions align to the right of the same toolbar. */
export function AirAppSiteToolbarActions({
  views,
  controls,
}: {
  views: AirAppSiteViewsState;
  controls: ReactNode;
}) {
  const copy = airAppToolbarMessages[useCoreLocale()];
  return (
    <div
      className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1"
      data-airapp-site-toolbar-actions=""
    >
      {views.view === "deployed" ? (
        <AirAppSiteAddressBar
          inline
          label={copy.deployedSite}
          refreshing={views.activePreview.refreshing}
          url={views.activeUrl}
        />
      ) : null}
      {controls}
    </div>
  );
}
