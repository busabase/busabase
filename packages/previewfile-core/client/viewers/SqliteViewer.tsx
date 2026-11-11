/// <reference path="../../types/ambient.d.ts" />
"use client";

import { useFileFetch } from "previewfile-core/client/file-fetch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List } from "react-window";
import { useI18n } from "../i18n";
import { useDownloadGuard } from "./download-guard";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { ViewerError } from "./viewer-error";

// sql.js types
interface Database {
  exec(sql: string): QueryExecResult[];
  prepare(sql: string): Statement;
  close(): void;
}

interface Statement {
  getColumnNames(): string[];
  step(): boolean;
  get(): unknown[];
  free(): boolean;
}

// No `columns` here on purpose: sql.js 1.14's browser build ships with that
// property minified (it arrives as `lc`), so only `values` can be read from an
// `exec` result. Column names come from a prepared statement instead.
interface QueryExecResult {
  values: unknown[][];
}

interface SqlJs {
  Database: new (data?: Uint8Array) => Database;
}

interface SqliteViewerProps {
  fileUrl: string;
  fileName: string;
  watermark?: string | null;
  noDownload?: boolean;
}

interface TableInfo {
  name: string;
  rowCount: number;
}

interface QueryResult {
  columns: string[];
  values: unknown[][];
}

/**
 * SQLite database viewer
 * Uses sql.js to load and query SQLite databases in the browser
 * Uses react-window for virtualized scrolling of large tables
 */
export default function SqliteViewer({
  fileUrl,
  fileName,
  watermark,
  noDownload = false,
}: SqliteViewerProps) {
  const { LL } = useI18n();
  // Use centralized file fetch hook
  const {
    data: arrayBuffer,
    loading: fetchLoading,
    error: fetchError,
  } = useFileFetch(fileUrl, "arrayBuffer");

  const [database, setDatabase] = useState<Database | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate column widths based on content
  const columnWidths = useMemo(() => {
    if (!queryResult || queryResult.columns.length === 0) return [];

    return queryResult.columns.map((header, index) => {
      let maxLength = header.length;

      // Sample first 100 rows for performance
      const sampleSize = Math.min(100, queryResult.values.length);
      for (let i = 0; i < sampleSize; i++) {
        const cell = String(queryResult.values[i]?.[index] ?? "");
        maxLength = Math.max(maxLength, cell.length);
      }

      // Convert to pixels: ~8px per character + 32px padding
      // Min 100px, max 400px
      return Math.max(100, Math.min(400, maxLength * 8 + 32));
    });
  }, [queryResult]);

  // Calculate total width
  const totalWidth = useMemo(() => {
    const ROW_NUMBER_WIDTH = 60;
    return columnWidths.reduce((sum, width) => sum + width, ROW_NUMBER_WIDTH);
  }, [columnWidths]);

  // Load database from ArrayBuffer
  const loadDatabase = useCallback(async (arrayBuffer: ArrayBuffer): Promise<Database> => {
    console.log("[SqliteViewer] Starting loadDatabase");

    try {
      // Dynamic import of sql.js.
      // Import the package root so bundlers can honor its `browser` export.
      // Importing `dist/sql-wasm.js` directly pulls the Node build, which references
      // `node:fs` and `node:crypto` and breaks webpack/Turbopack client compilation.
      console.log("[SqliteViewer] Importing sql.js module...");
      const module = await import("sql.js");
      const initSqlJs = module.default;
      console.log("[SqliteViewer] Imported sql.js module");

      // Initialize sql.js with WASM file path
      console.log("[SqliteViewer] Initializing sql.js with WASM...");
      const SQL: SqlJs = await initSqlJs({
        locateFile: (file: string) => {
          console.log("[SqliteViewer] Locating WASM file:", file);
          return `/sql-wasm/${file}`;
        },
      });
      console.log("[SqliteViewer] Initialized sql.js");

      console.log("[SqliteViewer] Database file size:", arrayBuffer.byteLength);
      const uint8Array = new Uint8Array(arrayBuffer);

      // Create database instance
      console.log("[SqliteViewer] Opening database...");
      try {
        const db = new SQL.Database(uint8Array);
        // Test if database is accessible
        db.exec("SELECT 1");
        console.log("[SqliteViewer] Database opened successfully");
        return db;
      } catch (err) {
        console.error("[SqliteViewer] Error opening database:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes("file is not a database") || errorMessage.includes("malformed")) {
          throw new Error(
            "This database uses WAL mode and cannot be viewed in the browser. " +
              "Please download the file to view it locally.",
          );
        }
        throw err;
      }
    } catch (err) {
      console.error("[SqliteViewer] Fatal error in loadDatabase:", err);
      throw err;
    }
  }, []);

  // Query sqlite_master for table list
  const fetchTables = useCallback(async (db: Database): Promise<TableInfo[]> => {
    const result = db.exec(`
      SELECT name, type 
      FROM sqlite_master 
      WHERE type='table' 
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);

    if (result.length === 0 || result[0].values.length === 0) {
      return [];
    }

    // Get row count for each table
    const tableInfos: TableInfo[] = [];
    for (const row of result[0].values) {
      const tableName = row[0] as string;
      const countResult = db.exec(`SELECT COUNT(*) FROM "${tableName}"`);
      const rowCount = countResult[0].values[0][0] as number;
      tableInfos.push({ name: tableName, rowCount });
    }

    return tableInfos;
  }, []);

  // Execute SELECT query on a table. A prepared statement reports its column
  // names even when the table is empty, where `exec` returns no result at all.
  const queryTable = useCallback(async (db: Database, tableName: string): Promise<QueryResult> => {
    const statement = db.prepare(`SELECT * FROM "${tableName}"`);
    try {
      const columns = statement.getColumnNames();
      const values: unknown[][] = [];
      while (statement.step()) values.push(statement.get());
      return { columns, values };
    } finally {
      statement.free();
    }
  }, []);

  // Handle table selection change
  const handleTableChange = useCallback(
    async (tableName: string) => {
      if (!database) return;

      try {
        setTableLoading(true);
        const result = await queryTable(database, tableName);
        setQueryResult(result);
        setSelectedTable(tableName);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to query table"));
      } finally {
        setTableLoading(false);
      }
    },
    [database, queryTable],
  );

  // Initial database load - triggered when arrayBuffer is available
  useEffect(() => {
    // Handle fetch errors
    if (fetchError) {
      setError(fetchError);
      setLoading(false);
      return;
    }

    // Wait for arrayBuffer to be fetched
    if (fetchLoading || !arrayBuffer) {
      setLoading(true);
      return;
    }

    let isMounted = true;
    let currentDb: Database | null = null;

    const initDatabase = async () => {
      try {
        setLoading(true);
        setError(null);

        console.log("[SqliteViewer] Starting initialization with fetched arrayBuffer");
        const db = await loadDatabase(arrayBuffer);
        currentDb = db;

        if (!isMounted) {
          db.close();
          return;
        }

        setDatabase(db);

        const tableList = await fetchTables(db);
        setTables(tableList);

        if (tableList.length === 0) {
          setError(new ViewerError("sqliteNoTables"));
          setLoading(false);
          return;
        }

        // Load first table by default
        const firstTable = tableList[0].name;
        const result = await queryTable(db, firstTable);

        if (isMounted) {
          setQueryResult(result);
          setSelectedTable(firstTable);
          setLoading(false);
        }
      } catch (err) {
        console.error("[SqliteViewer] Initialization failed:", err);
        if (isMounted) {
          setError(err instanceof Error ? err : new Error("Unknown error"));
          setLoading(false);
        }
      }
    };

    initDatabase();

    // Cleanup: close database on unmount or when arrayBuffer changes
    return () => {
      isMounted = false;
      if (currentDb) {
        console.log("[SqliteViewer] Closing database");
        currentDb.close();
      }
    };
  }, [arrayBuffer, fetchLoading, fetchError, loadDatabase, fetchTables, queryTable]);

  // Embedded (`fill`), `noDownload` only means the host shows its own download
  // button; the save/print guard is for a share link that forbids downloading.
  useDownloadGuard(noDownload);

  // Format cell value (handle NULL)
  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return "(null)";
    }
    return String(value);
  };

  if (loading) {
    return <LoadingState message={LL.preview.loadingSqliteViewer()} />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={() => window.location.reload()} />;
  }

  if (!queryResult || tables.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-gray-500">{LL.preview.sqliteNoTables()}</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col bg-white">
      {/* Watermark */}
      {watermark && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-6xl font-bold text-gray-300 opacity-20 rotate-[-45deg]">
            {watermark}
          </div>
        </div>
      )}

      {/* Header: File info + Table selector */}
      <div className="border-b border-gray-200 bg-white z-20">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="text-sm">
            <span className="font-semibold">{fileName}</span>
            <span className="ml-4 text-gray-400">
              {LL.preview.sqliteRowsColumns({
                rows: queryResult.values.length,
                columns: queryResult.columns.length,
              })}
            </span>
            {tables.length > 1 && (
              <span className="ml-4 text-gray-400">
                {LL.preview.sqliteTableCount({ count: tables.length })}
              </span>
            )}
          </div>
        </div>

        {/* Table selector */}
        {tables.length > 1 && (
          <div className="px-4 pb-3 flex items-center gap-2">
            <label htmlFor="table-select" className="text-sm font-medium text-gray-700">
              {LL.preview.sqliteTableLabel()}
            </label>
            <select
              id="table-select"
              value={selectedTable || ""}
              onChange={(e) => handleTableChange(e.target.value)}
              disabled={tableLoading}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {tables.map((table) => (
                <option key={table.name} value={table.name}>
                  {LL.preview.sqliteTableOption({ name: table.name, rows: table.rowCount })}
                </option>
              ))}
            </select>
            {tableLoading && (
              <span className="text-sm text-gray-500">{LL.preview.loadingGeneric()}</span>
            )}
          </div>
        )}
      </div>

      {/* Table content with Virtual Scrolling */}
      <div ref={containerRef} className="flex-1 overflow-auto border-l border-r border-gray-200">
        {queryResult.values.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {LL.preview.sqliteTableEmpty({ name: selectedTable ?? "" })}
          </div>
        ) : (
          <>
            {/* Table Header (Sticky) */}
            <div className="sticky top-0 z-20 bg-gray-50 border-b-2 border-gray-300 shadow-sm">
              <div className="flex" style={{ minWidth: totalWidth }}>
                {/* Row Number Header */}
                <div className="flex-shrink-0 w-[60px] px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-300">
                  #
                </div>

                {/* Column Headers */}
                {queryResult.columns.map((header, index) => (
                  <div
                    key={`header-${
                      // biome-ignore lint: index is stable for headers
                      index
                    }`}
                    className="flex-shrink-0 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 last:border-r-0"
                    style={{ width: columnWidths[index] }}
                  >
                    {header || LL.preview.sqliteColumnFallback({ index: index + 1 })}
                  </div>
                ))}
              </div>
            </div>

            {/* Virtual Scrolling List */}
            <List
              rowHeight={40}
              rowCount={queryResult.values.length}
              defaultHeight={containerRef.current?.clientHeight || 600}
              overscanCount={10}
              style={{ minWidth: totalWidth }}
              rowComponent={({ index, style }) => {
                const row = queryResult.values[index];
                if (!row) return <div style={{ ...style, display: "none" }} />;

                return (
                  <div
                    style={{
                      ...style,
                      minWidth: totalWidth,
                    }}
                    className={`flex border-b border-gray-200 ${
                      index % 2 === 0 ? "bg-white" : "bg-gray-50"
                    }`}
                  >
                    {/* Row Number */}
                    <div className="flex-shrink-0 w-[60px] px-3 py-2.5 text-sm text-gray-500 font-medium border-r border-gray-300">
                      {index + 1}
                    </div>

                    {/* Cells */}
                    {row.map((cell, cellIndex) => {
                      const cellValue = formatCellValue(cell);
                      return (
                        <div
                          key={`cell-${index}-${
                            // biome-ignore lint: cellIndex is stable for row
                            cellIndex
                          }`}
                          className="flex-shrink-0 px-4 py-2.5 text-sm text-gray-900 border-r border-gray-200 last:border-r-0 truncate"
                          style={{ width: columnWidths[cellIndex] }}
                          title={cellValue} // Tooltip for truncated content
                        >
                          {cellValue}
                        </div>
                      );
                    })}
                  </div>
                );
              }}
              rowProps={{}}
            />
          </>
        )}
      </div>
    </div>
  );
}
