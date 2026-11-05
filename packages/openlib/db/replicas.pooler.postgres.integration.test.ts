import net from "node:net";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPostgresJsDatabaseWithReadReplica, type PostgresTimeoutConfig } from "./replicas";

/**
 * Real-PostgreSQL proof for the PgBouncer/Supavisor case: the endpoint answers
 * `FATAL 08P01 unsupported startup parameter: statement_timeout` to every
 * connection that asks for server-side ceilings, before authentication —
 * which used to make `db:migrate:deploy` fail before it ran a single statement.
 *
 * That is why the ceilings are opt-in. With nothing configured the client sends
 * no startup parameter and connects through any pooler; when they *are*
 * configured on such an endpoint the failure is immediate and names the
 * offending parameter instead of surfacing later as an unrelated query error.
 *
 * `PG_TIMEOUT_TEST_URL` must point at a PostgreSQL database the test may query.
 */
const upstreamUrl = process.env.PG_TIMEOUT_TEST_URL?.trim();
const skipIntegration = !upstreamUrl;

const SSL_REQUEST_CODE = 80877103;
const GUARDED_STARTUP_PARAMETERS = new Set([
  "statement_timeout",
  "lock_timeout",
  "idle_in_transaction_session_timeout",
]);

const protocolField = (code: string, value: string) => Buffer.from(`${code}${value}\0`, "utf8");

/** What PgBouncer sends when it does not know a startup parameter. */
const unsupportedStartupParameterResponse = (parameter: string) => {
  const fields = Buffer.concat([
    protocolField("S", "FATAL"),
    protocolField("V", "FATAL"),
    protocolField("C", "08P01"),
    protocolField("M", `unsupported startup parameter: ${parameter}`),
    Buffer.from([0]),
  ]);
  const header = Buffer.alloc(5);
  header.write("E", 0, "latin1");
  header.writeInt32BE(fields.length + 4, 1);
  return Buffer.concat([header, fields]);
};

const startupParameterNames = (packet: Buffer) => {
  const names: string[] = [];
  let offset = 8; // int32 length + int32 protocol version
  while (offset < packet.length) {
    const nameEnd = packet.indexOf(0, offset);
    if (nameEnd <= offset) break;
    names.push(packet.subarray(offset, nameEnd).toString("utf8"));
    const valueEnd = packet.indexOf(0, nameEnd + 1);
    if (valueEnd === -1) break;
    offset = valueEnd + 1;
  }
  return names;
};

/** Drizzle wraps driver errors, so the pooler's message sits on the cause. */
const errorChain = (error: unknown): string => {
  const messages: string[] = [];
  let current = error as { message?: unknown; cause?: unknown } | null;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current.message === "string") messages.push(current.message);
    current = (current.cause ?? null) as { message?: unknown; cause?: unknown } | null;
  }
  return messages.join(" | ");
};

type FakePooler = {
  url: string;
  rejectedConnections: number;
  close(): Promise<void>;
};

/**
 * A minimal PgBouncer look-alike: forwards the raw protocol to the real server,
 * except that it rejects any startup packet carrying an unknown parameter.
 */
async function startFakePooler(upstream: URL): Promise<FakePooler> {
  let rejectedConnections = 0;
  const sockets = new Set<net.Socket>();
  const pooler = { rejectedConnections: 0 } as FakePooler;

  const forward = (client: net.Socket, startupPacket: Buffer, alreadyRead: Buffer) => {
    const upstreamSocket = net.connect(Number(upstream.port), upstream.hostname);
    sockets.add(client);
    sockets.add(upstreamSocket);

    upstreamSocket.write(startupPacket);
    if (alreadyRead.length > 0) upstreamSocket.write(alreadyRead);
    upstreamSocket.on("data", (chunk) => client.write(chunk));
    client.on("data", (chunk) => upstreamSocket.write(chunk));
    const close = () => {
      client.destroy();
      upstreamSocket.destroy();
      sockets.delete(client);
      sockets.delete(upstreamSocket);
    };
    upstreamSocket.on("close", close);
    client.on("close", close);
    upstreamSocket.on("error", close);
    client.on("error", close);
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffered = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const length = buffered.readInt32BE(0);
        if (buffered.length < length) return;
        const packet = buffered.subarray(0, length);
        buffered = buffered.subarray(length);

        if (packet.length >= 8 && packet.readInt32BE(4) === SSL_REQUEST_CODE) {
          socket.write("N"); // no TLS in front of the local test server
          continue;
        }

        const parameters = startupParameterNames(packet);
        const rejected = parameters.find((name) => GUARDED_STARTUP_PARAMETERS.has(name));
        if (rejected) {
          rejectedConnections += 1;
          pooler.rejectedConnections = rejectedConnections;
          socket.end(unsupportedStartupParameterResponse(rejected));
          return;
        }

        socket.off("data", onData);
        forward(socket, packet, buffered);
        return;
      }
    };

    socket.on("data", onData);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a bound TCP port.");
  pooler.url = `postgresql://${upstream.username}${upstream.password ? `:${upstream.password}` : ""}@127.0.0.1:${address.port}${upstream.pathname}${upstream.search}`;
  pooler.close = async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return pooler;
}

describe.skipIf(skipIntegration)(
  "PostgreSQL behind a pooler that rejects startup parameters",
  () => {
    let pooler: FakePooler;
    let databases: ReturnType<typeof createPostgresJsDatabaseWithReadReplica> | undefined;

    const ENABLED_CEILINGS: PostgresTimeoutConfig = {
      statementTimeoutMs: 120_000,
      lockTimeoutMs: 30_000,
      idleInTransactionTimeoutMs: 120_000,
    };

    const connect = (timeouts?: PostgresTimeoutConfig) => {
      databases = createPostgresJsDatabaseWithReadReplica(
        {},
        { mode: "postgres", primaryUrl: pooler.url, primaryPoolMax: 1, timeouts },
      );
      return databases.db;
    };

    beforeAll(async () => {
      const upstream = new URL(upstreamUrl as string);
      for (const key of ["sslmode", "ssl", "statement_timeout", "lock_timeout"]) {
        upstream.searchParams.delete(key);
      }
      pooler = await startFakePooler(upstream);
    });

    afterEach(async () => {
      await databases?.db.$client.end({ timeout: 5 });
      databases = undefined;
      pooler.rejectedConnections = 0;
    });

    afterAll(async () => {
      await pooler.close();
    });

    it("connects with no startup parameters when nothing is configured", async () => {
      const db = connect();

      // The very first statement of `db:migrate:deploy` used to die here.
      const rows = await db
        .select({ statementTimeout: sql<string>`current_setting('statement_timeout')` })
        .from(sql`(SELECT 1) AS guard_probe`);

      expect(rows[0]?.statementTimeout).toBe("0");
      expect(pooler.rejectedConnections).toBe(0);
    });

    it("keeps transactions working through a pooler left at the defaults", async () => {
      const db = connect();

      const result = await db.transaction(async (transaction) => {
        const rows = await transaction.execute<{ one: number }>(sql`SELECT 1 AS one`);
        return rows[0]?.one;
      });

      expect(result).toBe(1);
      expect(pooler.rejectedConnections).toBe(0);
    });

    it("fails immediately, naming the parameter, when the ceilings are enabled here", async () => {
      const db = connect(ENABLED_CEILINGS);

      const failure = await db
        .select({ one: sql<number>`1` })
        .from(sql`(SELECT 1) AS guard_probe`)
        .then(() => undefined)
        .catch((error: unknown) => error);

      expect(errorChain(failure)).toMatch(
        /unsupported startup parameter: (statement|lock)_timeout/,
      );
      expect(pooler.rejectedConnections).toBeGreaterThan(0);
    });

    it("reproduces the reported shape for a bare client that keeps the startup parameters", async () => {
      // Unwrapped postgres.js + the ceilings is exactly what shipped in #8347 and
      // broke `db:migrate:deploy`; this keeps the fake pooler honest.
      const client = postgres(pooler.url, {
        prepare: false,
        // postgres.js types this as number but serialises whatever it is given;
        // the value the factory sends is the "120000ms" string form.
        connection: { statement_timeout: "120000ms" as unknown as number },
      });

      await expect(client.unsafe("SELECT 1 AS one")).rejects.toThrow(
        /unsupported startup parameter: statement_timeout/,
      );
      expect(pooler.rejectedConnections).toBeGreaterThan(0);

      await client.end({ timeout: 1 });
    });
  },
);
