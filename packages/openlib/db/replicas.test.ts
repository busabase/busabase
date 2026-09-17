import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const driverMocks = vi.hoisted(() => {
  const postgres = vi.fn((url: string, options: Record<string, unknown>) => ({ url, options }));
  const drizzle = vi.fn(({ client }: { client: { options: { target_session_attrs: string } } }) => {
    const role = client.options.target_session_attrs;
    const call = (method: string) => vi.fn(() => `${role}:${method}`);
    return {
      select: call("select"),
      selectDistinct: call("selectDistinct"),
      selectDistinctOn: call("selectDistinctOn"),
      $count: call("$count"),
      with: call("with"),
      $with: call("$with"),
      update: call("update"),
      insert: call("insert"),
      delete: call("delete"),
      execute: call("execute"),
      transaction: call("transaction"),
      refreshMaterializedView: call("refreshMaterializedView"),
      query: { role },
    };
  });
  return { drizzle, postgres };
});

vi.mock("postgres", () => ({ default: driverMocks.postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: driverMocks.drizzle }));

import { createPostgresJsDatabaseWithReadReplica, resolveDatabaseRuntimeConfig } from "./replicas";

describe("resolveDatabaseRuntimeConfig", () => {
  it("requires a primary database URL", () => {
    expect(() => resolveDatabaseRuntimeConfig({})).toThrow(/PG_DATABASE_URL/);
  });

  it("uses PGlite as both the primary and read database", () => {
    expect(resolveDatabaseRuntimeConfig({ PG_DATABASE_URL: "pglite://memory://" })).toEqual({
      mode: "pglite",
      primaryUrl: "pglite://memory://",
      dataDir: "memory://",
    });
  });

  it("rejects a read replica alongside PGlite", () => {
    expect(() =>
      resolveDatabaseRuntimeConfig({
        PG_DATABASE_URL: "pglite://memory://",
        PG_DATABASE_READ_URL: "postgresql://user:pass@reader:5432/app",
      }),
    ).toThrow(/cannot be used.*PGLite/);
  });

  it("rejects a non-PostgreSQL reader", () => {
    expect(() =>
      resolveDatabaseRuntimeConfig({
        PG_DATABASE_URL: "postgresql://user:pass@primary:5432/app",
        PG_DATABASE_READ_URL: "mysql://user:pass@reader:3306/app",
      }),
    ).toThrow(/PG_DATABASE_READ_URL must use/);
  });

  it("rejects the same sanitized URL for primary and reader", () => {
    expect(() =>
      resolveDatabaseRuntimeConfig({
        PG_DATABASE_URL: "postgresql://user:pass@database.example.com:5432/app?connection_limit=10",
        PG_DATABASE_READ_URL:
          "postgresql://user:pass@database.example.com:5432/app?connection_limit=5",
      }),
    ).toThrow(/must not be the same connection URL/);
  });

  it("allows a managed proxy endpoint to route by database role", () => {
    expect(
      resolveDatabaseRuntimeConfig({
        PG_DATABASE_URL: "postgresql://writer:secret@database.example.com:5432/app",
        PG_DATABASE_READ_URL: "postgresql://reader:different@database.example.com:5432/app",
      }),
    ).toMatchObject({ mode: "postgres", primaryPoolMax: 5, readPoolMax: 5 });
  });

  it("keeps the existing pool maximum without a reader", () => {
    expect(
      resolveDatabaseRuntimeConfig({
        PG_DATABASE_URL: "postgresql://user:pass@primary:5432/app",
      }),
    ).toEqual({
      mode: "postgres",
      primaryUrl: "postgresql://user:pass@primary:5432/app",
      primaryPoolMax: 10,
    });
  });

  it("splits the default pool budget when a reader is configured", () => {
    expect(
      resolveDatabaseRuntimeConfig({
        PG_DATABASE_URL: "postgresql://user:pass@primary:5432/app",
        PG_DATABASE_READ_URL: "postgresql://user:pass@reader:5432/app",
      }),
    ).toEqual({
      mode: "postgres",
      primaryUrl: "postgresql://user:pass@primary:5432/app",
      primaryPoolMax: 5,
      readUrl: "postgresql://user:pass@reader:5432/app",
      readPoolMax: 5,
    });
  });

  it("supports explicit per-pool limits", () => {
    expect(
      resolveDatabaseRuntimeConfig({
        PG_DATABASE_URL: "postgresql://user:pass@primary:5432/app",
        PG_DATABASE_READ_URL: "postgresql://user:pass@reader:5432/app",
        PG_DATABASE_PRIMARY_POOL_MAX: "7",
        PG_DATABASE_READ_POOL_MAX: "3",
      }),
    ).toMatchObject({ primaryPoolMax: 7, readPoolMax: 3 });
  });

  it.each(["0", "-1", "1.5", "many"])("rejects invalid pool limit %s", (value) => {
    expect(() =>
      resolveDatabaseRuntimeConfig({
        PG_DATABASE_URL: "postgresql://user:pass@primary:5432/app",
        PG_DATABASE_PRIMARY_POOL_MAX: value,
      }),
    ).toThrow(/positive integer/);
  });

  it("rejects a reader pool limit without a reader URL", () => {
    expect(() =>
      resolveDatabaseRuntimeConfig({
        PG_DATABASE_URL: "postgresql://user:pass@primary:5432/app",
        PG_DATABASE_READ_POOL_MAX: "5",
      }),
    ).toThrow(/requires PG_DATABASE_READ_URL/);
  });
});

describe("createPostgresJsDatabaseWithReadReplica", () => {
  beforeEach(() => {
    driverMocks.postgres.mockClear();
    driverMocks.drizzle.mockClear();
  });

  it("returns the primary for reads when no replica is configured", () => {
    const result = createPostgresJsDatabaseWithReadReplica(
      {},
      {
        mode: "postgres",
        primaryUrl: "postgresql://user:pass@primary:5432/app?connection_limit=99",
        primaryPoolMax: 10,
      },
    );

    expect(result.readDb).toBe(result.db);
    expect(driverMocks.postgres).toHaveBeenCalledOnce();
    expect(driverMocks.postgres).toHaveBeenCalledWith(
      "postgresql://user:pass@primary:5432/app",
      expect.objectContaining({
        max: 10,
        prepare: false,
        target_session_attrs: "read-write",
      }),
    );
  });

  it("routes reads to the reader and primary-only operations to the primary", () => {
    const result = createPostgresJsDatabaseWithReadReplica(
      {},
      {
        mode: "postgres",
        primaryUrl: "postgresql://user:pass@primary:5432/app",
        primaryPoolMax: 6,
        readUrl: "postgresql://user:pass@reader:5432/app",
        readPoolMax: 4,
      },
    );

    type StubDatabase = {
      select: () => string;
      insert: () => string;
      transaction: () => string;
      execute: () => string;
      query: { role: string };
    };
    const primary = result.db as unknown as StubDatabase;
    const reader = result.readDb as unknown as StubDatabase;

    expect(reader.select()).toBe("read-only:select");
    expect(reader.query).toEqual({ role: "read-only" });
    expect(reader.insert()).toBe("read-write:insert");
    expect(reader.transaction()).toBe("read-write:transaction");
    expect(reader.execute()).toBe("read-write:execute");
    expect(primary.select()).toBe("read-write:select");
    expect(driverMocks.postgres).toHaveBeenNthCalledWith(
      2,
      "postgresql://user:pass@reader:5432/app",
      expect.objectContaining({
        max: 4,
        prepare: false,
        target_session_attrs: "read-only",
      }),
    );
  });

  it("surfaces reader failures without falling back to the primary", () => {
    const result = createPostgresJsDatabaseWithReadReplica(
      {},
      {
        mode: "postgres",
        primaryUrl: "postgresql://user:pass@primary:5432/app",
        primaryPoolMax: 5,
        readUrl: "postgresql://user:pass@reader:5432/app",
        readPoolMax: 5,
      },
    );
    type StubDatabase = {
      select: Mock<() => string>;
      $replicas: Array<{ select: Mock<() => string> }>;
    };
    const primary = result.db as unknown as StubDatabase;
    const reader = result.readDb as unknown as StubDatabase;
    reader.$replicas[0]?.select.mockImplementation(() => {
      throw new Error("reader unavailable");
    });

    expect(() => reader.select()).toThrow("reader unavailable");
    expect(primary.select).not.toHaveBeenCalled();
  });
});
