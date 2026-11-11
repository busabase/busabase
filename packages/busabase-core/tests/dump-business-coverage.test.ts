import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { type DumpTable, DumpTableSchema } from "busabase-contract/domains/dump/types";
import { eq } from "drizzle-orm";
import { resetStorage, storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseNodes } from "../src/db/schema";
import { isRestoreAutomationBlocked } from "../src/domains/dump/logic/restore-activity";
import { RestoreBlobParts } from "../src/domains/dump/logic/restore-blob-parts";
import { prepareWebhookBackupRow } from "../src/domains/dump/logic/row-policy";
import { DUMP_IMPORT_ORDER, DUMP_TABLE_REGISTRY } from "../src/domains/dump/logic/table-registry";
import { rootNodeIdForSpace } from "../src/logic/kernel";
import { hashSharePassword, verifySharePassword } from "../src/logic/node-share";
import { busabaseRouter } from "../src/router";
import { createDumpBusinessFixture } from "./helpers/dump-business-fixture";

type Row = Record<string, unknown>;
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const client = createRouterClient(busabaseRouter);
const inSpace = <T>(spaceId: string, work: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId }, work);
const extraTables = [
  "nodeShares",
  "favorites",
  "nodeSubscriptions",
  "spaceInstructions",
  "spaceWelcome",
  "embedLinks",
  "forms",
  "commentMentions",
  "workflowRuns",
  "workflowTriggers",
  "webhookRules",
  "webhookDeliveries",
  "agentSessions",
  "agentSessionEvents",
  "agentSessionCommands",
  "routerGrants",
  "routerConnections",
] as const;
const closeDb = async () => {
  const globals = globalThis as typeof globalThis & {
    __busabaseCoreDbState?: {
      db: unknown;
      client: { close?: () => Promise<void> } | null;
      initPromise: unknown;
    };
    __busabaseReadyBySpace?: Map<string, Promise<void>>;
  };
  await globals.__busabaseCoreDbState?.client?.close?.();
  globals.__busabaseCoreDbState = { db: null, client: null, initPromise: null };
  globals.__busabaseReadyBySpace = new Map();
};
const exportRows = async (spaceId: string, table: DumpTable) => {
  const rows: Row[] = [];
  let cursor: string | undefined;
  do {
    const page = await inSpace(spaceId, () =>
      client.dump.exportTables({ table, limit: 1, cursor }),
    );
    rows.push(...plain(page.rows));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return rows;
};
const importFixture = async (
  spaceId: string,
  sessionId: string,
  fixture: Record<string, Row[]>,
) => {
  for (const table of DUMP_IMPORT_ORDER)
    if (fixture[table]?.length)
      await inSpace(spaceId, () =>
        client.dump.importTables({ sessionId, table, rows: plain(fixture[table]) }),
      );
};

describe("business-table completeness with real PGLite", () => {
  let cwd: string;
  let storageDir: string;
  const dirs: string[] = [];
  const source = "dump35-source";
  const target = "dump35-target";
  const foreign = "dump35-foreign";
  const sourceRows = new Map<DumpTable, Row[]>();
  const targetRows = new Map<DumpTable, Row[]>();
  let passwordHash: string;

  beforeAll(async () => {
    cwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), "dump35-source-"));
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "dump35-target-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "dump35-storage-"));
    dirs.push(sourceDir, targetDir, storageDir);
    process.env.PG_DATABASE_URL = `pglite://${sourceDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    passwordHash = await hashSharePassword("correct backup password");
    for (const [spaceId, prefix] of [
      [source, "owned35"],
      [foreign, "foreign35"],
    ]) {
      await inSpace(spaceId, () => client.nodes.list({}));
      const fixture = createDumpBusinessFixture(spaceId, prefix);
      fixture.nodeShares[0].passwordHash = passwordHash;
      const db = await getDb();
      for (const table of DUMP_IMPORT_ORDER) {
        const rows = (fixture as Record<string, Row[]>)[table];
        if (rows?.length)
          await db.insert(DUMP_TABLE_REGISTRY[table] as never).values(rows as never[]);
      }
    }
    await (await getDb())
      .update(busabaseNodes)
      .set({
        name: "Original custom workspace root",
        metadata: { backupNote: "Original root metadata" },
        description: "Original root description",
      })
      .where(eq(busabaseNodes.id, rootNodeIdForSpace(source)));
    for (const table of DumpTableSchema.options)
      sourceRows.set(table, await exportRows(source, table));
    await closeDb();
    resetStorage();
    process.env.PG_DATABASE_URL = `pglite://${targetDir}`;
    const begin = await inSpace(target, () => client.dump.importBegin({ sourceSpaceId: source }));
    expect(await isRestoreAutomationBlocked(target)).toBe(true);
    for (const table of DUMP_IMPORT_ORDER)
      if (sourceRows.get(table)?.length)
        await inSpace(target, () =>
          client.dump.importTables({
            sessionId: begin.sessionId,
            table,
            rows: sourceRows.get(table) ?? [],
          }),
        );
    const committed = await inSpace(target, () =>
      client.dump.importCommit({ sessionId: begin.sessionId }),
    );
    expect(committed).toEqual({ ok: true, warnings: [] });
    expect(await isRestoreAutomationBlocked(target)).toBe(false);
    for (const table of DumpTableSchema.options)
      targetRows.set(table, await exportRows(target, table));
  }, 120_000);

  afterAll(async () => {
    await closeDb();
    resetStorage();
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(cwd);
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  it("restores all 17 additional tables, exact PO content and real singleton identities", () => {
    expect(DumpTableSchema.options).toHaveLength(35);
    for (const table of extraTables) {
      const expected = sourceRows.get(table) ?? [];
      expect(expected.length, table).toBeGreaterThan(0);
      expect(JSON.stringify(expected), table).not.toContain("foreign35");
      const mapped = expected.map((row) => ({
        ...row,
        ...(Object.hasOwn(row, "spaceId") ? { spaceId: target } : {}),
        ...(table === "routerGrants" ? { busabaseSpaceId: target } : {}),
      }));
      expect(targetRows.get(table), table).toEqual(mapped);
    }
    for (const table of ["spaceInstructions", "spaceWelcome"] as const) {
      expect(sourceRows.get(table)?.[0]).not.toHaveProperty("id");
      expect(targetRows.get(table)?.[0].spaceId).toBe(target);
    }
    expect(targetRows.get("nodeShares")?.[0].passwordHash).toBe(passwordHash);
    expect(targetRows.get("agentSessionEvents")?.[0]).not.toHaveProperty("spaceId");
    expect(targetRows.get("commentMentions")?.[0]).not.toHaveProperty("spaceId");
    expect(targetRows.get("routerConnections")?.[0]).not.toHaveProperty("spaceId");
  });

  it("preserves a working password gate after restoration", async () => {
    const hash = targetRows.get("nodeShares")?.[0].passwordHash as string;
    expect(await verifySharePassword("correct backup password", hash)).toBe(true);
    expect(await verifySharePassword("wrong password", hash)).toBe(false);
  });

  it("preserves root PO content and safely replays all singleton and indirect-scope rows on resume", async () => {
    expect(
      targetRows.get("nodes")?.find((row) => row.id === rootNodeIdForSpace(target)),
    ).toMatchObject({
      name: "Original custom workspace root",
      description: "Original root description",
      metadata: { backupNote: "Original root metadata" },
    });
    const begun = await inSpace(target, () =>
      client.dump.importBegin({ sourceSpaceId: source, resume: true }),
    );
    for (const table of DUMP_IMPORT_ORDER)
      if (sourceRows.get(table)?.length) {
        const result = await inSpace(target, () =>
          client.dump.importTables({
            sessionId: begun.sessionId,
            table,
            rows: sourceRows.get(table) ?? [],
          }),
        );
        expect(result.inserted, table).toBe(0);
      }
    expect(
      await inSpace(target, () => client.dump.importCommit({ sessionId: begun.sessionId })),
    ).toEqual({ ok: true, warnings: [] });
  });

  it("retains original ACL verifiers and explicitly disables omitted managed credentials", async () => {
    const spaceId = "dump35-credential-policy";
    const fixture = createDumpBusinessFixture(spaceId, "policy35");
    const secret = {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: "iv",
      tag: "tag",
      ciphertext: "encrypted-managed-secret",
    };
    const sourceRule = {
      ...fixture.webhookRules[0],
      enabled: true,
      config: { ...fixture.webhookRules[0].config, secret },
    };
    const projected = prepareWebhookBackupRow(sourceRule);
    expect(JSON.stringify(projected)).not.toContain("encrypted-managed-secret");
    expect(projected).toMatchObject({
      enabled: false,
      config: {
        targetUrl: "https://fixture.invalid/hook",
        headers: { "X-Fixture": "kept" },
        __busabaseBackup: {
          version: 1,
          sourceEnabled: true,
          secretOmitted: true,
          requiresReconnect: true,
        },
      },
    });
    expect(prepareWebhookBackupRow(projected)).toEqual(projected);
    const begin = await inSpace(spaceId, () => client.dump.importBegin({ sourceSpaceId: spaceId }));
    await importFixture(spaceId, begin.sessionId, {
      ...fixture,
      webhookRules: [sourceRule],
      routerGrants: [{ ...fixture.routerGrants[0], revokedAt: null }],
      embedLinks: [{ ...fixture.embedLinks[0], revokedAt: null }],
    });
    const committed = await inSpace(spaceId, () =>
      client.dump.importCommit({ sessionId: begin.sessionId }),
    );
    expect(committed.ok).toBe(true);
    expect(committed.warnings).toEqual([]);
    expect(committed.notices).toHaveLength(3);
    const [storedRule] = await (await getDb())
      .select()
      .from(DUMP_TABLE_REGISTRY.webhookRules)
      .where(eq(DUMP_TABLE_REGISTRY.webhookRules.id, fixture.webhookRules[0].id));
    expect(storedRule.enabled).toBe(false);
    expect(storedRule.config).not.toHaveProperty("secret");
    expect(await exportRows(spaceId, "webhookRules")).toEqual([
      plain({ ...projected, lastStatus: null, lastTriggeredAt: null }),
    ]);
    const grant = (await exportRows(spaceId, "routerGrants"))[0];
    expect(grant.revokedAt).not.toBeNull();
    expect(grant.tokenVaultItemId).toBe(fixture.routerGrants[0].tokenVaultItemId);
    const embed = (await exportRows(spaceId, "embedLinks"))[0];
    expect(embed.revokedAt).not.toBeNull();
    expect(embed.secretHash).toBe(fixture.embedLinks[0].secretHash);
    expect(embed.allowedOrigins).toEqual(fixture.embedLinks[0].allowedOrigins);
    expect(embed.frameMode).toBe("origins");
    expect((await exportRows(spaceId, "nodeShares"))[0].passwordHash).toBe(
      fixture.nodeShares[0].passwordHash,
    );
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(false);
  });

  it("rejects foreign-parent child rows before any insert, including resumed collisions", async () => {
    const spaceId = "dump35-foreign-injection";
    const begin = await inSpace(spaceId, () => client.dump.importBegin({ sourceSpaceId: spaceId }));
    for (const [table, row] of [
      ["commentMentions", { ...sourceRows.get("commentMentions")?.[0], id: "bad-mention" }],
      [
        "agentSessionEvents",
        { ...sourceRows.get("agentSessionEvents")?.[0], id: "bad-event", seq: 99 },
      ],
      ["routerConnections", { ...sourceRows.get("routerConnections")?.[0], id: "bad-connection" }],
    ] as const) {
      await expect(
        inSpace(spaceId, () =>
          client.dump.importTables({ sessionId: begin.sessionId, table, rows: [row] }),
        ),
      ).rejects.toThrow(/target space/i);
      expect(await exportRows(spaceId, table)).toEqual([]);
    }
    const own = createDumpBusinessFixture(spaceId, "isolation35");
    await inSpace(spaceId, () =>
      client.dump.importTables({
        sessionId: begin.sessionId,
        table: "nodes",
        rows: plain(own.nodes),
      }),
    );
    for (const table of [
      "nodeShares",
      "favorites",
      "nodeSubscriptions",
      "agentSessionCommands",
    ] as const) {
      const foreignRow = { ...(sourceRows.get(table)?.[0] ?? {}), id: `bad-${table}` };
      await expect(
        inSpace(spaceId, () =>
          client.dump.importTables({ sessionId: begin.sessionId, table, rows: [foreignRow] }),
        ),
      ).rejects.toThrow(/target space/i);
      expect(await exportRows(spaceId, table)).toEqual([]);
    }
    // Keep the form's node in this space so specifically its foreign Base is rejected.
    await expect(
      inSpace(spaceId, () =>
        client.dump.importTables({
          sessionId: begin.sessionId,
          table: "forms",
          rows: [
            {
              ...(sourceRows.get("forms")?.[0] ?? {}),
              id: "bad-form",
              nodeId: own.forms[0].nodeId,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/targetBaseId.*target space/i);
    expect(await exportRows(spaceId, "forms")).toEqual([]);
    await inSpace(spaceId, () => client.dump.importAbort({ sessionId: begin.sessionId }));
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(false);
  });

  it("holds incomplete commits recoverably and treats a legitimate root-only archive as complete", async () => {
    const spaceId = "dump35-incomplete";
    const before = await inSpace(spaceId, () => client.nodes.list({}));
    const begin = await inSpace(spaceId, () => client.dump.importBegin({ sourceSpaceId: spaceId }));
    const incomplete = await inSpace(spaceId, () =>
      client.dump.importCommit({ sessionId: begin.sessionId }),
    );
    expect(incomplete.ok).toBe(false);
    expect(incomplete.warnings.length).toBeGreaterThan(0);
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(true);
    await inSpace(spaceId, () =>
      client.dump.importTables({
        sessionId: begin.sessionId,
        table: "nodes",
        rows: [
          {
            id: rootNodeIdForSpace(spaceId),
            spaceId,
            type: "folder",
            parentId: null,
            name: "Recovered empty workspace",
            slug: "root",
          },
        ],
      }),
    );
    expect(
      await inSpace(spaceId, () => client.dump.importCommit({ sessionId: begin.sessionId })),
    ).toEqual({ ok: true, warnings: [] });
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(false);
    expect((await inSpace(spaceId, () => client.nodes.list({})))[0].id).toBe(before[0].id);
  });

  it("rechecks missing bytes after resume replays only already-landed rows", async () => {
    const spaceId = "dump35-resume-missing-bytes";
    const row = {
      id: "att_resume_missing_bytes",
      spaceId,
      userId: "fixture-user",
      storageKey: "attachments/resume-missing-bytes.txt",
      fileName: "resume.txt",
      mimeType: "text/plain",
      sizeBytes: 7,
    };
    const node = {
      id: "nod_resume_missing_bytes",
      spaceId,
      parentId: rootNodeIdForSpace(spaceId),
      type: "doc",
      slug: "resume-integrity",
      name: "Resumed document",
    };
    const first = await inSpace(spaceId, () => client.dump.importBegin({ sourceSpaceId: spaceId }));
    await inSpace(spaceId, () =>
      client.dump.importTables({ sessionId: first.sessionId, table: "nodes", rows: [node] }),
    );
    await inSpace(spaceId, () =>
      client.dump.importTables({ sessionId: first.sessionId, table: "attachments", rows: [row] }),
    );
    const failed = await inSpace(spaceId, () =>
      client.dump.importCommit({ sessionId: first.sessionId }),
    );
    expect(failed.ok).toBe(false);
    expect(failed.warnings.join(" ")).toMatch(/attachment.*no bytes/i);
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(true);
    const resumed = await inSpace(spaceId, () =>
      client.dump.importBegin({ sourceSpaceId: spaceId, resume: true }),
    );
    for (const [table, rows] of [
      ["nodes", [node]],
      ["attachments", [row]],
    ] as const) {
      expect(
        await inSpace(spaceId, () =>
          client.dump.importTables({ sessionId: resumed.sessionId, table, rows: [...rows] }),
        ),
      ).toEqual({ inserted: 0 });
    }
    const stillIncomplete = await inSpace(spaceId, () =>
      client.dump.importCommit({ sessionId: resumed.sessionId }),
    );
    expect(stillIncomplete.ok).toBe(false);
    expect(stillIncomplete.warnings.join(" ")).toMatch(/attachment.*no bytes/i);
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(true);
    await storage.uploadFileToKey(Buffer.from("restored"), row.storageKey, row.mimeType);
    expect(
      await inSpace(spaceId, () => client.dump.importCommit({ sessionId: resumed.sessionId })),
    ).toEqual({ ok: true, warnings: [] });
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(false);
  });

  it("rechecks already-landed loose attachment references after resume", async () => {
    const spaceId = "dump35-resume-orphan-asset";
    const node = {
      id: "nod_resume_orphan_asset",
      spaceId,
      parentId: rootNodeIdForSpace(spaceId),
      type: "doc",
      slug: "orphan-resume",
      name: "Resumed document",
    };
    const asset = {
      id: "ast_resume_orphan",
      spaceId,
      attachmentId: "att_resume_orphan",
      name: "Unregistered asset",
    };
    const first = await inSpace(spaceId, () => client.dump.importBegin({ sourceSpaceId: spaceId }));
    await inSpace(spaceId, () =>
      client.dump.importTables({ sessionId: first.sessionId, table: "nodes", rows: [node] }),
    );
    await inSpace(spaceId, () =>
      client.dump.importTables({ sessionId: first.sessionId, table: "assets", rows: [asset] }),
    );
    expect(
      (await inSpace(spaceId, () => client.dump.importCommit({ sessionId: first.sessionId }))).ok,
    ).toBe(false);
    const resumed = await inSpace(spaceId, () =>
      client.dump.importBegin({ sourceSpaceId: spaceId, resume: true }),
    );
    expect(
      await inSpace(spaceId, () =>
        client.dump.importTables({ sessionId: resumed.sessionId, table: "assets", rows: [asset] }),
      ),
    ).toEqual({ inserted: 0 });
    const incomplete = await inSpace(spaceId, () =>
      client.dump.importCommit({ sessionId: resumed.sessionId }),
    );
    expect(incomplete.ok).toBe(false);
    expect(incomplete.warnings.join(" ")).toMatch(/attachmentId that was not imported/);
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(true);
    await storage.uploadFileToKey(
      Buffer.from("asset"),
      "attachments/resume-orphan.txt",
      "text/plain",
    );
    await inSpace(spaceId, () =>
      client.dump.importTables({
        sessionId: resumed.sessionId,
        table: "attachments",
        rows: [
          {
            id: asset.attachmentId,
            spaceId,
            userId: "fixture-user",
            storageKey: "attachments/resume-orphan.txt",
            fileName: "asset.txt",
            mimeType: "text/plain",
            sizeBytes: 5,
          },
        ],
      }),
    );
    expect(
      (await inSpace(spaceId, () => client.dump.importCommit({ sessionId: resumed.sessionId }))).ok,
    ).toBe(true);
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(false);
  });

  it("scans a later attachment-key page and independently rechecks derived text on resume", async () => {
    const spaceId = "dump35-resume-key-pages";
    const node = {
      id: "nod_resume_key_pages",
      spaceId,
      parentId: rootNodeIdForSpace(spaceId),
      type: "doc",
      slug: "key-pages",
      name: "Paged key inventory",
    };
    const presentKey = "attachments/resume-page-present.txt";
    const missingKey = "attachments/resume-page-missing.txt";
    await storage.uploadFileToKey(Buffer.from("present"), presentKey, "text/plain");
    const rows = Array.from({ length: 502 }, (_, index) => ({
      id: `att_resume_page_${String(index).padStart(4, "0")}`,
      spaceId,
      userId: "fixture-user",
      storageKey: index === 501 ? missingKey : presentKey,
      fileName: "page.txt",
      mimeType: "text/plain",
      sizeBytes: 7,
    }));
    const assets = [
      { id: "ast_resume_text", spaceId, attachmentId: rows[0].id, name: "Derived text" },
      { id: "ast_resume_none", spaceId, attachmentId: rows[0].id, name: "No extracted text" },
    ];
    const textKey = "asset-texts/resume-derived-missing.txt";
    const texts = [
      {
        id: "text_resume_present",
        spaceId,
        assetId: assets[0].id,
        status: "present",
        textStorageKey: textKey,
      },
      {
        id: "text_resume_none",
        spaceId,
        assetId: assets[1].id,
        status: "none",
        textStorageKey: "",
      },
    ];
    const first = await inSpace(spaceId, () => client.dump.importBegin({ sourceSpaceId: spaceId }));
    for (const [table, batch] of [
      ["nodes", [node]],
      ["attachments", rows],
      ["assets", assets],
      ["assetTexts", texts],
    ] as const)
      await inSpace(spaceId, () =>
        client.dump.importTables({ sessionId: first.sessionId, table, rows: [...batch] }),
      );
    expect(
      (await inSpace(spaceId, () => client.dump.importCommit({ sessionId: first.sessionId }))).ok,
    ).toBe(false);
    const resumed = await inSpace(spaceId, () =>
      client.dump.importBegin({ sourceSpaceId: spaceId, resume: true }),
    );
    for (const [table, batch] of [
      ["attachments", rows],
      ["assets", assets],
      ["assetTexts", texts],
    ] as const)
      expect(
        await inSpace(spaceId, () =>
          client.dump.importTables({ sessionId: resumed.sessionId, table, rows: [...batch] }),
        ),
      ).toEqual({ inserted: 0 });
    const bothMissing = await inSpace(spaceId, () =>
      client.dump.importCommit({ sessionId: resumed.sessionId }),
    );
    expect(bothMissing.ok).toBe(false);
    expect(bothMissing.warnings).toHaveLength(2);
    expect(bothMissing.warnings.join(" ")).toMatch(/1 attachment\(s\) have no bytes/);
    expect(bothMissing.warnings.join(" ")).toMatch(/1 assetTexts row\(s\) have no bytes/);
    await storage.uploadFileToKey(Buffer.from("present"), missingKey, "text/plain");
    const onlyTextMissing = await inSpace(spaceId, () =>
      client.dump.importCommit({ sessionId: resumed.sessionId }),
    );
    expect(onlyTextMissing.ok).toBe(false);
    expect(onlyTextMissing.warnings).toHaveLength(1);
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(true);
    await storage.uploadFileToKey(Buffer.from("derived"), textKey, "text/plain");
    expect(
      (await inSpace(spaceId, () => client.dump.importCommit({ sessionId: resumed.sessionId }))).ok,
    ).toBe(true);
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(false);
  });

  it("retains recovery ownership when final cleanup hits a real object-storage IO error", async () => {
    const spaceId = "dump35-finalize-io";
    const begin = await inSpace(spaceId, () => client.dump.importBegin({ sourceSpaceId: spaceId }));
    await inSpace(spaceId, () =>
      client.dump.importTables({
        sessionId: begin.sessionId,
        table: "nodes",
        rows: [
          {
            id: rootNodeIdForSpace(spaceId),
            spaceId,
            type: "folder",
            parentId: null,
            name: "Safe recovered root",
            slug: "root",
          },
        ],
      }),
    );
    // Put a directory where unlink expects an object file, producing a real
    // EISDIR from the local storage provider at the final cleanup boundary.
    const brokenKey = "cleanup-io-error.bin";
    await mkdir(path.join(storageDir, brokenKey));
    const cleanup = vi
      .spyOn(RestoreBlobParts.prototype, "cleanup")
      .mockImplementationOnce(() => storage.deleteObject(brokenKey));
    try {
      await expect(
        inSpace(spaceId, () => client.dump.importCommit({ sessionId: begin.sessionId })),
      ).rejects.toThrow(/EISDIR|directory/i);
      expect(await isRestoreAutomationBlocked(spaceId)).toBe(true);
      // The same session is still usable and the root data has not vanished.
      expect(
        await inSpace(spaceId, () =>
          client.dump.importTables({ sessionId: begin.sessionId, table: "nodes", rows: [] }),
        ),
      ).toEqual({ inserted: 0 });
    } finally {
      cleanup.mockRestore();
      await rm(path.join(storageDir, brokenKey), { recursive: true });
    }
    // A restarted/native --resume path may take ownership after the IO issue
    // is resolved, complete normally and leave no activity/staging objects.
    const resumed = await inSpace(spaceId, () =>
      client.dump.importBegin({ sourceSpaceId: spaceId, resume: true }),
    );
    await inSpace(spaceId, () =>
      client.dump.importTables({
        sessionId: resumed.sessionId,
        table: "nodes",
        rows: [
          {
            id: rootNodeIdForSpace(spaceId),
            spaceId,
            type: "folder",
            parentId: null,
            name: "Safe recovered root",
            slug: "root",
          },
        ],
      }),
    );
    expect(
      await inSpace(spaceId, () => client.dump.importCommit({ sessionId: resumed.sessionId })),
    ).toEqual({ ok: true, warnings: [] });
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(false);
  });

  it("ordinary abort rolls back all added child/singleton rows and restores the original root", async () => {
    const spaceId = "dump35-rollback";
    await inSpace(spaceId, () => client.nodes.list({}));
    const original = await exportRows(spaceId, "nodes");
    const begin = await inSpace(spaceId, () => client.dump.importBegin({ sourceSpaceId: spaceId }));
    await inSpace(spaceId, () =>
      client.dump.importTables({
        sessionId: begin.sessionId,
        table: "nodes",
        rows: [
          {
            id: rootNodeIdForSpace(spaceId),
            spaceId,
            type: "folder",
            parentId: null,
            name: "Temporary restored root",
            slug: "root",
          },
        ],
      }),
    );
    await importFixture(spaceId, begin.sessionId, createDumpBusinessFixture(spaceId, "rollback35"));
    await inSpace(spaceId, () => client.dump.importAbort({ sessionId: begin.sessionId }));
    for (const table of extraTables) expect(await exportRows(spaceId, table), table).toEqual([]);
    expect(await exportRows(spaceId, "nodes")).toEqual(original);
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(false);
  });
});
