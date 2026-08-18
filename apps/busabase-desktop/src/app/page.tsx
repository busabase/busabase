"use client";

import { useRef } from "react";
import { AutostartToggle } from "../components/autostart-toggle";
import { DesktopTitlebar } from "../components/desktop-titlebar";
import { DesktopUpdateControl } from "../components/desktop-update-control";
import { SidecarContent } from "../components/sidecar-content";
import { useBusabaseSidecar } from "../hooks/use-busabase-sidecar";
import { useDesktopUpdater } from "../hooks/use-desktop-updater";
import { useSidecarBridge } from "../hooks/use-sidecar-bridge";

export default function Page() {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sidecar = useBusabaseSidecar();
  const updater = useDesktopUpdater(sidecar.canUseTauriCommands);

  useSidecarBridge({
    appUrl: sidecar.appUrl,
    canUseTauriCommands: sidecar.canUseTauriCommands,
    frameRef,
  });

  return (
    <div className="desktop-window-frame">
      <DesktopTitlebar
        actions={
          <>
            <AutostartToggle />
            <DesktopUpdateControl
              message={updater.message}
              onInstall={updater.installUpdate}
              status={updater.status}
              version={updater.updateVersion}
              visible={updater.visible}
            />
          </>
        }
      />
      <div className="desktop-window-body">
        <SidecarContent
          appUrl={sidecar.appUrl}
          failed={sidecar.failed}
          frameRef={frameRef}
          message={sidecar.message}
          onRetry={sidecar.startSidecar}
        />
      </div>
    </div>
  );
}
