"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";

interface Props {
  src: string;
  alt: string;
}

/** Keeps a broken remote catalog image from leaving an empty gallery tile. */
export function TemplateDetailImage({ src, alt }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className="flex aspect-[16/10] items-center justify-center bg-muted"
      >
        <ImageOff className="size-8 text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="aspect-[16/10] w-full object-cover object-top"
      onError={() => setFailed(true)}
    />
  );
}
