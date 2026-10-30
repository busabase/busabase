import "server-only";

import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { createFieldChangeRequestInputSchema } from "busabase-contract/domains/base/contract/base-schemas";
import type { BaseVO } from "busabase-contract/types";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId, withContextSourceMeta } from "../../../context";
import { getDb } from "../../../db";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseChangeRequests,
  busabaseOperations,
} from "../../../db/schema";
import { insertAuditEvent } from "../../../logic/audit";
import { insertCommit } from "../../../logic/commits";
import {
  finalizeChangeRequest,
  getChangeRequest,
  mergeChangeRequest,
} from "../../../logic/cr-lifecycle";
import { id, now } from "../../../logic/kernel";
import { assertNodePermission, hasNodePermission } from "../../../logic/node-acl";
import { formulaDependencySnapshot } from "./formula-recalculation";
import { getBase } from "./queries";

type Input = z.output<typeof createFieldChangeRequestInputSchema>;

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};

/**
 * A new forward field and its optional reverse are one proposal, not two HTTP
 * writes. Both operations are materialized by the existing multi-Base merge
 * transaction and are visible to the CR's normal all-target permission gate.
 */
export const createFieldProposal = async (base: BaseVO, input: Input) => {
  const db = await getDb();
  const actorId = resolveActorId(input.submittedBy);
  const target =
    input.reverse && typeof input.options.targetBaseId === "string"
      ? await getBase(input.options.targetBaseId)
      : null;
  if (input.reverse && !target) {
    throw new ORPCError("NOT_FOUND", { message: "Relation target Base not found" });
  }
  const bases = target && target.id !== base.id ? [base, target] : [base];
  for (const item of bases) await assertNodePermission(item.nodeId, "changeRequest", actorId);
  const mayAutoMerge = (
    await Promise.all(bases.map((item) => hasNodePermission(item.nodeId, "write", actorId)))
  ).every(Boolean);
  const { requestId, ...request } = input;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(canonical({ ...request, submittedBy: actorId })))
    .digest("hex");

  const proposal = await db.transaction(async (tx) => {
    // The same stable lock order is used by the merge loop. It serializes
    // duplicate requests without a new persistence table or advisory lock.
    const locked = await tx
      .select({ id: busabaseBases.id, reviewPolicy: busabaseBases.reviewPolicy })
      .from(busabaseBases)
      .where(
        and(
          eq(busabaseBases.spaceId, getContextSpaceId()),
          inArray(
            busabaseBases.id,
            bases.map((item) => item.id),
          ),
          isNull(busabaseBases.archivedAt),
          isNull(busabaseBases.deletedAt),
        ),
      )
      .orderBy(asc(busabaseBases.id))
      .for("update");
    if (locked.length !== bases.length) {
      throw new ORPCError("CONFLICT", {
        message: "A relation Base was archived before the field could be created.",
      });
    }
    const requiredApprovals = Math.max(
      ...locked.map((item) => item.reviewPolicy.requiredApprovals),
      1,
    );
    if (requestId) {
      const [existing] = await tx
        .select()
        .from(busabaseChangeRequests)
        .where(
          and(
            eq(busabaseChangeRequests.spaceId, getContextSpaceId()),
            eq(busabaseChangeRequests.baseId, base.id),
            eq(busabaseChangeRequests.submittedBy, actorId),
            eq(busabaseChangeRequests.idempotencyKey, `field:${requestId}`),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.sourceMeta?.fieldRequestFingerprint !== fingerprint) {
          throw new ORPCError("CONFLICT", {
            message: "This field request id was already used with different settings.",
          });
        }
        return { id: existing.id, replay: true, requiredApprovals };
      }
    }
    const fields = await tx
      .select()
      .from(busabaseBaseFields)
      .where(
        and(
          inArray(
            busabaseBaseFields.baseId,
            bases.map((item) => item.id),
          ),
          isNull(busabaseBaseFields.deletedAt),
        ),
      );
    if (fields.some((field) => field.baseId === base.id && field.slug === input.slug)) {
      throw new ORPCError("CONFLICT", { message: `Field already exists: ${input.slug}` });
    }
    const forwardId = id("bsf");
    const timestamp = now();
    const changeRequestId = id("crq");
    const definitions = [
      {
        baseId: base.id,
        fieldId: forwardId,
        name: input.name,
        slug: input.slug,
        type: input.type,
        required: input.type === "formula" ? false : input.required,
        options: input.options,
        formulaDependencies: formulaDependencySnapshot(input.type, input.options, base.fields),
        originViewId: input.originViewId,
      },
    ];
    if (target && input.reverse) {
      const taken = new Set(
        fields.filter((field) => field.baseId === target.id).map((field) => field.slug),
      );
      if (target.id === base.id) taken.add(input.slug);
      const stem =
        base.slug
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "") || "linked";
      let reverseSlug = stem;
      for (let suffix = 2; taken.has(reverseSlug); suffix += 1) reverseSlug = `${stem}_${suffix}`;
      definitions.push({
        baseId: target.id,
        fieldId: id("bsf"),
        name: input.reverse.name,
        slug: reverseSlug,
        type: "relation",
        required: false,
        options: { targetBaseId: base.id, multiple: true, reverseOfFieldId: forwardId },
        formulaDependencies: undefined,
        originViewId: undefined,
      });
    }
    await tx.insert(busabaseChangeRequests).values({
      id: changeRequestId,
      baseId: base.id,
      status: "in_review",
      submittedBy: actorId,
      sourceMeta: withContextSourceMeta({
        subject: "base_field",
        fieldSlug: input.slug,
        ...(requestId ? { fieldRequestId: requestId, fieldRequestFingerprint: fingerprint } : {}),
        ...(target ? { relatedFieldCreation: true } : {}),
      }),
      idempotencyKey: requestId ? `field:${requestId}` : null,
      reviewPolicySnapshot: {
        kind: "single",
        requiredApprovals,
        ...(target
          ? { relatedBases: locked.map((item) => ({ baseId: item.id, ...item.reviewPolicy })) }
          : {}),
      },
      mergeSummary: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    for (const [position, definition] of definitions.entries()) {
      const operationId = id("opr");
      const commitId = id("cmt");
      const { baseId, ...payload } = definition;
      await insertCommit(tx as unknown as typeof db, {
        id: commitId,
        baseId,
        operationId,
        parentCommitId: null,
        payload,
        operation: "base_add_field",
        message: input.message,
        author: actorId,
        createdAt: timestamp,
      });
      await tx.insert(busabaseOperations).values({
        id: operationId,
        changeRequestId,
        baseId,
        operation: "base_add_field",
        status: "pending",
        headCommitId: commitId,
        deleteMode: "archive",
        position,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await insertAuditEvent(tx as unknown as typeof db, {
        action: "change_request.created",
        actorId,
        baseId,
        changeRequestId,
        operationId,
        commitId,
        metadata: { operation: "base_add_field", fieldSlug: definition.slug },
      });
    }
    return { id: changeRequestId, replay: false, requiredApprovals };
  });
  const existing = await getChangeRequest(proposal.id);
  if (!existing) throw new Error("Field proposal could not be loaded");
  if (existing.status === "merged") return existing;
  const immediate = mayAutoMerge && proposal.requiredApprovals === 1 && input.autoMerge !== false;
  if (proposal.replay && (!immediate || existing.status === "changes_requested")) return existing;
  try {
    if (proposal.replay && existing.status === "approved") {
      return (await mergeChangeRequest(proposal.id, { automatic: true })).changeRequest;
    }
    return await finalizeChangeRequest({
      changeRequestId: proposal.id,
      nodeId: base.nodeId,
      requestedAutoMerge: immediate ? input.autoMerge : false,
      submittedBy: actorId,
      baseId: base.id,
      label: "field create",
      kind: "structural",
    });
  } catch (error) {
    // Another instance can finish the same idempotent request while this one
    // waits on the merge's row claim. Return its committed outcome.
    const latest = await getChangeRequest(proposal.id);
    if (latest?.status === "merged") return latest;
    if (immediate && latest?.status === "approved") {
      try {
        return (await mergeChangeRequest(proposal.id, { automatic: true })).changeRequest;
      } catch {
        const settled = await getChangeRequest(proposal.id);
        if (settled?.status === "merged") return settled;
      }
    }
    throw error;
  }
};
