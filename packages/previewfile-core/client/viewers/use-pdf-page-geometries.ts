"use client";

import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react";
import type { Document } from "react-pdf";
import type { PdfPageGeometry } from "./pdf-continuous-layout";

export type PdfDocument = Parameters<
  NonNullable<ComponentProps<typeof Document>["onLoadSuccess"]>
>[0];

/**
 * Two background readers, with explicit navigation moved to the front of the
 * queue. Measured sizes are committed at most once per animation frame, so a
 * long document re-lays out once per frame instead of once per page.
 */
export const usePdfPageGeometries = (document: PdfDocument) => {
  const [geometries, setGeometries] = useState<ReadonlyMap<number, PdfPageGeometry>>(new Map());
  const [errors, setErrors] = useState<ReadonlyMap<number, Error>>(new Map());
  const queue = useRef<(page: number, retry?: boolean) => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let active = 0;
    let next = 1;
    const priority: number[] = [];
    const pending = new Set<number>();
    const completed = new Set<number>();
    const measured = new Map<number, PdfPageGeometry>();
    let frame: number | null = null;
    setGeometries(new Map());
    setErrors(new Map());

    const takeNext = () => {
      while (priority.length) {
        const page = priority.shift();
        if (page !== undefined && !completed.has(page) && !pending.has(page)) return page;
      }
      while (next <= document.numPages) {
        const page = next++;
        if (!completed.has(page) && !pending.has(page)) return page;
      }
      return null;
    };

    const commit = () => {
      frame = null;
      if (disposed || measured.size === 0) return;
      const batch = [...measured];
      measured.clear();
      setGeometries((previous) => {
        const result = new Map(previous);
        for (const [pageNumber, geometry] of batch) result.set(pageNumber, geometry);
        return result;
      });
    };

    const read = async (pageNumber: number) => {
      try {
        const page = await document.getPage(pageNumber);
        if (disposed) return;
        const { width, height } = page.getViewport({ scale: 1 });
        if (!(width > 0 && height > 0)) throw new Error("Invalid PDF page dimensions");
        measured.set(pageNumber, { width, height });
        frame ??= requestAnimationFrame(commit);
      } catch (error) {
        if (!disposed) {
          setErrors((previous) =>
            new Map(previous).set(
              pageNumber,
              error instanceof Error ? error : new Error(String(error)),
            ),
          );
        }
      } finally {
        pending.delete(pageNumber);
        completed.add(pageNumber);
        active--;
        if (!disposed) pump();
      }
    };

    const pump = () => {
      while (!disposed && active < 2) {
        const page = takeNext();
        if (page === null) break;
        pending.add(page);
        active++;
        void read(page);
      }
    };

    queue.current = (page, retry = false) => {
      if (disposed || page < 1 || page > document.numPages) return;
      if (pending.has(page) || (!retry && completed.has(page))) return;
      if (retry) {
        completed.delete(page);
        setErrors((previous) => {
          const result = new Map(previous);
          result.delete(page);
          return result;
        });
      }
      const queuedIndex = priority.indexOf(page);
      if (queuedIndex >= 0) priority.splice(queuedIndex, 1);
      priority.unshift(page);
      pump();
    };
    pump();
    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [document]);

  const prioritize = useCallback((page: number) => queue.current(page), []);
  const retry = useCallback((page: number) => queue.current(page, true), []);
  return { geometries, errors, prioritize, retry };
};
