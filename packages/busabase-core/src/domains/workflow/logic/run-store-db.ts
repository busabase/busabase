import "server-only";

import {
  type WorkflowPause,
  type WorkflowRun,
  WorkflowRunSchema,
  type WorkflowStepOutput,
} from "busabase-contract/domains/workflow/run";
import { and, asc, count, desc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import type { BusabaseDatabase } from "../../../context";
import { busabaseWorkflowRuns, type WorkflowRunPO } from "../schema/workflow-runs";
import { FINISHED_WORKFLOW_RUN_STATUSES, type WorkflowRunStore } from "./run-store";

const toDate = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

const resumeAtOf = (run: WorkflowRun): Date | null =>
  run.status === "waiting" && run.pause?.kind === "wait" ? toDate(run.pause.resumeAt) : null;

const toVO = (row: WorkflowRunPO): WorkflowRun =>
  WorkflowRunSchema.parse({
    id: row.id,
    spaceId: row.spaceId,
    workflowNodeId: row.workflowNodeId,
    status: row.status,
    trigger: row.trigger,
    startedBy: row.startedBy,
    startedVia: row.startedVia ?? null,
    cancelledBy: row.cancelledBy,
    cursorNodeId: row.cursorNodeId,
    previousNodeId: row.previousNodeId,
    outputs: row.outputs as Record<string, WorkflowStepOutput>,
    recordId: row.recordId,
    payload: row.payload,
    pause: (row.pause as WorkflowPause | null) ?? null,
    error: row.error,
    freshness: "snapshot-steps-plus-explicit-reread",
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

const mutableColumns = (run: WorkflowRun) => ({
  status: run.status,
  cancelledBy: run.cancelledBy,
  cursorNodeId: run.cursorNodeId,
  previousNodeId: run.previousNodeId,
  outputs: run.outputs,
  pause: run.pause,
  resumeAt: resumeAtOf(run),
  error: run.error,
  updatedAt: new Date(run.updatedAt),
});

/**
 * Postgres-backed runs. `db` is a getter so the request path can use the
 * context database while the scheduler, which runs outside any request,
 * passes its own client explicitly.
 */
export const createDbWorkflowRunStore = (
  db: () => Promise<BusabaseDatabase> | BusabaseDatabase,
): WorkflowRunStore => ({
  async insert(run, leaseUntil) {
    await (await db()).insert(busabaseWorkflowRuns).values({
      id: run.id,
      spaceId: run.spaceId,
      workflowNodeId: run.workflowNodeId,
      trigger: run.trigger,
      startedBy: run.startedBy,
      startedVia: run.startedVia,
      recordId: run.recordId,
      payload: run.payload,
      startedAt: new Date(run.startedAt),
      leaseUntil: new Date(leaseUntil),
      ...mutableColumns(run),
    });
  },
  async save(run) {
    await (await db())
      .update(busabaseWorkflowRuns)
      .set(mutableColumns(run))
      .where(eq(busabaseWorkflowRuns.id, run.id));
  },
  async get(runId) {
    const [row] = await (await db())
      .select()
      .from(busabaseWorkflowRuns)
      .where(eq(busabaseWorkflowRuns.id, runId))
      .limit(1);
    return row ? toVO(row) : null;
  },
  async listForWorkflow(spaceId, workflowNodeId, limit, before) {
    const beforeAt = before ? new Date(before.startedAt) : null;
    const rows = await (await db())
      .select()
      .from(busabaseWorkflowRuns)
      .where(
        and(
          eq(busabaseWorkflowRuns.spaceId, spaceId),
          eq(busabaseWorkflowRuns.workflowNodeId, workflowNodeId),
          before && beforeAt
            ? or(
                lt(busabaseWorkflowRuns.startedAt, beforeAt),
                and(
                  eq(busabaseWorkflowRuns.startedAt, beforeAt),
                  lt(busabaseWorkflowRuns.id, before.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(busabaseWorkflowRuns.startedAt), desc(busabaseWorkflowRuns.id))
      .limit(limit);
    return rows.map(toVO);
  },
  async countWithStatus(spaceId, workflowNodeId, status) {
    const [row] = await (await db())
      .select({ value: count() })
      .from(busabaseWorkflowRuns)
      .where(
        and(
          eq(busabaseWorkflowRuns.spaceId, spaceId),
          eq(busabaseWorkflowRuns.workflowNodeId, workflowNodeId),
          eq(busabaseWorkflowRuns.status, status),
        ),
      );
    return Number(row?.value ?? 0);
  },
  async cancelQueued(spaceId, workflowNodeId, cancelledBy, now) {
    const at = new Date(now);
    const cancelled = await (await db())
      .update(busabaseWorkflowRuns)
      .set({ status: "cancelled", cancelledBy, updatedAt: at })
      .where(
        and(
          eq(busabaseWorkflowRuns.spaceId, spaceId),
          eq(busabaseWorkflowRuns.workflowNodeId, workflowNodeId),
          eq(busabaseWorkflowRuns.status, "queued"),
          or(isNull(busabaseWorkflowRuns.leaseUntil), lt(busabaseWorkflowRuns.leaseUntil, at)),
        ),
      )
      .returning({ id: busabaseWorkflowRuns.id });
    return cancelled.length;
  },
  async purgeFinished(before, limit) {
    const client = await db();
    const stale = await client
      .select({ id: busabaseWorkflowRuns.id })
      .from(busabaseWorkflowRuns)
      .where(
        and(
          inArray(busabaseWorkflowRuns.status, [...FINISHED_WORKFLOW_RUN_STATUSES]),
          lt(busabaseWorkflowRuns.updatedAt, new Date(before)),
        ),
      )
      .limit(limit);
    if (stale.length === 0) return 0;
    await client.delete(busabaseWorkflowRuns).where(
      inArray(
        busabaseWorkflowRuns.id,
        stale.map((row) => row.id),
      ),
    );
    return stale.length;
  },
  async listElapsedWaits(spaceId, now) {
    const rows = await (await db())
      .select()
      .from(busabaseWorkflowRuns)
      .where(
        and(
          eq(busabaseWorkflowRuns.spaceId, spaceId),
          eq(busabaseWorkflowRuns.status, "waiting"),
          lte(busabaseWorkflowRuns.resumeAt, new Date(now)),
        ),
      )
      .orderBy(asc(busabaseWorkflowRuns.resumeAt));
    return rows.map(toVO);
  },
  async listDue(now, limit) {
    const rows = await (await db())
      .select()
      .from(busabaseWorkflowRuns)
      .where(
        or(
          eq(busabaseWorkflowRuns.status, "queued"),
          and(
            eq(busabaseWorkflowRuns.status, "waiting"),
            lte(busabaseWorkflowRuns.resumeAt, new Date(now)),
          ),
        ),
      )
      .orderBy(asc(busabaseWorkflowRuns.updatedAt))
      .limit(limit);
    return rows.map(toVO);
  },
  async listInterrupted(now, limit) {
    const rows = await (await db())
      .select()
      .from(busabaseWorkflowRuns)
      .where(
        and(
          eq(busabaseWorkflowRuns.status, "running"),
          or(
            isNull(busabaseWorkflowRuns.leaseUntil),
            lt(busabaseWorkflowRuns.leaseUntil, new Date(now)),
          ),
        ),
      )
      .limit(limit);
    return rows.map(toVO);
  },
  async claim(runId, now, leaseUntil) {
    const claimed = await (await db())
      .update(busabaseWorkflowRuns)
      .set({ leaseUntil: new Date(leaseUntil) })
      .where(
        and(
          eq(busabaseWorkflowRuns.id, runId),
          or(
            isNull(busabaseWorkflowRuns.leaseUntil),
            lt(busabaseWorkflowRuns.leaseUntil, new Date(now)),
          ),
        ),
      )
      .returning({ id: busabaseWorkflowRuns.id });
    return claimed.length > 0;
  },
  async release(runId) {
    await (await db())
      .update(busabaseWorkflowRuns)
      .set({ leaseUntil: null })
      .where(eq(busabaseWorkflowRuns.id, runId));
  },
});
