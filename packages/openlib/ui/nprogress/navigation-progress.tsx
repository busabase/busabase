"use client";

import { Suspense } from "react";
import { NProgressProvider } from "./nprogress-provider";

/**
 * NavigationProgress
 *
 * The route-change progress bar, ready to drop into a layout. Render it as a
 * SIBLING of the page, never around it:
 *
 * ```tsx
 * <NavigationProgress />
 * {children}
 * ```
 *
 * `NProgressProvider` reads `useSearchParams()`, which bails a static page out
 * to client rendering up to the nearest Suspense boundary. The listener renders
 * nothing, so it gets a boundary of its own and the page stays outside it.
 * Wrapping the page instead broke two things:
 * - `<Suspense fallback={children}>` streamed every page twice (fallback plus
 *   the hidden resolved segment), so crawlers saw two `<h1>`s.
 * - `<Suspense>` streamed the page before `notFound()` could run, so every
 *   public 404 went out as HTTP 200.
 */
export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <NProgressProvider>{null}</NProgressProvider>
    </Suspense>
  );
}
