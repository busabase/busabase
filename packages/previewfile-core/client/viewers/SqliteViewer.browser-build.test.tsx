/**
 * SqliteViewer against sql.js' real browser build — the one `import("sql.js")`
 * resolves to in a browser bundle. Its `exec` results arrive without `columns`
 * (minified to `lc` in 1.14), which mocked engines never reproduce: the viewer
 * crashed on every database while the mocked tests stayed green.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SqliteViewer from "./SqliteViewer";

const { mockUseFileFetch } = vi.hoisted(() => ({ mockUseFileFetch: vi.fn() }));

vi.mock("sql.js", async () => vi.importActual("sql.js/dist/sql-wasm-browser.js"));
vi.mock("previewfile-core/client/file-fetch", () => ({ useFileFetch: mockUseFileFetch }));

const wasm = readFileSync(
  createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm-browser.wasm"),
);

describe("SqliteViewer with sql.js' browser build", () => {
  beforeEach(() => {
    // The viewer locates the engine at /sql-wasm/<file>; serve it from the package.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe("/sql-wasm/sql-wasm-browser.wasm");
        return new Response(wasm, { headers: { "content-type": "application/wasm" } });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a real database's columns and rows", async () => {
    const { default: initSqlJs } = (await import("sql.js")) as unknown as {
      default: (config: { locateFile: (file: string) => string }) => Promise<{
        Database: new () => { run(sql: string): void; export(): Uint8Array; close(): void };
      }>;
    };
    const SQL = await initSqlJs({ locateFile: (file) => `/sql-wasm/${file}` });
    const db = new SQL.Database();
    db.run(
      "CREATE TABLE agencies (id INTEGER PRIMARY KEY, name TEXT, city TEXT);" +
        "INSERT INTO agencies (name, city) VALUES ('Northwind Media', 'Singapore'), ('蓝港传媒', '上海');",
    );
    const bytes = db.export();
    db.close();
    mockUseFileFetch.mockReturnValue({
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<SqliteViewer fileUrl="https://files.example/crm.sqlite" fileName="crm.sqlite" />);

    expect(await screen.findByText("Northwind Media", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText("蓝港传媒")).toBeInTheDocument();
    expect(screen.getByText("city")).toBeInTheDocument();
    expect(screen.getByText(/2 rows × 3 columns/)).toBeInTheDocument();
  });
});
