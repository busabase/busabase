/// <reference path="../../types/ambient.d.ts" />
"use client";

import { AlertCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "x-data-spreadsheet/dist/xspreadsheet";
// The grid lays its overlay, scrollbars and sheet tabs out with this sheet;
// without it the overlay stacks below the canvas and the tabs fall off-screen.
import "x-data-spreadsheet/dist/xspreadsheet.css";
import * as XLSX from "xlsx";
import { useI18n } from "../i18n";
import { useDownloadGuard } from "./download-guard";
import { explainError } from "./explain-error";
import { LoadingState } from "./LoadingState";
import { useViewerHeightClass } from "./viewer-layout";

const X_SPREADSHEET_GRID_OVERHANG_PX = 16;

interface XlsxPreviewProps {
  fileUrl: string;
  fileName?: string;
  watermark?: string | null;
  noDownload?: boolean;
}

type XSpreadsheetFactory = (
  container: HTMLElement | string,
  options?: {
    mode?: "edit" | "read";
    showToolbar?: boolean;
    showGrid?: boolean;
    showContextmenu?: boolean;
    showBottomBar?: boolean;
    view?: {
      height: () => number;
      width: () => number;
    };
  },
) => {
  loadData: (data: XSpreadsheetSheet[]) => unknown;
};

// An intersection, not `interface … extends Window`: `x-data-spreadsheet` ships
// its own global augmentation declaring `x_spreadsheet` as *required*, and an
// interface may not re-declare an inherited member as optional (TS2430, newly
// enforced under TypeScript 7). The script is loaded lazily at runtime, so
// optional is the honest type here.
type XSpreadsheetWindow = Window & {
  x_spreadsheet?: XSpreadsheetFactory;
};

interface XSpreadsheetCell {
  text: string;
  merge?: [number, number];
}

interface XSpreadsheetRow {
  cells: Record<number, XSpreadsheetCell>;
}

type XSpreadsheetRows = { len?: number } & Record<number, XSpreadsheetRow>;
type XSpreadsheetCols = { len?: number } & Record<number, { width: number }>;

interface XSpreadsheetSheet {
  name: string;
  rows: XSpreadsheetRows;
  cols?: XSpreadsheetCols;
  merges?: string[];
}

export default function XlsxPreview({
  fileUrl,
  fileName,
  watermark,
  noDownload = false,
}: XlsxPreviewProps) {
  const { LL } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const heightClass = useViewerHeightClass();
  // Embedded (`fill`), `noDownload` only means the host shows its own download
  // button; the save/print guard is for a share link that forbids downloading.
  // A share link that forbids downloading may not be saved or printed either.
  useDownloadGuard(noDownload);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetName, setSheetName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadSpreadsheet = async () => {
      try {
        const container = containerRef.current;
        if (!container) return;

        setLoading(true);
        setLoadError(null);
        container.replaceChildren();

        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch spreadsheet: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const workbook = readSpreadsheetWorkbook(arrayBuffer, {
          contentType: response.headers.get("content-type"),
          fileName,
        });
        const data = workbookToXSpreadsheetData(workbook);

        if (data.length === 0) throw new Error(LL.preview.spreadsheetLoadErrorTitle());
        if (cancelled) return;

        const createSpreadsheet = (window as XSpreadsheetWindow).x_spreadsheet;
        if (!createSpreadsheet) throw new Error(LL.preview.spreadsheetLoadErrorTitle());

        const spreadsheet = createSpreadsheet(container, {
          mode: "read",
          showToolbar: false,
          showContextmenu: false,
          showGrid: true,
          showBottomBar: data.length > 1,
          view: {
            // x-spreadsheet draws its grid 16px taller than the height it is
            // given (a scrollbar track it never subtracts), which pushed the
            // sheet tabs past the clipped bottom edge of the container.
            height: () => (container.clientHeight || 480) - X_SPREADSHEET_GRID_OVERHANG_PX,
            width: () => container.clientWidth || 800,
          },
        });

        spreadsheet.loadData(data);
        setSheetName(data[0]?.name ?? null);
        setLoading(false);
      } catch (err) {
        console.error("Spreadsheet load error:", err);
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : LL.preview.unknownError());
        setLoading(false);
      }
    };

    loadSpreadsheet();

    return () => {
      cancelled = true;
      containerRef.current?.replaceChildren();
    };
  }, [fileUrl, fileName, LL]);

  if (loadError) {
    return (
      <div className="p-3 text-center">
        <AlertCircle size={40} className="mx-auto mb-2 text-destructive" />
        <h3 className="text-lg font-semibold text-destructive">
          {LL.preview.spreadsheetLoadErrorTitle()}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{explainError(LL.preview, loadError)}</p>
      </div>
    );
  }

  return (
    <div className={`w-full ${heightClass} p-2 flex flex-col bg-background`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        {sheetName && <span className="text-xs text-muted-foreground">{sheetName}</span>}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        {loading && (
          <div className="absolute inset-0 z-10 bg-background">
            <LoadingState message={LL.preview.loadingSpreadsheetEngine()} />
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" />
        {watermark && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="text-6xl font-bold text-black/10 rotate-[-45deg] select-none whitespace-nowrap">
              {watermark}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const isDelimitedText = (fileName: string | undefined, contentType: string | null | undefined) => {
  const extension = fileName?.split(".").pop()?.toLowerCase();
  const mimeType = contentType?.split(";")[0]?.trim().toLowerCase();
  return (
    extension === "csv" ||
    extension === "tsv" ||
    mimeType === "text/csv" ||
    mimeType === "text/tab-separated-values"
  );
};

// UTF-8 first; anything that is not valid UTF-8 is most likely GB18030/GBK,
// which is what Excel on Chinese Windows writes when it saves a CSV.
const decodeDelimitedText = (buffer: ArrayBuffer) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("gb18030").decode(buffer);
  }
};

/**
 * Parses the fetched file into a workbook. A CSV/TSV carries no encoding marker
 * SheetJS can trust: handed raw bytes it assumes a single-byte codepage, which
 * turns UTF-8 Chinese into mojibake, and it re-types cells, which turns
 * "2026-10-01" into "10/1/26" and "0012" into 12. Delimited text is therefore
 * decoded here and every cell kept exactly as written; binary workbooks are
 * left to SheetJS.
 */
export function readSpreadsheetWorkbook(
  buffer: ArrayBuffer,
  { contentType, fileName }: { contentType?: string | null; fileName?: string },
): XLSX.WorkBook {
  if (isDelimitedText(fileName, contentType)) {
    return XLSX.read(decodeDelimitedText(buffer), { type: "string", raw: true });
  }
  return XLSX.read(buffer, { type: "array" });
}

function workbookToXSpreadsheetData(workbook: XLSX.WorkBook): XSpreadsheetSheet[] {
  return workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1");
    const rows: XSpreadsheetRows = {};
    const cols: XSpreadsheetCols = {};
    const merges: string[] = [];
    const values = XLSX.utils.sheet_to_json(worksheet, {
      raw: false,
      header: 1,
      blankrows: false,
    }) as Array<Array<string | number | boolean | Date | null | undefined>>;

    values.forEach((row, rowIndex) => {
      const cells: Record<number, XSpreadsheetCell> = {};

      row.forEach((cell, columnIndex) => {
        if (cell === null || cell === undefined) return;
        cells[columnIndex] = { text: String(cell) };
      });

      if (Object.keys(cells).length > 0) rows[rowIndex] = { cells };
    });

    for (const merge of worksheet["!merges"] ?? []) {
      const ref = XLSX.utils.encode_range(merge);
      merges.push(ref);

      const row = rows[merge.s.r];
      const cell = row?.cells[merge.s.c];
      if (cell) {
        cell.merge = [merge.e.r - merge.s.r, merge.e.c - merge.s.c];
      }
    }

    worksheet["!cols"]?.forEach((column, columnIndex) => {
      if (!column?.wch) return;
      cols[columnIndex] = { width: Math.max(60, Math.round(column.wch * 8)) };
    });

    rows.len = Math.max(range.e.r + 1, values.length, 20);
    cols.len = Math.max(range.e.c + 1, 10);

    return {
      name,
      rows,
      cols,
      merges,
    };
  });
}
