import { describe, expect, it } from "vitest";
import {
  getAppNavigationLayout,
  PERSISTENT_SIDEBAR_MIN_SHORT_EDGE,
  PERSISTENT_SIDEBAR_MIN_WIDTH,
} from "./responsive-layout";

describe("getAppNavigationLayout", () => {
  it("uses the temporary drawer below the regular-width breakpoint", () => {
    expect(getAppNavigationLayout(PERSISTENT_SIDEBAR_MIN_WIDTH - 1, 1024)).toEqual({
      persistentSidebar: false,
      sidebarWidth: 0,
    });
  });

  it("shows a persistent sidebar at the iPad portrait breakpoint", () => {
    expect(getAppNavigationLayout(744, 1133)).toEqual({
      persistentSidebar: true,
      sidebarWidth: 256,
    });
  });

  it("grows the sidebar within stable tablet constraints", () => {
    expect(getAppNavigationLayout(1024, 768)).toEqual({
      persistentSidebar: true,
      sidebarWidth: 287,
    });
    expect(getAppNavigationLayout(1366, 1024)).toEqual({
      persistentSidebar: true,
      sidebarWidth: 292,
    });
  });

  it("treats invalid widths as compact", () => {
    expect(getAppNavigationLayout(Number.NaN, 1024)).toEqual({
      persistentSidebar: false,
      sidebarWidth: 0,
    });
  });

  it("keeps wide phones and shallow windows in compact mode", () => {
    expect(getAppNavigationLayout(844, PERSISTENT_SIDEBAR_MIN_SHORT_EDGE - 1)).toEqual({
      persistentSidebar: false,
      sidebarWidth: 0,
    });
  });
});
