/**
 * Integration tests for SqliteViewer component
 * Tests complete database loading and display flow
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SqliteViewer from "./SqliteViewer";
import { ViewerLayoutProvider } from "./viewer-layout";

const { mockDatabase, mockSqlJs, mockUseFileFetch } = vi.hoisted(() => {
  const database = {
    exec: vi.fn(),
    // The component reads a table through a prepared statement; serve it from
    // the same scripted `exec` results so each test keeps one call sequence.
    // (The real browser build is covered by SqliteViewer.browser-build.test.tsx.)
    prepare: vi.fn((sql: string) => {
      const [result] = database.exec(sql) as { columns: string[]; values: unknown[][] }[];
      const rows = result?.values ?? [];
      let row = -1;
      return {
        getColumnNames: () => result?.columns ?? [],
        step: () => ++row < rows.length,
        get: () => rows[row],
        free: () => true,
      };
    }),
    close: vi.fn(),
  };

  return {
    mockDatabase: database,
    mockSqlJs: {
      // biome-ignore lint/complexity/useArrowFunction: Vitest 4 invokes this mock with real `new` semantics (component calls `new SQL.Database(...)`); arrow functions can't be constructed
      Database: vi.fn(function () {
        return database;
      }),
    },
    mockUseFileFetch: vi.fn(),
  };
});

vi.mock("sql.js", () => ({
  default: vi.fn(() => Promise.resolve(mockSqlJs)),
}));

vi.mock("previewfile-core/client/file-fetch", () => ({
  useFileFetch: mockUseFileFetch,
}));

describe("SqliteViewer - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabase.exec.mockClear();
    mockDatabase.close.mockClear();
    mockUseFileFetch.mockClear();
  });

  describe("Task 21.2: Complete database loading and display flow", () => {
    it("should load a test SQLite database, discover tables, and display data correctly", async () => {
      // Mock useFileFetch to return a valid database file
      const mockArrayBuffer = new ArrayBuffer(8);
      mockUseFileFetch.mockReturnValue({
        data: mockArrayBuffer,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      // Mock database.exec calls
      mockDatabase.exec
        // First call: SELECT 1 (database accessibility test)
        .mockReturnValueOnce([])
        // Second call: Query sqlite_master for tables
        .mockReturnValueOnce([
          {
            columns: ["name", "type"],
            values: [
              ["users", "table"],
              ["products", "table"],
            ],
          },
        ])
        // Third call: COUNT(*) for users table
        .mockReturnValueOnce([
          {
            columns: ["COUNT(*)"],
            values: [[3]],
          },
        ])
        // Fourth call: COUNT(*) for products table
        .mockReturnValueOnce([
          {
            columns: ["COUNT(*)"],
            values: [[2]],
          },
        ])
        // Fifth call: SELECT * FROM users (first table data)
        .mockReturnValueOnce([
          {
            columns: ["id", "name", "email"],
            values: [
              [1, "Alice", "alice@example.com"],
              [2, "Bob", "bob@example.com"],
              [3, "Charlie", "charlie@example.com"],
            ],
          },
        ]);

      // Render the component
      render(<SqliteViewer fileUrl="https://example.com/test.db" fileName="test.db" />);

      // Verify loading state is shown initially
      expect(screen.getByText("Loading SQLite database...")).toBeInTheDocument();

      // Wait for database to load and tables to be discovered
      await waitFor(() => {
        expect(screen.getByText("test.db")).toBeInTheDocument();
      });

      // Verify useFileFetch was called with correct URL and format (Requirement 8.2)
      expect(mockUseFileFetch).toHaveBeenCalledWith("https://example.com/test.db", "arrayBuffer");

      // Verify sql.js Database was instantiated (Requirement 2.2)
      expect(mockSqlJs.Database).toHaveBeenCalledWith(expect.any(Uint8Array));

      // Verify tables were discovered (Requirement 3.1)
      expect(mockDatabase.exec).toHaveBeenCalledWith(expect.stringContaining("SELECT name, type"));
      expect(mockDatabase.exec).toHaveBeenCalledWith(expect.stringContaining("FROM sqlite_master"));

      // Verify table metadata is displayed
      expect(screen.getByText(/3 rows × 3 columns/)).toBeInTheDocument();
      expect(screen.getByText(/2 tables/)).toBeInTheDocument();

      // Verify column headers are displayed (Requirement 4.2, 4.3)
      expect(screen.getByText("id")).toBeInTheDocument();
      expect(screen.getByText("name")).toBeInTheDocument();
      expect(screen.getByText("email")).toBeInTheDocument();

      // Verify data is displayed correctly (Requirement 4.1)
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("bob@example.com")).toBeInTheDocument();
      expect(screen.getByText("Charlie")).toBeInTheDocument();
      expect(screen.getByText("charlie@example.com")).toBeInTheDocument();

      // Verify SELECT query was executed on first table (Requirement 4.1)
      expect(mockDatabase.exec).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM "users"'),
      );

      // Verify row numbers are displayed (they appear both as row numbers and as data)
      const rowNumbers = screen.getAllByText("1");
      expect(rowNumbers.length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(1);
    });

    it("should handle single-table databases correctly", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      mockUseFileFetch.mockReturnValue({
        data: mockArrayBuffer,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      mockDatabase.exec
        .mockReturnValueOnce([]) // SELECT 1
        .mockReturnValueOnce([
          {
            columns: ["name", "type"],
            values: [["orders", "table"]],
          },
        ])
        .mockReturnValueOnce([
          {
            columns: ["COUNT(*)"],
            values: [[5]],
          },
        ])
        .mockReturnValueOnce([
          {
            columns: ["order_id", "customer", "total"],
            values: [
              [101, "John Doe", 99.99],
              [102, "Jane Smith", 149.5],
              [103, "Bob Johnson", 75.0],
              [104, "Alice Brown", 200.0],
              [105, "Charlie Wilson", 50.25],
            ],
          },
        ]);

      render(<SqliteViewer fileUrl="https://example.com/orders.db" fileName="orders.db" />);

      await waitFor(() => {
        expect(screen.getByText("orders.db")).toBeInTheDocument();
      });

      // Verify table data is displayed
      expect(screen.getByText("order_id")).toBeInTheDocument();
      expect(screen.getByText("customer")).toBeInTheDocument();
      expect(screen.getByText("total")).toBeInTheDocument();

      expect(screen.getByText("John Doe")).toBeInTheDocument();
      expect(screen.getByText("99.99")).toBeInTheDocument();
      expect(screen.getByText("Jane Smith")).toBeInTheDocument();
      expect(screen.getByText("149.5")).toBeInTheDocument();

      // Verify metadata shows correct counts
      expect(screen.getByText(/5 rows/)).toBeInTheDocument();
      expect(screen.getByText(/3 columns/)).toBeInTheDocument();

      // Should NOT show "tables" count for single table
      expect(screen.queryByText(/tables/)).not.toBeInTheDocument();
    });

    it("should handle tables with NULL values correctly", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      mockUseFileFetch.mockReturnValue({
        data: mockArrayBuffer,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      mockDatabase.exec
        .mockReturnValueOnce([]) // SELECT 1
        .mockReturnValueOnce([
          {
            columns: ["name", "type"],
            values: [["contacts", "table"]],
          },
        ])
        .mockReturnValueOnce([
          {
            columns: ["COUNT(*)"],
            values: [[3]],
          },
        ])
        .mockReturnValueOnce([
          {
            columns: ["id", "name", "phone", "email"],
            values: [
              [1, "Alice", "555-1234", null],
              [2, "Bob", null, "bob@example.com"],
              [3, "Charlie", null, null],
            ],
          },
        ]);

      render(<SqliteViewer fileUrl="https://example.com/contacts.db" fileName="contacts.db" />);

      await waitFor(() => {
        expect(screen.getByText("contacts.db")).toBeInTheDocument();
      });

      // Verify NULL values are displayed as "(null)"
      const nullElements = screen.getAllByText("(null)");
      expect(nullElements.length).toBeGreaterThanOrEqual(3);

      // Verify non-null data is still displayed correctly
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("555-1234")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("bob@example.com")).toBeInTheDocument();
      expect(screen.getByText("Charlie")).toBeInTheDocument();
    });

    it("should handle empty tables correctly", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      mockUseFileFetch.mockReturnValue({
        data: mockArrayBuffer,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      mockDatabase.exec
        .mockReturnValueOnce([]) // SELECT 1
        .mockReturnValueOnce([
          {
            columns: ["name", "type"],
            values: [["empty_table", "table"]],
          },
        ])
        .mockReturnValueOnce([
          {
            columns: ["COUNT(*)"],
            values: [[0]],
          },
        ])
        .mockReturnValueOnce([
          {
            columns: ["id", "data"],
            values: [],
          },
        ]);

      render(<SqliteViewer fileUrl="https://example.com/empty.db" fileName="empty.db" />);

      await waitFor(() => {
        expect(screen.getByText("empty.db")).toBeInTheDocument();
      });

      // Verify empty table message is shown
      expect(screen.getByText(/Table "empty_table" is empty/)).toBeInTheDocument();

      // Verify metadata shows 0 rows
      expect(screen.getByText(/0 rows/)).toBeInTheDocument();
    });

    it("should handle databases with system tables correctly", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      mockUseFileFetch.mockReturnValue({
        data: mockArrayBuffer,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      mockDatabase.exec
        .mockReturnValueOnce([]) // SELECT 1
        // sqlite_master query should filter out system tables
        .mockReturnValueOnce([
          {
            columns: ["name", "type"],
            values: [["user_data", "table"]],
          },
        ])
        .mockReturnValueOnce([
          {
            columns: ["COUNT(*)"],
            values: [[2]],
          },
        ])
        .mockReturnValueOnce([
          {
            columns: ["id", "value"],
            values: [
              [1, "test1"],
              [2, "test2"],
            ],
          },
        ]);

      render(<SqliteViewer fileUrl="https://example.com/system.db" fileName="system.db" />);

      await waitFor(() => {
        expect(screen.getByText("system.db")).toBeInTheDocument();
      });

      // Verify the query excludes system tables
      expect(mockDatabase.exec).toHaveBeenCalledWith(
        expect.stringContaining("AND name NOT LIKE 'sqlite_%'"),
      );

      // Verify only user table is shown
      expect(screen.getByText("test1")).toBeInTheDocument();
      expect(screen.getByText("test2")).toBeInTheDocument();
    });

    it("should handle large tables with many rows", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      mockUseFileFetch.mockReturnValue({
        data: mockArrayBuffer,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      // Generate 150 rows of data
      const largeDataset = Array.from({ length: 150 }, (_, i) => [
        i + 1,
        `User ${i + 1}`,
        `user${i + 1}@example.com`,
      ]);

      mockDatabase.exec
        .mockReturnValueOnce([]) // SELECT 1
        .mockReturnValueOnce([
          {
            columns: ["name", "type"],
            values: [["large_table", "table"]],
          },
        ])
        .mockReturnValueOnce([
          {
            columns: ["COUNT(*)"],
            values: [[150]],
          },
        ])
        .mockReturnValueOnce([
          {
            columns: ["id", "name", "email"],
            values: largeDataset,
          },
        ]);

      const { container } = render(
        <SqliteViewer fileUrl="https://example.com/large.db" fileName="large.db" />,
      );

      await waitFor(() => {
        expect(screen.getByText("large.db")).toBeInTheDocument();
      });

      // Verify metadata shows correct row count
      expect(screen.getByText(/150 rows/)).toBeInTheDocument();

      // Verify first few rows are visible
      expect(screen.getByText("User 1")).toBeInTheDocument();
      expect(screen.getByText("user1@example.com")).toBeInTheDocument();

      // Verify virtual scrolling is used (not all rows rendered)
      const allText = container.textContent || "";
      // User 150 should NOT be initially rendered (too far down)
      expect(allText).not.toContain("User 150");
    });
  });
  describe("noDownload", () => {
    const savePrevented = () => {
      const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    };

    beforeEach(() => {
      mockUseFileFetch.mockReturnValue({
        data: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });
    });

    it("blocks saving and printing on a share link that forbids downloading", () => {
      const { unmount } = render(
        <SqliteViewer fileUrl="https://example.com/test.db" fileName="test.db" noDownload />,
      );
      expect(savePrevented()).toBe(true);
      unmount();
      expect(savePrevented()).toBe(false);
    });

    it("leaves the host's shortcuts alone when embedded", () => {
      render(
        <ViewerLayoutProvider layout="fill">
          <SqliteViewer fileUrl="https://example.com/test.db" fileName="test.db" noDownload />
        </ViewerLayoutProvider>,
      );
      expect(savePrevented()).toBe(false);
    });
  });
});
