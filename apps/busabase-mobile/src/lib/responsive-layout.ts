export const PERSISTENT_SIDEBAR_MIN_WIDTH = 720;
export const PERSISTENT_SIDEBAR_MIN_SHORT_EDGE = 600;

const SIDEBAR_MIN_WIDTH = 256;
const SIDEBAR_MAX_WIDTH = 292;
const SIDEBAR_WIDTH_RATIO = 0.28;

export interface AppNavigationLayout {
  persistentSidebar: boolean;
  sidebarWidth: number;
}

/**
 * Mirrors a native horizontal size class using the current app window rather
 * than the physical device, so iPad Split View and Stage Manager can collapse
 * back to the compact drawer when the window becomes narrow.
 */
export const getAppNavigationLayout = (
  windowWidth: number,
  windowHeight: number,
): AppNavigationLayout => {
  const regularWidth = Number.isFinite(windowWidth) && windowWidth >= PERSISTENT_SIDEBAR_MIN_WIDTH;
  const regularShortEdge =
    Number.isFinite(windowHeight) &&
    Math.min(windowWidth, windowHeight) >= PERSISTENT_SIDEBAR_MIN_SHORT_EDGE;

  if (!regularWidth || !regularShortEdge) {
    return { persistentSidebar: false, sidebarWidth: 0 };
  }

  return {
    persistentSidebar: true,
    sidebarWidth: Math.min(
      SIDEBAR_MAX_WIDTH,
      Math.max(SIDEBAR_MIN_WIDTH, Math.round(windowWidth * SIDEBAR_WIDTH_RATIO)),
    ),
  };
};
