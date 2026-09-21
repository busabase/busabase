"use client";

import { type ComponentType, useEffect, useState } from "react";
import { DocContentSkeleton } from "../../dashboard/components/skeletons";
import type { DocEditorCrepeProps, DocOutlineItem } from "./doc-editor-crepe";

export type DocEditorProps = DocEditorCrepeProps;
export type { DocOutlineItem };

/**
 * Public entry point for the Doc node's Markdown editor. Defers loading the
 * actual Crepe/ProseMirror implementation to a client-only effect so its
 * module never evaluates during a server-rendered pass (see doc-editor-crepe.tsx).
 */
export function DocEditor(props: DocEditorProps) {
  const [Impl, setImpl] = useState<ComponentType<DocEditorProps> | null>(null);

  useEffect(() => {
    let disposed = false;
    import("./doc-editor-crepe").then((mod) => {
      if (!disposed) setImpl(() => mod.default);
    });
    return () => {
      disposed = true;
    };
  }, []);

  // Shimmer, not `null`, while the chunk is in flight: the doc's title is
  // already rendered above this, so an empty body here reads exactly like a
  // document that has no content (see DocContentSkeleton).
  if (!Impl) return <DocContentSkeleton className={props.className} />;
  return <Impl {...props} />;
}
