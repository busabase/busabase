"use client";

import { type ComponentType, useEffect, useState } from "react";
import type { DocEditorCrepeProps } from "./doc-editor-crepe";

export type DocEditorProps = DocEditorCrepeProps;

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

  if (!Impl) return null;
  return <Impl {...props} />;
}
