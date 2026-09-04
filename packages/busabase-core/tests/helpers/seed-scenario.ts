/**
 * Test helper: create an isolated in-process PGLite database per test scenario
 * and return a typed client + raw db handle for assertions.
 *
 * Each scenario gets its own `pglite://` data directory so tests don't share state.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import type { BaseVO } from "busabase-contract/types";
import { afterAll } from "vitest";
import { getContextSpaceId, LOCAL_SPACE_ID, runWithBusabaseContext } from "../../src/context";
import { getDb } from "../../src/db";
import { busabaseRouter } from "../../src/router";

export type TestClient = ReturnType<typeof buildClient>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../../apps/busabase");

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

function buildClient(raw: RawClient) {
  // Cache the record headCommitId at the time each record is first created/seen.
  // This lets us pass a stale baseCommitId to updateChangeRequest to trigger
  // 3-way merge conflict detection when the record has advanced since.
  const recordBaseCommitCache = new Map<string, string>();

  const approveAndMerge = async (changeRequestId: string) => {
    await raw.changeRequests.review({ changeRequestIds: [changeRequestId], verdict: "approved" });
    const [result] = (await raw.changeRequests.merge({ changeRequestIds: [changeRequestId] }))
      .results;
    if (!result?.ok)
      throw Object.assign(new Error(result?.error ?? "Change request merge returned no result"), {
        code: result?.code,
        data: result?.data,
      });
    return result;
  };

  return {
    bases: {
      list: (input?: { status?: "active" | "archived" }) => raw.bases.list(input ?? {}),
      listArchived: () => raw.bases.list({ status: "archived" }),
      get: (input: { baseId: string }) => raw.bases.get(input),
      // Test convenience default: `createBase` is review-first by default in
      // production (a pending ChangeRequest), but nearly every test in this
      // suite immediately asserts on the materialized Base it just created —
      // exactly like `mergeImmediately` below skips review for record/field/view
      // CRs. Pass `autoMerge: false` explicitly to exercise the pending path
      // (the return type here assumes the default `autoMerge: true`, so an
      // explicit override needs its own cast at the call site).
      create: async (input: Parameters<RawClient["bases"]["create"]>[0]): Promise<BaseVO> => {
        const result = await raw.bases.create({ autoMerge: true, ...input });
        if ("status" in result) {
          throw new Error(
            "seed-scenario bases.create: expected a materialized BaseVO — pass autoMerge: false explicitly and handle the ChangeRequestVO yourself if you need the pending path",
          );
        }
        return result;
      },
      createField: (input: Parameters<RawClient["bases"]["createField"]>[0]) =>
        raw.bases.createField(input),
      listViews: (input?: { baseId?: string; status?: "active" | "archived" }) =>
        raw.bases.listViews({ status: "active", ...(input ?? {}) } as Parameters<
          RawClient["bases"]["listViews"]
        >[0]),
      // Mirrors the contract's single field endpoint, plus this suite's
      // `mergeImmediately` convenience (approve + merge in one call).
      fieldChangeRequest: async (
        input: Parameters<RawClient["bases"]["fieldChangeRequest"]>[0] & {
          mergeImmediately?: boolean;
        },
      ) => {
        const { mergeImmediately, ...rest } = input;
        // Pin the review-first branch, same reasoning as `views.changeRequest`
        // below: the endpoint's permission-aware default would merge for these
        // write-capable test actors, but this helper's contract — and every
        // caller's `mergeImmediately` flag — is "always give me the CR, and
        // approve+merge it only if I asked".
        const cr = await raw.bases.fieldChangeRequest({
          ...rest,
          autoMerge: false,
        } as Parameters<RawClient["bases"]["fieldChangeRequest"]>[0]);
        if (mergeImmediately) {
          await approveAndMerge(cr.id);
        }
        return cr;
      },
      createArchiveChangeRequest: async (input: {
        baseId: string;
        submittedBy?: string;
        message?: string;
        mergeImmediately?: boolean;
      }) => {
        const { mergeImmediately, ...rest } = input;
        const cr = await raw.bases.lifecycleChangeRequest({
          operation: "archive",
          baseId: rest.baseId,
          submittedBy: rest.submittedBy ?? "local-editor",
          message: rest.message,
        });
        if (mergeImmediately) {
          await approveAndMerge(cr.id);
        }
        return cr;
      },
      listDeletedFields: (input: { baseId: string }) => raw.bases.listDeletedFields(input),
    },
    records: {
      list: async (input?: Parameters<RawClient["records"]["list"]>[0]) =>
        (await raw.records.list(input)).records,
      get: (input: Parameters<RawClient["records"]["get"]>[0]) => raw.records.get(input),
      createChangeRequest: async (input: {
        baseId: string;
        targetRecordId?: string;
        fields: Record<string, unknown>;
        submittedBy?: string;
        message?: string;
        mergeImmediately?: boolean;
      }) => {
        const { mergeImmediately, targetRecordId, ...rest } = input;

        // Auto-create any field definitions that don't yet exist on the base.
        // This lets tests pass { title: "..." } without explicit createField calls.
        const base = await raw.bases.get({ baseId: rest.baseId });
        const existingFieldSlugs = new Set((base?.fields ?? []).map((f) => f.slug));
        for (const slug of Object.keys(rest.fields)) {
          if (!existingFieldSlugs.has(slug)) {
            await raw.bases.createField({
              baseId: rest.baseId,
              name: slug,
              slug,
              type: "text",
            });
          }
        }

        let cr: Awaited<ReturnType<RawClient["bases"]["createChangeRequest"]>>;
        if (targetRecordId) {
          // Use the cached baseCommitId (the headCommitId at the time the record was
          // first created) so 3-way merge conflict detection fires correctly when the
          // record has advanced since then (e.g. another CR was merged in between).
          const cachedBaseCommitId = recordBaseCommitCache.get(targetRecordId);
          cr = await raw.records.changeRequest({
            operation: "update",
            recordId: targetRecordId,
            fields: rest.fields,
            author: rest.submittedBy ?? "local-producer",
            message: rest.message ?? "Update record",
            autoMerge: false,
            ...(cachedBaseCommitId ? { baseCommitId: cachedBaseCommitId } : {}),
          });
        } else {
          // Explicit `autoMerge: false`: this helper's own `mergeImmediately`
          // flag is what decides pending-vs-merged for the caller — force the
          // create call itself to stay pending regardless of the ambient
          // test context's permission level (which now, since autoMerge
          // defaults to permission-aware, would otherwise materialize this
          // immediately for a manager-level context and break the
          // `mergeImmediately: false` callers expecting a pending CR back).
          cr = await raw.bases.createChangeRequest({
            baseId: rest.baseId,
            fields: rest.fields,
            submittedBy: rest.submittedBy ?? "local-producer",
            message: rest.message ?? "Create record",
            autoMerge: false,
          });
        }
        if (cr.materialized) {
          throw new Error("seed-scenario expected a review-first record ChangeRequest");
        }
        if (mergeImmediately) {
          const merged = await approveAndMerge(cr.id);
          if (merged.record) {
            const mergedRecord = merged.record;
            // Cache headCommitId so subsequent update CRs on this record can
            // reference the original snapshot for conflict detection.
            if (mergedRecord.id && mergedRecord.headCommitId) {
              recordBaseCommitCache.set(mergedRecord.id, mergedRecord.headCommitId);
            }
            return mergedRecord;
          }
          throw new Error("mergeImmediately: merge produced no record");
        }
        return cr;
      },
      changeRequest: async (
        input: Parameters<RawClient["records"]["changeRequest"]>[0] & {
          mergeImmediately?: boolean;
        },
      ) => {
        const { mergeImmediately, ...rest } = input;
        const cr = await raw.records.changeRequest(
          rest as Parameters<RawClient["records"]["changeRequest"]>[0],
        );
        if (mergeImmediately) {
          await approveAndMerge(cr.id);
        }
        return cr;
      },
      createDeleteChangeRequest: async (input: {
        recordId: string;
        submittedBy?: string;
        message?: string;
        mergeImmediately?: boolean;
      }) => {
        const { mergeImmediately, recordId, ...rest } = input;
        // Mirrors the dashboard facade: one call, with `mergeImmediately`
        // forwarded as the endpoint's own `autoMerge` rather than replayed as a
        // separate approve+merge round trip.
        return raw.records.changeRequest({
          autoMerge: mergeImmediately === true,
          operation: "delete",
          recordId,
          submittedBy: rest.submittedBy ?? "local-editor",
          message: rest.message,
        });
      },
      listLinks: (input: { recordId: string }) => raw.records.listLinks(input),
    },
    views: {
      changeRequest: async (
        input: Parameters<RawClient["views"]["changeRequest"]>[0] & {
          mergeImmediately?: boolean;
        },
      ) => {
        const { mergeImmediately, ...rest } = input;
        // Pin the review-first branch. The endpoint's own permission-aware
        // default would auto-merge for these write-capable test actors and hand
        // back a materialized ViewVO, but this helper's contract — and every
        // caller's `mergeImmediately` flag — is "always give me the CR, and
        // approve+merge it only if I asked". Callers that want to exercise the
        // one-call auto-merge branch should use the raw client directly.
        const result = await raw.views.changeRequest({
          ...rest,
          autoMerge: false,
        } as Parameters<RawClient["views"]["changeRequest"]>[0]);
        if (result.materialized) {
          throw new Error("views.changeRequest ignored autoMerge: false and materialized the view");
        }
        const cr = result;
        if (mergeImmediately) {
          await approveAndMerge(cr.id);
        }
        return cr;
      },
    },
    changeRequests: {
      list: async (input?: Parameters<RawClient["changeRequests"]["list"]>[0]) =>
        (await raw.changeRequests.list(input)).changeRequests,
      get: (input: Parameters<RawClient["changeRequests"]["get"]>[0]) =>
        raw.changeRequests.get(input),
      approve: (input: { changeRequestId: string; reviewedBy?: string }) =>
        raw.changeRequests.review({
          changeRequestIds: [input.changeRequestId],
          verdict: "approved",
        }),
      merge: (input: Parameters<RawClient["changeRequests"]["merge"]>[0]) =>
        raw.changeRequests.merge(input),
    },
  };
}

export type BuiltClient = ReturnType<typeof buildClient>;

export async function seedScenario(_scenario: string): Promise<{
  client: BuiltClient;
  db: Awaited<ReturnType<typeof getDb>>;
  spaceId: string;
}> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), `busabase-p4-${_scenario}-`));
  const storageDir = await mkdtemp(path.join(os.tmpdir(), `busabase-p4-${_scenario}-storage-`));
  const originalCwd = process.cwd();
  const originalPgUrl = process.env.PG_DATABASE_URL;
  const originalStorageUrl = process.env.STORAGE_URL;

  process.chdir(MIGRATIONS_CWD);
  process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;

  // Reset the DB singleton and ensureReady state so each scenario gets a fresh isolated DB.
  type GlobalWithBusabaseState = typeof globalThis & {
    __busabaseCoreDbState?: {
      db: unknown | null;
      client: unknown | null;
      initPromise: Promise<unknown> | null;
    };
    __busabaseReadyBySpace?: Map<string, Promise<void>>;
  };
  const g = globalThis as GlobalWithBusabaseState;
  if (g.__busabaseCoreDbState) {
    // Close the pglite client if possible.
    const prevClient = g.__busabaseCoreDbState.client;
    if (prevClient && typeof (prevClient as { close?: () => Promise<void> }).close === "function") {
      await (prevClient as { close: () => Promise<void> }).close();
    }
    g.__busabaseCoreDbState = { db: null, client: null, initPromise: null };
  }
  if (g.__busabaseReadyBySpace) {
    g.__busabaseReadyBySpace = new Map();
  }

  const rawClient = createRouterClient(busabaseRouter);
  const client = buildClient(rawClient);
  const db = await getDb();
  const spaceId = LOCAL_SPACE_ID;

  afterAll(async () => {
    // Close the pglite client and reset global singletons.
    const g2 = globalThis as GlobalWithBusabaseState;
    if (g2.__busabaseCoreDbState) {
      const prevClient = g2.__busabaseCoreDbState.client;
      if (
        prevClient &&
        typeof (prevClient as { close?: () => Promise<void> }).close === "function"
      ) {
        await (prevClient as { close: () => Promise<void> }).close();
      }
      g2.__busabaseCoreDbState = { db: null, client: null, initPromise: null };
    }
    if (g2.__busabaseReadyBySpace) {
      g2.__busabaseReadyBySpace = new Map();
    }
    process.env.PG_DATABASE_URL = originalPgUrl;
    process.env.STORAGE_URL = originalStorageUrl;
    if (originalCwd) {
      process.chdir(originalCwd);
    }
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  return { client, db, spaceId };
}
