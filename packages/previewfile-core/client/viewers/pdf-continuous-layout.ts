export type PdfFitMode = "width" | "page" | "manual";

export interface PdfPageGeometry {
  width: number;
  height: number;
}

export interface PdfPageLayout extends PdfPageGeometry {
  top: number;
  scale: number;
}

interface PdfLayoutOptions {
  count: number;
  geometries: ReadonlyMap<number, PdfPageGeometry>;
  viewport: PdfPageGeometry;
  fitMode: PdfFitMode;
  manualScale: number;
  gap: number;
}

/** Page dimensions also size the unmounted rows in react-window. */
export const getPdfPageLayouts = ({
  count,
  geometries,
  viewport,
  fitMode,
  manualScale,
  gap,
}: PdfLayoutOptions): PdfPageLayout[] => {
  const estimate = geometries.get(1) ?? { width: 600, height: 850 };
  let top = 0;
  return Array.from({ length: count }, (_, index) => {
    const geometry = geometries.get(index + 1) ?? estimate;
    let scale = manualScale;
    if (fitMode !== "manual" && viewport.width > 0 && viewport.height > 0) {
      scale = viewport.width / geometry.width;
      if (fitMode === "page") scale = Math.min(scale, viewport.height / geometry.height);
    }
    const layout = {
      top,
      scale,
      width: geometry.width * scale,
      height: geometry.height * scale,
    };
    top += layout.height + (index < count - 1 ? gap : 0);
    return layout;
  });
};

/**
 * The page occupying the greatest visible height; ties favor the earlier page.
 * Scrolled to the bottom it is the last page, which can never reach the top of
 * the viewport when the final pages fit in it together. A document that does
 * not scroll at all keeps the first page.
 */
export const getVisiblePdfPage = (
  layouts: readonly PdfPageLayout[],
  scrollTop: number,
  viewportHeight: number,
): number => {
  const last = layouts.at(-1);
  if (last && scrollTop > 0 && scrollTop + viewportHeight >= last.top + last.height - 1) {
    return layouts.length;
  }
  let selected = 1;
  let greatestHeight = -1;
  for (const [index, page] of layouts.entries()) {
    if (page.top > scrollTop + viewportHeight) break;
    const visibleHeight = Math.max(
      0,
      Math.min(page.top + page.height, scrollTop + viewportHeight) - Math.max(page.top, scrollTop),
    );
    if (visibleHeight > greatestHeight) {
      selected = index + 1;
      greatestHeight = visibleHeight;
    }
  }
  return selected;
};
