"use client";

import { Button } from "kui/button";
import { RotateCcw } from "lucide-react";
import { FileFetchService } from "previewfile-core/client/file-fetch";
import { detectFileType } from "previewfile-core/utils/file-types";
import { useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { AssetMediaPreview } from "./assets";
import type { HostFileViewerFile } from "./file-viewer-slot";

/** Host-owned recovery keeps the selected viewer and workspace navigation in place. */
export function AttachmentViewer({ file }: { file: HostFileViewerFile }) {
  const messages = useCoreI18n();
  const [attempt, setAttempt] = useState(0);
  return (
    <div
      className="flex min-w-0 shrink-0 flex-col gap-2"
      data-previewfile-type={detectFileType({ fileName: file.name, mimeType: file.mimeType })}
    >
      <div className="flex shrink-0 justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            FileFetchService.getInstance().clearUrl(file.url);
            setAttempt((value) => value + 1);
          }}
          aria-label={messages.nodeDetail.filePreviewRetry}
        >
          <RotateCcw aria-hidden className="size-3.5" />
          {messages.nodeDetail.filePreviewRetry}
        </Button>
      </div>
      <div
        className="h-[55dvh] min-h-40 min-w-0 shrink-0 overflow-hidden rounded-md border bg-background"
        key={attempt}
      >
        <AssetMediaPreview
          viewerScope="attachment"
          mediaClassName="h-full max-h-full w-full object-contain"
          mimeType={file.mimeType}
          name={file.name}
          size={file.size}
          url={file.url}
        />
      </div>
    </div>
  );
}
