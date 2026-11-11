"use client";

import { createContext, type ReactNode, useContext } from "react";

/**
 * How tall a viewer's root makes itself.
 *
 * - `viewport` (the default) is what the standalone PreviewFile page wants:
 *   the viewer IS the page, so it takes the whole viewport.
 * - `fill` is for a viewer embedded in a host's preview frame (Buda Drive,
 *   Busabase): take exactly the parent's height. A viewport-tall viewer in a
 *   shorter frame pushes whatever sits on its bottom edge — a spreadsheet's
 *   sheet tabs — below the frame, where it is clipped.
 */
export type ViewerLayout = "viewport" | "fill";

const ViewerLayoutContext = createContext<ViewerLayout>("viewport");

export function ViewerLayoutProvider({
  layout,
  children,
}: {
  layout: ViewerLayout;
  children: ReactNode;
}) {
  return <ViewerLayoutContext.Provider value={layout}>{children}</ViewerLayoutContext.Provider>;
}

export const useViewerLayout = (): ViewerLayout => useContext(ViewerLayoutContext);

// The class names are spelled out in full so Tailwind's source scanner sees them.

/** Root height for a viewer: the viewport standalone, the parent when embedded. */
export const useViewerHeightClass = (): "h-[100vh]" | "h-full" =>
  useViewerLayout() === "fill" ? "h-full" : "h-[100vh]";

/** Root minimum height, for viewers that grow past one screen. */
export const useViewerMinHeightClass = (): "min-h-[100vh]" | "min-h-full" =>
  useViewerLayout() === "fill" ? "min-h-full" : "min-h-[100vh]";
