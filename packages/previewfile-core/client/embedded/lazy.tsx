"use client";

import dynamic from "next/dynamic";

/**
 * `EmbeddedFileViewer`, loaded the first time a file is opened, so the
 * viewers stay out of the host's main bundle. Same props; a spinner fills the
 * frame meanwhile.
 */
export const LazyEmbeddedFileViewer = dynamic(
  () => import("./index").then((mod) => mod.EmbeddedFileViewer),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full min-h-[320px] place-items-center" data-previewfile-loading="">
        <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
      </div>
    ),
  },
);
