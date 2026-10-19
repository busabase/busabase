import { useCallback, useEffect, useRef } from "react";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  View,
} from "react-native";

/** How long after the drawer opens or the route changes the row is kept in view. */
const REVEAL_WINDOW_MS = 4000;
/** Room left above the row, so its header isn't flush with the edge. */
const REVEAL_MARGIN = 8;

/**
 * Keeps the drawer's active row on screen, the way the web sidebar does
 * (`NavMain`): for a few seconds after the drawer opens or the route changes,
 * whenever the tree's content moves, scroll the active row near the top if it
 * is not already fully visible.
 *
 * "Whenever the content moves" is the point: the tree arrives in pieces (root
 * + two levels, then each folder on the path as it loads), so the active row
 * often appears, or is pushed down, a moment after the drawer opens. Outside
 * the window nothing moves, so a person who scrolls away is left alone.
 */
export const useRevealActiveRow = (pathname: string) => {
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const activeRowRef = useRef<View | null>(null);
  const viewport = useRef({ top: 0, height: 0 });
  const revealUntil = useRef(0);

  const reveal = useCallback(() => {
    const row = activeRowRef.current;
    const content = contentRef.current;
    const scroll = scrollRef.current;
    if (!row || !content || !scroll || Date.now() > revealUntil.current) return;
    row.measureLayout(
      content,
      (_x, y, _width, height) => {
        const { top, height: visibleHeight } = viewport.current;
        if (visibleHeight === 0) return;
        if (y >= top && y + height <= top + visibleHeight) return;
        scroll.scrollTo({ y: Math.max(0, y - REVEAL_MARGIN), animated: false });
      },
      () => undefined,
    );
  }, []);

  const scheduleReveal = useCallback(() => {
    requestAnimationFrame(reveal);
  }, [reveal]);

  // The panel mounts when the drawer opens; a persistent sidebar stays mounted
  // and only sees the route change. Both start a window.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is the trigger (a route change opens a new window), not a value read in the body.
  useEffect(() => {
    revealUntil.current = Date.now() + REVEAL_WINDOW_MS;
    scheduleReveal();
  }, [pathname, scheduleReveal]);

  /** Callback ref for the active row (the tree passes it to that row only). */
  const setActiveRow = useCallback(
    (row: View | null) => {
      activeRowRef.current = row;
      if (row) scheduleReveal();
    },
    [scheduleReveal],
  );

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    viewport.current.top = event.nativeEvent.contentOffset.y;
  }, []);

  const onViewportLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewport.current.height = event.nativeEvent.layout.height;
      scheduleReveal();
    },
    [scheduleReveal],
  );

  return {
    scrollRef,
    contentRef,
    setActiveRow,
    onScroll,
    onViewportLayout,
    /** Content grew or shrank (a folder's children arrived): check again. */
    onContentLayout: scheduleReveal,
  };
};
