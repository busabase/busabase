import "server-only";

import { ORPCError } from "@orpc/server";
import type {
  CreateFormDTO,
  FormShareVO,
  FormVO,
  SubmitFormDTO,
  UpdateFormDTO,
} from "busabase-contract/types";
import { and, eq, or } from "drizzle-orm";
import { getContextSpaceId, resolveActorId } from "../../../context";
import { getDb } from "../../../db";
import { busabaseForms, busabaseNodes } from "../../../db/schema";
import { id, now } from "../../../logic/kernel";
import { ensureReady } from "../../../logic/seed";
import { createChangeRequest } from "../../base/logic/record-ops";
import type { FormPO } from "../schema";

const formNotFound = (nodeId: string) =>
  new ORPCError("NOT_FOUND", { message: `Form not found: ${nodeId}` });

const DEFAULT_SHARE: FormShareVO = { isPublic: false, anonymousSubmit: false };

/** Identity recorded for submissions that came in without a signed-in user. */
const ANONYMOUS_SUBMITTER = "anonymous";

const toFormVO = (po: FormPO): FormVO => ({
  id: po.id,
  nodeId: po.nodeId,
  spaceId: po.spaceId,
  targetBaseId: po.targetBaseId,
  name: po.name,
  description: po.description,
  bindings: po.bindings ?? [],
  page: po.page ?? {},
  share: { ...DEFAULT_SHARE, ...(po.share ?? {}) },
  submissionCount: po.submissionCount ?? 0,
  status: po.status === "archived" ? "archived" : "active",
  createdBy: po.createdBy,
  createdAt: po.createdAt.toISOString(),
  updatedAt: po.updatedAt.toISOString(),
});

/**
 * Load an active form by its node id OR the node's slug (the detail route passes
 * whichever `:slug` param is in the URL, which is the node slug). Space-scoped.
 */
export const getFormByNodeId = async (nodeIdOrSlug: string): Promise<FormVO | null> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const [row] = await db
    .select({ form: busabaseForms })
    .from(busabaseForms)
    .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseForms.nodeId))
    .where(
      and(
        eq(busabaseForms.spaceId, spaceId),
        or(eq(busabaseForms.nodeId, nodeIdOrSlug), eq(busabaseNodes.slug, nodeIdOrSlug)),
      ),
    )
    .limit(1);
  return row ? toFormVO(row.form) : null;
};

export const createForm = async (input: CreateFormDTO): Promise<FormVO> => {
  await ensureReady();
  const db = await getDb();
  const timestamp = now();
  const formId = id("fom");
  await db.insert(busabaseForms).values({
    id: formId,
    spaceId: getContextSpaceId(),
    nodeId: input.nodeId,
    targetBaseId: input.targetBaseId,
    name: input.name,
    description: input.description ?? "",
    bindings: input.bindings ?? [],
    page: input.page ?? {},
    share: { ...DEFAULT_SHARE, ...(input.share ?? {}) },
    status: "active",
    createdBy: resolveActorId("local-producer"),
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const created = await getFormByNodeId(input.nodeId);
  if (!created) {
    throw new Error("Failed to create form");
  }
  return created;
};

/** Owner-managed config edit (bindings/page/share/name) — NOT a ChangeRequest. */
export const updateForm = async (nodeId: string, input: UpdateFormDTO): Promise<FormVO> => {
  await ensureReady();
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(busabaseForms)
    .where(and(eq(busabaseForms.nodeId, nodeId), eq(busabaseForms.spaceId, getContextSpaceId())))
    .limit(1);
  if (!existing || existing.status !== "active") {
    throw formNotFound(nodeId);
  }
  await db
    .update(busabaseForms)
    .set({
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      bindings: input.bindings ?? existing.bindings,
      page: input.page ?? existing.page,
      share: input.share ? { ...DEFAULT_SHARE, ...input.share } : existing.share,
      updatedAt: now(),
    })
    .where(eq(busabaseForms.id, existing.id));
  const updated = await getFormByNodeId(nodeId);
  if (!updated) {
    throw formNotFound(nodeId);
  }
  return updated;
};

/**
 * Submit a filled-in form. Translates `{inputName: value}` to `{fieldSlug: value}`
 * via the binding contract, applies per-form required overrides, then delegates
 * to the base's `createChangeRequest` — so the submission becomes an
 * approval-first record-create ChangeRequest (validated by validateRecordFields)
 * rather than a direct write.
 *
 * Access is gated on the form's own `share` settings — there is no shareToken:
 *   private                        → caller must be a space member
 *   public + anonymousSubmit=true  → anyone, no login
 *   public + anonymousSubmit=false → any logged-in user, anonymous rejected
 * `submitLimit` is enforced HERE (server-side) — APITable's equivalent only
 * checked it in the browser, which is no enforcement at all.
 */
export const submitForm = async (
  nodeId: string,
  input: SubmitFormDTO,
  caller: { isAnonymous?: boolean } = {},
): Promise<{ changeRequestId: string; status: "pending_review" }> => {
  const form = await getFormByNodeId(nodeId);
  if (!form) {
    throw formNotFound(nodeId);
  }

  // ── Access gate (§5.1 of the spec) ──
  if (caller.isAnonymous) {
    if (!form.share.isPublic) {
      throw new ORPCError("FORBIDDEN", { message: "This form is not public." });
    }
    if (!form.share.anonymousSubmit) {
      throw new ORPCError("FORBIDDEN", { message: "This form requires sign-in to submit." });
    }
  }

  // ── Server-side submit limit ──
  if (form.share.submitLimit != null && form.submissionCount >= form.share.submitLimit) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "This form has reached its submission limit.",
    });
  }

  // Translate input names → target field slugs via the binding contract. Inputs
  // with no binding are ignored (the page may have decorative/non-data inputs).
  const fields: Record<string, unknown> = {};
  for (const binding of form.bindings) {
    const value = input.values[binding.inputName];
    if (value !== undefined) {
      fields[binding.fieldSlug] = value;
    }
  }

  // Per-form required overrides (in addition to the Base-level validation that
  // createChangeRequest → validateRecordFields already enforces).
  const missing = form.bindings
    .filter((b) => b.required)
    .filter((b) => {
      const v = fields[b.fieldSlug];
      return v === undefined || v === null || v === "";
    })
    .map((b) => b.label ?? b.fieldSlug);
  if (missing.length > 0) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Missing required fields: ${missing.join(", ")}`,
      data: { missing },
    });
  }

  const changeRequest = await createChangeRequest(form.targetBaseId, {
    fields,
    message: `Form submission: ${form.name}`,
    submittedBy: caller.isAnonymous ? ANONYMOUS_SUBMITTER : "local-producer",
    // A form submission is inherently a "propose for review" action — it must
    // land as a pending ChangeRequest for a human to approve, never a direct
    // write. Force this regardless of the submitter's own write permission,
    // overriding the permission-aware auto-merge default: a member filling in a
    // shared form is still submitting for review, not editing the base.
    autoMerge: false,
  });

  // Count the accepted submission (backs submitLimit). Done after the CR exists
  // so a rejected/invalid submission never consumes quota.
  const db = await getDb();
  await db
    .update(busabaseForms)
    .set({ submissionCount: form.submissionCount + 1, updatedAt: now() })
    .where(eq(busabaseForms.id, form.id));

  return { changeRequestId: changeRequest.id, status: "pending_review" };
};
