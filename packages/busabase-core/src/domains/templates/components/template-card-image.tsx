"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";

interface Props {
  src?: string;
  alt: string;
  comfortable: boolean;
}

export function TemplateCardImage({ src, alt, comfortable }: Props) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <Sparkles
        className={comfortable ? "size-8 text-muted-foreground" : "size-8 text-muted-foreground/40"}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="h-full w-full object-cover object-top"
      onError={() => setFailed(true)}
    />
  );
}
