"use client";

import {
  type ComponentPropsWithoutRef,
  type ComponentPropsWithRef,
  forwardRef,
  type Key,
  type ReactElement,
  type ReactNode,
} from "react";
import { AIRAPP_PREVIEW_IFRAME_SANDBOX } from "../utils/preview-sandbox";

interface AirAppPreviewViewportProps
  extends Omit<ComponentPropsWithoutRef<"iframe">, "children" | "src" | "title"> {
  src?: string | null;
  title: string;
  /** The host keeps its own loading/error copy and lifecycle decisions. */
  fallback?: ReactNode;
  /** Optional desktop/mobile sizing frame; it exists only when the app is ready. */
  wrapFrame?: (frame: ReactElement<ComponentPropsWithRef<"iframe">>) => ReactNode;
  /** Only callers that intentionally reload a reviewed version need a key. */
  frameKey?: Key;
  /** Public websites can be embedded under COEP in a separate, ephemeral credential context. */
  credentialless?: boolean;
}

/**
 * The running application's viewport, shared by the workbench and public
 * readers. This component knows only presentation: runners, credentials and
 * data bridges stay with their hosts. Stable props keep the iframe DOM and its
 * in-memory app state intact when controls, viewport size or fullscreen change.
 */
export const AirAppPreviewViewport = forwardRef<HTMLIFrameElement, AirAppPreviewViewportProps>(
  function AirAppPreviewViewport(
    {
      src,
      title,
      fallback = null,
      wrapFrame,
      frameKey,
      credentialless = false,
      className = "h-full w-full border-0 bg-background",
      sandbox = AIRAPP_PREVIEW_IFRAME_SANDBOX,
      ...props
    },
    ref,
  ) {
    if (!src) return fallback;
    // The canonical HTML boolean value also works with Next's renderer, which
    // recognizes this attribute and treats an empty string as false.
    const frame = (
      <iframe
        {...props}
        {...(credentialless ? { credentialless: "credentialless" } : {})}
        className={className}
        key={frameKey}
        ref={ref}
        sandbox={sandbox}
        src={src}
        title={title}
      />
    );
    return wrapFrame ? wrapFrame(frame) : frame;
  },
);
