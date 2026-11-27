"use client";

import { useEffect, useRef, useState } from "react";
import { useContentNavigationHandler } from "../../dashboard/content-navigation-context";
import { useWorkbenchLinkResolver } from "../../dashboard/workbench-link-context";
import {
  buildHtmlPreviewDocument,
  resolveHtmlPreviewNavigation,
} from "../utils/html-preview-navigation";

interface HtmlPreviewFrameProps {
  source: string;
  title: string;
}

export function HtmlPreviewFrame({ source, title }: HtmlPreviewFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const resolveWorkbenchLink = useWorkbenchLinkResolver();
  const handleContentNavigation = useContentNavigationHandler();
  const [preview, setPreview] = useState<{ sessionId: string; document: string } | null>(null);

  useEffect(() => {
    const sessionId = crypto.randomUUID();
    let navigating = false;
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.origin !== "null" ||
        navigating ||
        !navigator.userActivation?.isActive
      )
        return;
      const navigation = resolveHtmlPreviewNavigation({
        data: event.data,
        sessionId,
        currentHref: window.location.href,
        resolveWorkbenchLink,
      });
      if (!navigation) return;
      if (handleContentNavigation?.(navigation.href)) return;
      if (navigation.inPlace) {
        navigating = true;
        window.location.assign(navigation.href);
      } else {
        window.open(navigation.href, "_blank", "noopener,noreferrer");
      }
    };
    window.addEventListener("message", onMessage);
    setPreview({
      sessionId,
      document: buildHtmlPreviewDocument(source, { parentHref: window.location.href, sessionId }),
    });
    return () => window.removeEventListener("message", onMessage);
  }, [source, resolveWorkbenchLink, handleContentNavigation]);

  if (!preview) return null;

  return (
    <iframe
      key={preview.sessionId}
      ref={frameRef}
      allowFullScreen
      className="block h-full w-full border-0 bg-card"
      sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts"
      srcDoc={preview.document}
      title={title}
    />
  );
}
