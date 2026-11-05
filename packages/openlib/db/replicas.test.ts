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

import {
  createGuardedPostgresClient,
  createPostgresJsDatabaseWithReadReplica,
  DEFAULT_POSTGRES_TIMEOUTS,
  resolveDatabaseRuntimeConfig,
} from "./replicas";

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
      timeouts: DEFAULT_POSTGRES_TIMEOUTS,
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
      timeouts: DEFAULT_POSTGRES_TIMEOUTS,
    });
  });

  it("leaves the server-side waits alone unless they are asked for", () => {
    const config = resolveDatabaseRuntimeConfig({
      PG_DATABASE_URL: "postgresql://user:pass@primary:5432/app",
    });

    expect(config.mode).toBe("postgres");
    // A startup parameter a pooler does not proxy fails the handshake, so an
    // unconfigured deployment must not send one.
    expect(config.mode === "postgres" ? config.timeouts : undefined).toEqual({
      statementTimeoutMs: 0,
      lockTimeoutMs: 0,
      idleInTransactionTimeoutMs: 0,
    });
  });

  it("supports explicit timeouts, including 0 to disable a guard", () => {
    const config = resolveDatabaseRuntimeConfig({
      PG_DATABASE_URL: "postgresql://user:pass@primary:5432/app",
      PG_DATABASE_STATEMENT_TIMEOUT_MS: "900000",
      PG_DATABASE_LOCK_TIMEOUT_MS: "0",
      PG_DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: "5000",
    });

    expect(config.mode === "postgres" ? config.timeouts : undefined).toEqual({
      statementTimeoutMs: 900_000,
      lockTimeoutMs: 0,
      idleInTransactionTimeoutMs: 5_000,
    });
  });

  it.each(["-1", "1.5", "soon"])("rejects invalid timeout %s", (value) => {
    expect(() =>
      resolveDatabaseRuntimeConfig({
        PG_DATABASE_URL: "postgresql://user:pass@primary:5432/app",
        PG_DATABASE_STATEMENT_TIMEOUT_MS: value,
      }),
    ).toThrow(/non-negative integer/);
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

describe("createGuardedPostgresClient", () => {
  const creationOptions = () => driverMocks.postgres.mock.calls[0]?.[1] as Record<string, unknown>;

  beforeEach(() => {
    driverMocks.postgres.mockClear();
  });

  it("applies the client-side guards but no startup parameters by default", () => {
    createGuardedPostgresClient("postgresql://user:pass@primary:5432/app");

    expect(creationOptions()).toEqual({
      connect_timeout: 30,
      idle_timeout: 60,
      max_lifetime: 1_800,
    });
  });

  it("sends the ceilings when they are enabled", () => {
    createGuardedPostgresClient(
      "postgresql://user:pass@primary:5432/app",
      {},
      {
        statementTimeoutMs: 120_000,
        lockTimeoutMs: 30_000,
        idleInTransactionTimeoutMs: 120_000,
      },
    );

    expect(creationOptions().connection).toEqual({
      statement_timeout: "120000ms",
      lock_timeout: "30000ms",
      idle_in_transaction_session_timeout: "120000ms",
    });
  });

  it("keeps a guard the caller passes and drops the ones left at 0", () => {
    createGuardedPostgresClient(
      "postgresql://user:pass@primary:5432/app",
      { connection: { application_name: "worker" } },
      { statementTimeoutMs: 0, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 0 },
    );

    expect(creationOptions().connection).toEqual({
      application_name: "worker",
      lock_timeout: "2000ms",
    });
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
        // Without these the client waits on a dead socket forever.
        connect_timeout: 30,
        idle_timeout: 60,
        max_lifetime: 1_800,
      }),
    );
    // No startup parameters unless configured: a pooler rejects them and the
    // connection never opens.
    expect(driverMocks.postgres.mock.calls[0]?.[1]).not.toHaveProperty("connection");
  });

  it("sends the server-side ceilings when the config enables them", () => {
    createPostgresJsDatabaseWithReadReplica(
      {},
      {
        mode: "postgres",
        primaryUrl: "postgresql://user:pass@primary:5432/app",
        primaryPoolMax: 3,
        timeouts: {
          statementTimeoutMs: 120_000,
          lockTimeoutMs: 30_000,
          idleInTransactionTimeoutMs: 120_000,
        },
      },
    );

    expect(driverMocks.postgres.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        connection: {
          statement_timeout: "120000ms",
          lock_timeout: "30000ms",
          idle_in_transaction_session_timeout: "120000ms",
        },
      }),
    );
  });

  it("omits a disabled guard from the startup parameters", () => {
    createPostgresJsDatabaseWithReadReplica(
      {},
      {
        mode: "postgres",
        primaryUrl: "postgresql://user:pass@primary:5432/app",
        primaryPoolMax: 2,
        timeouts: { statementTimeoutMs: 0, lockTimeoutMs: 0, idleInTransactionTimeoutMs: 0 },
      },
    );

    expect(driverMocks.postgres).toHaveBeenCalledWith(
      "postgresql://user:pass@primary:5432/app",
      expect.not.objectContaining({ connection: expect.anything() }),
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
        timeouts: {
          statementTimeoutMs: 120_000,
          lockTimeoutMs: 30_000,
          idleInTransactionTimeoutMs: 120_000,
        },
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
        connection: expect.objectContaining({ lock_timeout: "30000ms" }),
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
