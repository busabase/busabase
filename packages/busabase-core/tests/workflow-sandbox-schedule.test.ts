/**
 * A run waiting on sandboxed code is found by the scheduler's due query the
 * way an elapsed Wait is: the database store keeps `resume_at` for a sandbox
 * pause too. Without it the run would wait forever, and nothing would say why.
 * Real PGLite; the sandbox itself is not involved.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WORKFLOW_DATA_FRESHNESS } from "busabase-contract/domains/workflow/run";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { createDbWorkflowRunStore } from "../src/domains/workflow/logic/run-store-db";
import { ensureReady } from "../src/logic/seed";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

let dataDir = "";
let originalCwd = "";

beforeAll(async () => {
  originalCwd = process.cwd();
  process.chdir(MIGRATIONS_CWD);
  dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-sandbox-schedule-db-"));
  process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  await ensureReady();
}, 120_000);

afterAll(async () => {
  process.chdir(originalCwd);
  delete process.env.PG_DATABASE_URL;
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe("a sandbox pause in the scheduler's due query", () => {
  it("is listed once its next check is due, and not before", async () => {
    const store = createDbWorkflowRunStore(getDb);
    const now = Date.now();
    await store.insert(
      {
        id: "wfr_sandbox_due",
        spaceId: "org_local",
        workflowNodeId: "nod_sign",
        status: "waiting",
        trigger: "manual",
        startedBy: "usr_local",
        startedVia: null,
        cancelledBy: null,
        cursorNodeId: "sign",
        previousNodeId: "trigger",
        outputs: {},
        recordId: null,
        payload: {},
        pause: {
          kind: "sandbox",
          nodeId: "sign",
          resumeAt: new Date(now + 10_000).toISOString(),
          sandboxId: "sbx_test",
          deadlineAt: new Date(now + 900_000).toISOString(),
        },
        error: null,
        freshness: WORKFLOW_DATA_FRESHNESS,
        startedAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      },
      0,
    );

    const due = async (at: number) =>
      (await store.listDue(at, 500)).some((run) => run.id === "wfr_sandbox_due");
    expect(await due(now)).toBe(false);
    expect(await due(now + 10_000)).toBe(true);
    expect((await store.get("wfr_sandbox_due"))?.pause).toMatchObject({
      kind: "sandbox",
      sandboxId: "sbx_test",
    });
  });
});
