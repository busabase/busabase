"use client";

import { Button } from "kui/button";
import { type CSSProperties, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Page } from "react-pdf";
import { List, type ListImperativeAPI, type RowComponentProps } from "react-window";
import { useI18n } from "../i18n";
import { LoadingState } from "./LoadingState";
import {
  getPdfPageLayouts,
  getVisiblePdfPage,
  type PdfFitMode,
  type PdfPageGeometry,
  type PdfPageLayout,
} from "./pdf-continuous-layout";
import { type PdfDocument, usePdfPageGeometries } from "./use-pdf-page-geometries";

export interface PdfNavigation {
  page: number;
  request: number;
}

interface PdfContinuousPagesProps {
  fileName: string;
  document: PdfDocument;
  viewport: PdfPageGeometry;
  fitMode: PdfFitMode;
  manualScale: number;
  navigation: PdfNavigation;
  guardContent: boolean;
  onPageChange: (page: number) => void;
  onGeometryChange: (geometry: PdfPageGeometry & { pageNumber: number; scale: number }) => void;
}

interface PdfRowProps {
  layouts: readonly PdfPageLayout[];
  geometries: ReadonlyMap<number, PdfPageGeometry>;
  errors: ReadonlyMap<number, Error>;
  contentWidth: number;
  guardContent: boolean;
  retry: (page: number) => void;
}

const PdfPageRow = ({
  index,
  style,
  ariaAttributes,
  layouts,
  geometries,
  errors,
  contentWidth,
  guardContent,
  retry,
}: RowComponentProps<PdfRowProps>) => {
  const { LL } = useI18n();
  const [renderError, setRenderError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pageNumber = index + 1;
  const layout = layouts[index];
  if (!layout) return null;
  const failed = errors.has(pageNumber) || renderError;
  return (
    <div
      {...ariaAttributes}
      data-pdf-page-row={pageNumber}
      style={{ ...style, width: contentWidth }}
      className="flex justify-center"
    >
      <div
        data-pdf-page-surface={pageNumber}
        className={`relative shrink-0${guardContent ? " select-none" : ""}`}
        style={{ width: layout.width, height: layout.height }}
      >
        {failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-4 text-center">
            <p role="alert" className="text-sm text-destructive">
              {LL.preview.pdfLoadErrorTitle()}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRenderError(false);
                setAttempt((value) => value + 1);
                if (errors.has(pageNumber)) retry(pageNumber);
              }}
            >
              {LL.preview.tryAgain()}
            </Button>
          </div>
        ) : geometries.has(pageNumber) ? (
          <Page
            key={attempt}
            pageNumber={pageNumber}
            scale={layout.scale}
            renderTextLayer={!guardContent}
            renderAnnotationLayer={!guardContent}
            onLoadError={() => setRenderError(true)}
            onRenderError={() => setRenderError(true)}
            loading={<LoadingState message={LL.preview.loadingPdf()} />}
            className="shadow-lg"
          />
        ) : (
          <div className="h-full bg-background" aria-busy="true">
            <LoadingState message={LL.preview.loadingPdf()} />
          </div>
        )}
      </div>
    </div>
  );
};

interface ReadingAnchor {
  page: number;
  offsetRatio: number;
  left: number;
  atBottom: boolean;
}

export const PdfContinuousPages = ({
  fileName,
  document,
  viewport,
  fitMode,
  manualScale,
  navigation,
  guardContent,
  onPageChange,
  onGeometryChange,
}: PdfContinuousPagesProps) => {
  const { geometries, errors, prioritize, retry } = usePdfPageGeometries(document);
  const [list, setList] = useState<ListImperativeAPI | null>(null);
  const [measured, setMeasured] = useState({ width: 0, height: 0 });
  const [gap, setGap] = useState(12);
  const gapRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<ReadingAnchor>({ page: 1, offsetRatio: 0, left: 0, atBottom: false });
  const activePage = useRef(1);
  const appliedNavigation = useRef(-1);
  const size = {
    width: measured.width || viewport.width,
    height: measured.height || viewport.height,
  };
  const layouts = useMemo(
    () =>
      getPdfPageLayouts({
        count: document.numPages,
        geometries,
        viewport: { width: size.width, height: size.height },
        fitMode,
        manualScale,
        gap,
      }),
    [document.numPages, geometries, size.width, size.height, fitMode, manualScale, gap],
  );
  const contentWidth = layouts.reduce((width, page) => Math.max(width, page.width), size.width);
  const latest = useRef({ layouts, onPageChange, onGeometryChange, geometries });
  latest.current = { layouts, onPageChange, onGeometryChange, geometries };

  const rememberPosition = useCallback(() => {
    const element = list?.element;
    if (!element) return;
    const { layouts: pages, geometries: sizes, onPageChange, onGeometryChange } = latest.current;
    const page = getVisiblePdfPage(pages, element.scrollTop, element.clientHeight);
    const layout = pages[page - 1];
    if (!layout) return;
    if (page !== navigation.page) appliedNavigation.current = navigation.request;
    prioritize(page);
    anchor.current = {
      page,
      offsetRatio: (element.scrollTop - layout.top) / layout.height,
      left: element.scrollLeft,
      atBottom:
        page === pages.length &&
        element.scrollTop > 0 &&
        element.scrollTop + element.clientHeight >= layout.top + layout.height - 1,
    };
    if (activePage.current !== page) {
      activePage.current = page;
      onPageChange(page);
    }
    const geometry = sizes.get(page);
    if (geometry) onGeometryChange({ ...geometry, pageNumber: page, scale: layout.scale });
  }, [list, prioritize, navigation.page, navigation.request]);

  const handleScroll = useCallback(() => {
    rememberPosition();
  }, [rememberPosition]);

  useLayoutEffect(() => {
    const element = gapRef.current;
    if (!element) return;
    const measure = () => {
      const value = element.getBoundingClientRect().height;
      if (value > 0) setGap(value);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    prioritize(navigation.page);
  }, [navigation, prioritize]);

  useLayoutEffect(() => {
    const element = list?.element;
    if (!element || !size.width || !size.height) return;
    const pending = navigation;
    const requested = pending.request !== appliedNavigation.current;
    if (requested) {
      const target = layouts[pending.page - 1];
      if (!target) return;
      element.scrollTop = target.top;
      element.scrollLeft = 0;
      anchor.current = {
        page: pending.page,
        offsetRatio: 0,
        left: 0,
        atBottom:
          pending.page > 1 &&
          pending.page === document.numPages &&
          element.scrollTop + element.clientHeight >= target.top + target.height - 1,
      };
      activePage.current = pending.page;
      onPageChange(pending.page);
      if (geometries.has(pending.page)) {
        appliedNavigation.current = pending.request;
      }
    } else {
      const target = layouts[anchor.current.page - 1];
      if (target) {
        // Several small pages may share the final viewport. Keep its bottom,
        // rather than scaling a negative last-page offset during resize or zoom.
        const last = layouts.at(-1);
        element.scrollTop =
          anchor.current.atBottom && last
            ? Math.max(0, last.top + last.height - element.clientHeight)
            : target.top + target.height * anchor.current.offsetRatio;
        element.scrollLeft = anchor.current.left;
      }
    }
    const geometry = geometries.get(anchor.current.page);
    const layout = layouts[anchor.current.page - 1];
    if (geometry && layout) {
      onGeometryChange({
        ...geometry,
        pageNumber: anchor.current.page,
        scale: layout.scale,
      });
    }
  }, [
    layouts,
    navigation,
    list,
    size.width,
    size.height,
    geometries,
    document.numPages,
    onPageChange,
    onGeometryChange,
  ]);

  const rowHeight = useCallback(
    (index: number) => (layouts[index]?.height ?? 0) + (index < layouts.length - 1 ? gap : 0),
    [layouts, gap],
  );
  const rowProps = useMemo(
    () => ({ layouts, geometries, errors, contentWidth, guardContent, retry }),
    [layouts, geometries, errors, contentWidth, guardContent, retry],
  );

  return (
    <div className="relative h-full min-h-0" data-pdf-continuous="">
      <div
        ref={gapRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute"
        style={{ height: "calc(var(--spacing) * 3)" }}
      />
      <List
        data-pdf-continuous-viewport=""
        aria-label={fileName}
        listRef={setList}
        className="overflow-auto"
        style={
          {
            height: "100%",
            width: "100%",
            overflowAnchor: "none",
            overscrollBehavior: "contain",
          } satisfies CSSProperties
        }
        rowComponent={PdfPageRow}
        rowCount={document.numPages}
        rowHeight={rowHeight}
        rowProps={rowProps}
        overscanCount={2}
        onScroll={handleScroll}
        onResize={setMeasured}
      />
    </div>
  );
};
