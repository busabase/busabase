"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";

interface Props {
  src: string;
  alt: string;
  fit?: "cover" | "contain";
  rotation?: number;
  scale?: number;
}

export const isScreenshotQuarterTurn = (rotation: number): boolean =>
  Math.abs(rotation % 180) === 90;

/** Keeps a broken remote catalog image from leaving an empty gallery tile. */
export function TemplateDetailImage({ src, alt, fit = "cover", rotation = 0, scale = 1 }: Props) {
  const [failed, setFailed] = useState(false);
  const isPreview = fit === "contain";
  const isQuarterTurn = isScreenshotQuarterTurn(rotation);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={
          isPreview
            ? "flex h-full w-full items-center justify-center bg-muted"
            : "flex aspect-[16/10] items-center justify-center bg-muted"
        }
      >
        <ImageOff className="size-8 text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={isPreview ? "eager" : "lazy"}
      className={
        isPreview
          ? `${
              isQuarterTurn ? "max-h-[100cqw] max-w-[100cqh]" : "max-h-full max-w-full"
            } object-contain transition-transform duration-200 motion-reduce:transition-none`
          : "aspect-[16/10] w-full object-cover object-top"
      }
      style={isPreview ? { transform: `rotate(${rotation}deg) scale(${scale})` } : undefined}
      onError={() => setFailed(true)}
    />
  );
}
