import { createHash } from "node:crypto";
import type { createRouterClient } from "@orpc/server";
import { type DumpTable, DumpTableSchema } from "busabase-contract/domains/dump/types";
import { rootNodeIdForSpace } from "../../src/logic/kernel";
import type { busabaseRouter } from "../../src/router";

type Row = Record<string, unknown>;
type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
type SendTables = (input: Parameters<Client["dump"]["importTables"]>[0]) => Promise<unknown>;
type Options = { resume?: boolean; preserveViewMetadata?: boolean };
const fixedTime = "2026-01-01T00:00:00.000000Z";
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Row)[key])}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Exact replay fixtures must contain JSON wire values");
  return encoded;
};
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Freeze source facts before first begin; never inspect a resumed target to invent expectations. */
export const createExactDumpReplayFixture = (input: {
  sourceSpaceId: string;
  rows?: Partial<Record<DumpTable, Row[]>>;
  blobs?: Array<{
    key: string;
    bytes: Uint8Array;
    table?: "attachmentBlobs" | "assetTextBlobs";
    mimeType?: string;
  }>;
}) => {
  const sourceSpaceId = input.sourceSpaceId;
  const rootId = rootNodeIdForSpace(sourceSpaceId);
  const rows = Object.fromEntries(
    DumpTableSchema.options.map((table) => [
      table,
      JSON.parse(JSON.stringify(input.rows?.[table] ?? [])),
    ]),
  ) as Record<DumpTable, Row[]>;
  if (!rows.nodes.some((row) => row.id === rootId))
    rows.nodes.unshift({
      id: rootId,
      spaceId: sourceSpaceId,
      parentId: null,
      type: "folder",
      slug: "root",
      name: "Fixed source workspace root",
      description: "",
      metadata: {},
      settings: {},
      agentPrompts: null,
      icon: null,
      position: 0,
      explicitVisibility: null,
      effectiveVisibility: null,
      effectivePublicScope: null,
      effectivePublicRequiresPassword: false,
      createdBy: "fixture-user",
      archivedAt: null,
      deletedAt: null,
      createdAt: fixedTime,
      updatedAt: fixedTime,
    });
  const expectedTables = Object.fromEntries(
    DumpTableSchema.options.map((table) => [table, rows[table].length]),
  ) as Record<DumpTable, number>;
  const blobs = (input.blobs ?? []).map((blob) => ({
    table: blob.table ?? "attachmentBlobs",
    key: blob.key,
    mimeType: blob.mimeType ?? "application/octet-stream",
    bytes: blob.bytes.byteLength,
    sha256: createHash("sha256").update(blob.bytes).digest("hex"),
  }));
  // The hash commits to fixed SQL wire rows, the full empty-table inventory and
  // actual source bytes. It is not a guessed digest or a target-derived hash.
  const sourceArchiveChecksum = createHash("sha256")
    .update(
      canonical({
        fixtureFormat: "exact-dump-replay@1",
        sourceSpaceId,
        rows,
        blobs,
      }),
    )
    .digest("hex");
  freeze(rows);
  freeze(expectedTables);
  const beginInput = (options: Options = {}) => ({
    sourceSpaceId,
    sourceArchiveChecksum,
    expectedTables,
    preserveViewMetadata: options.preserveViewMetadata ?? true,
    resume: options.resume ?? false,
  });
  const preflightWith = async (send: SendTables, sessionId: string) => {
    for (const table of DumpTableSchema.options) {
      for (let offset = 0; offset < rows[table].length; offset += 2000) {
        const batch = rows[table].slice(offset, offset + 2000);
        const result = (await send({
          sessionId,
          table,
          rows: batch,
          validateOnly: true,
        })) as { validated?: boolean; validationComplete?: boolean; validatedRows?: number };
        if (
          result.validated !== true ||
          result.validationComplete !== false ||
          result.validatedRows !== offset + batch.length
        )
          throw new Error(`Missing exact read-only batch acknowledgement for ${table}`);
      }
      const ended = (await send({
        sessionId,
        table,
        rows: [],
        validateOnly: true,
        validationComplete: true,
      })) as { validated?: boolean; validationComplete?: boolean; validatedRows?: number };
      if (
        ended.validated !== true ||
        ended.validationComplete !== true ||
        ended.validatedRows !== expectedTables[table]
      )
        throw new Error(`Missing exact read-only table acknowledgement for ${table}`);
    }
  };
  return Object.freeze({
    sourceSpaceId,
    rows,
    expectedTables,
    sourceArchiveChecksum,
    beginInput,
    begin: async (client: Client, options: Options = {}) => {
      const begun = await client.dump.importBegin(beginInput(options));
      if (begun.exactReplayProtocol !== 1)
        throw new Error("Fixture requires exact replay protocol 1");
      return begun;
    },
    offerRoot: (client: Client, sessionId: string) =>
      client.dump.importTables({
        sessionId,
        table: "nodes",
        rows: rows.nodes.filter((row) => row.id === rootId),
      }),
    preflight: (client: Client, sessionId: string) =>
      preflightWith((request) => client.dump.importTables(request), sessionId),
    preflightWith,
  });
};
