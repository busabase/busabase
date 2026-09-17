import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresJsDatabaseWithReadReplica } from "./replicas";

const primaryUrl = process.env.PG_REPLICA_TEST_PRIMARY_URL?.trim();
const readUrl = process.env.PG_REPLICA_TEST_READ_URL?.trim();
const skipIntegration = !primaryUrl && !readUrl;

type CloseableClient = {
  end(options?: { timeout?: number }): Promise<void>;
};

type ReplicaBackedDatabase = {
  $replicas: Array<{ $client: CloseableClient }>;
};

describe.skipIf(skipIntegration)("PostgreSQL read replica routing", () => {
  let databases: ReturnType<typeof createPostgresJsDatabaseWithReadReplica>;
  let primaryClient: CloseableClient | undefined;
  let readClient: CloseableClient | undefined;

  beforeAll(() => {
    if (!primaryUrl || !readUrl) {
      throw new Error(
        "PG_REPLICA_TEST_PRIMARY_URL and PG_REPLICA_TEST_READ_URL must be configured together.",
      );
    }

    databases = createPostgresJsDatabaseWithReadReplica(
      {},
      {
        mode: "postgres",
        primaryUrl,
        primaryPoolMax: 1,
        readUrl,
        readPoolMax: 1,
      },
    );
    primaryClient = databases.db.$client;

    const replicas = (databases.readDb as unknown as Partial<ReplicaBackedDatabase>).$replicas;
    if (!replicas?.[0]) {
      throw new Error("Expected the read database to contain a configured replica.");
    }
    readClient = replicas[0].$client;
  });

  afterAll(async () => {
    await Promise.all([primaryClient?.end({ timeout: 5 }), readClient?.end({ timeout: 5 })]);
  });

  it("routes primary and replica selects to their configured database roles", async () => {
    const primaryRows = await databases.db
      .select({ readOnly: sql<string>`current_setting('transaction_read_only')` })
      .from(sql`(SELECT 1) AS role_probe`);
    const replicaRows = await databases.readDb
      .select({ readOnly: sql<string>`current_setting('transaction_read_only')` })
      .from(sql`(SELECT 1) AS role_probe`);

    expect(primaryRows[0]?.readOnly).toBe("off");
    expect(replicaRows[0]?.readOnly).toBe("on");
  });

  it("keeps raw execute on the primary", async () => {
    const rows = await databases.readDb.execute<{ read_only: string }>(sql`
      SELECT current_setting('transaction_read_only') AS read_only
    `);

    expect(rows[0]?.read_only).toBe("off");
  });

  it("keeps transactions on the primary", async () => {
    const readOnly = await databases.readDb.transaction(async (tx) => {
      const rows = await tx.execute<{ read_only: string }>(sql`
        SELECT current_setting('transaction_read_only') AS read_only
      `);
      return rows[0]?.read_only;
    });

    expect(readOnly).toBe("off");
  });
});
