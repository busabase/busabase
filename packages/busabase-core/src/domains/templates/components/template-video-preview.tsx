"use client";

import { Dialog, DialogContent, DialogTitle } from "kui/dialog";
import { Play } from "lucide-react";
import { useState } from "react";
import { TemplateDetailImage } from "./template-detail-image";

interface TemplateVideoPreviewProps {
  src: string;
  /** The template's cover — `screenshots[0]`, which the catalog already has. */
  poster?: string;
  title: string;
  playLabel: string;
}

/**
 * A tile in the screenshot shelf: the cover with a play badge, opening the clip
 * in a modal.
 *
 * It sits in the shelf rather than in a band of its own above it. A full-width
 * block gave the clip more of the page than the whole gallery got, and it broke
 * the order the catalog's own publishing rules describe — cover, then clip,
 * then screenshots — by putting the clip ahead of the cover.
 *
 * Deliberately NOT an inline player. The element is mounted only while the
 * dialog is open and unmounted on close, which is also what stops playback; the
 * same shape the marketing hero uses.
 */
export function TemplateVideoPreview({ src, poster, title, playLabel }: TemplateVideoPreviewProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={playLabel}
        className="group relative block w-full overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {poster ? (
          <TemplateDetailImage src={poster} alt={title} />
        ) : (
          <div className="aspect-[16/10] w-full bg-muted" />
        )}
        <span className="absolute inset-0 bg-foreground/10 transition-colors group-hover:bg-foreground/20" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-background/90 shadow-lg transition-transform group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
            {/* Nudged right: a triangle centred on its bounding box reads as off-centre. */}
            <Play className="size-5 translate-x-0.5 fill-foreground text-foreground" />
          </span>
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl border-0 bg-black p-0">
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {/* 16:10, not 16:9 — every clip in the catalog is 1440x900 by
              standard, and a 16:9 shell pillarboxes all of them. */}
          <div className="aspect-[16/10] w-full">
            {open ? (
              <video
                // No <track>: these are silent screen recordings with no speech
                // to caption. The dialog title carries the accessible name.
                src={src}
                poster={poster}
                controls
                autoPlay
                loop
                // Silent by construction (encoded with `-an`), but muted anyway:
                // autoplay is blocked for audible media in every current browser.
                muted
                // Without this iOS takes the video fullscreen and drops the dialog.
                playsInline
                className="size-full"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
