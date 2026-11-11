import type { DumpTable } from "busabase-contract/domains/dump/types";
import type { InferInsertModel } from "drizzle-orm";
import type { DUMP_TABLE_REGISTRY } from "../../src/domains/dump/logic/table-registry";
import { rootNodeIdForSpace } from "../../src/logic/kernel";

type FixtureRows = Partial<{
  [Table in DumpTable]: InferInsertModel<(typeof DUMP_TABLE_REGISTRY)[Table]>[];
}>;

/** Explicit synthetic supplement, never a claim about the production source. */
export const createDumpBusinessFixture = (spaceId: string, prefix: string) => {
  const time = new Date();
  const future = new Date("2099-12-31T00:00:00.000Z");
  const root = rootNodeIdForSpace(spaceId);
  const nodeId = `${prefix}_doc`;
  const baseNodeId = `${prefix}_base_node`;
  const formNodeId = `${prefix}_form_node`;
  const workflowNodeId = `${prefix}_workflow_node`;
  const baseId = `${prefix}_base`;
  const commentId = `${prefix}_comment`;
  const sessionId = `${prefix}_session`;
  const grantId = `${prefix}_grant`;
  return {
    nodes: [
      {
        id: nodeId,
        spaceId,
        parentId: root,
        type: "doc",
        slug: `${prefix}-doc`,
        name: "Synthetic backup fixture",
        effectivePublicScope: "read",
        effectivePublicRequiresPassword: true,
      },
      {
        id: baseNodeId,
        spaceId,
        parentId: root,
        type: "base",
        slug: `${prefix}-base`,
        name: "Synthetic fixture Base",
      },
      {
        id: formNodeId,
        spaceId,
        parentId: root,
        type: "form",
        slug: `${prefix}-form`,
        name: "Synthetic fixture Form",
      },
      {
        id: workflowNodeId,
        spaceId,
        parentId: root,
        type: "workflow",
        slug: `${prefix}-workflow`,
        name: "Synthetic fixture Workflow",
      },
    ],
    bases: [
      {
        id: baseId,
        spaceId,
        nodeId: baseNodeId,
        slug: `${prefix}-base`,
        name: "Synthetic fixture Base",
      },
    ],
    comments: [
      {
        id: commentId,
        spaceId,
        subjectType: "record",
        subjectId: `${prefix}_historical_record`,
        authorId: "fixture-user",
        body: "@Member historical mention",
      },
    ],
    nodeShares: [
      {
        id: `${prefix}_share`,
        spaceId,
        nodeId,
        scope: "public",
        capability: "read",
        passwordHash: "scrypt:preserved-access-verifier",
        expiresAt: future,
        createdBy: "fixture-user",
        updatedBy: "fixture-user",
      },
    ],
    favorites: [{ id: `${prefix}_favorite`, spaceId, nodeId, actorId: "fixture-user" }],
    nodeSubscriptions: [
      {
        id: `${prefix}_subscription`,
        spaceId,
        nodeId,
        actorId: "fixture-user",
        source: "manual",
        mutedAt: time,
      },
    ],
    spaceInstructions: [
      {
        spaceId,
        body: "Synthetic shared instructions — preserved verbatim",
        version: 7,
        updatedAt: time,
      },
    ],
    spaceWelcome: [{ spaceId, nodeId, version: 3, updatedAt: time }],
    embedLinks: [
      {
        id: `${prefix}_embed`,
        spaceId,
        type: "node",
        typeId: nodeId,
        secretHash: `${prefix}-capability-hash`,
        createdBy: "fixture-user",
        createdByApiKeyId: "fixture-excluded-key",
        frameMode: "origins",
        allowedOrigins: ["https://fixture.invalid"],
        expiresAt: future,
        revokedAt: time,
        createdAt: time,
        updatedAt: time,
      },
    ],
    forms: [
      {
        id: `${prefix}_form`,
        spaceId,
        nodeId: formNodeId,
        targetBaseId: baseId,
        name: "Synthetic form config",
        description: "Nonempty form configuration",
        bindings: [{ inputName: "subject", fieldSlug: "subject", required: true }],
        page: { code: "<form>Original form</form>" },
        share: { isPublic: false, anonymousSubmit: false },
        submissionCount: 4,
        createdBy: "fixture-user",
      },
    ],
    commentMentions: [
      {
        id: `${prefix}_mention`,
        commentId,
        targetType: "member",
        targetId: "fixture-member",
        startOffset: 0,
        endOffset: 7,
        label: "Member",
        dispatchStatus: "not_applicable",
        readAt: time,
      },
    ],
    workflowRuns: [
      {
        id: `${prefix}_run`,
        spaceId,
        workflowNodeId,
        status: "completed",
        trigger: "manual",
        startedBy: "fixture-user",
        payload: { original: "request" },
        outputs: { answer: { value: 42 } },
        startedAt: time,
        updatedAt: time,
      },
      {
        id: `${prefix}_wait`,
        spaceId,
        workflowNodeId,
        status: "waiting",
        trigger: "event",
        startedBy: "fixture-user",
        cursorNodeId: "wait-step",
        payload: {},
        outputs: { beforeWait: "saved" },
        pause: { kind: "wait", resumeAt: future.toISOString() },
        resumeAt: future,
        startedAt: time,
        updatedAt: time,
      },
    ],
    workflowTriggers: [
      {
        id: `${prefix}_trigger`,
        spaceId,
        workflowNodeId,
        triggerNodeId: "schedule-step",
        eventType: "schedule",
        baseId,
        config: { schedule: { every: 1, unit: "days", at: "09:00", weekday: 1, timezone: "UTC" } },
        nextRunAt: future,
        armedBy: "fixture-user",
        createdAt: time,
      },
    ],
    webhookRules: [
      {
        id: `${prefix}_webhook`,
        spaceId,
        baseId,
        name: "Synthetic disabled webhook",
        eventType: "record.updated",
        actionKind: "webhook",
        config: { targetUrl: "https://fixture.invalid/hook", headers: { "X-Fixture": "kept" } },
        enabled: false,
        createdBy: "fixture-user",
        createdAt: time,
        updatedAt: time,
      },
    ],
    webhookDeliveries: [
      {
        id: `${prefix}_delivery`,
        spaceId,
        ruleId: `${prefix}_webhook`,
        eventType: "record.updated",
        status: "success",
        httpStatus: 204,
        detail: "Historical response",
        durationMs: 23,
        createdAt: time,
      },
    ],
    agentSessions: [
      {
        id: sessionId,
        spaceId,
        actorId: "fixture-user",
        slug: `${prefix}-session`,
        agentName: "Historical fixture agent",
        transport: "remote-websocket",
        status: "ended",
        acpSessionId: `${prefix}-remote-id`,
        endedAt: time,
        createdAt: time,
        lastActivityAt: time,
        creationState: "confirmed",
        capabilities: { load: true },
      },
    ],
    agentSessionEvents: [
      {
        id: `${prefix}_event`,
        sessionId,
        seq: 1,
        kind: "acpUpdate",
        payload: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Original transcript" },
        },
        at: time,
      },
    ],
    agentSessionCommands: [
      {
        id: `${prefix}_command`,
        sessionId,
        spaceId,
        actorId: "fixture-user",
        commandId: `${prefix}-command`,
        kind: "prompt",
        state: "completed",
        bindingGeneration: 1,
        contentDigest: "fixture-original-digest",
        payload: { text: "Historical prompt" },
        receipt: { completed: true },
        createdAt: time,
        updatedAt: time,
        expiresAt: future,
      },
    ],
    routerGrants: [
      {
        id: grantId,
        busabaseActorId: "fixture-user",
        busabaseSpaceId: spaceId,
        acprouterSpaceId: "fixture-router-space",
        acprouterSpaceName: "Original remote space",
        tokenVaultItemId: `${prefix}_excluded_token`,
        revokedAt: time,
        createdAt: time,
      },
    ],
    routerConnections: [
      {
        id: `${prefix}_connection`,
        grantId,
        acprouterEnrollmentId: `${prefix}-enrollment`,
        acprouterAgentId: `${prefix}-remote-agent`,
        agentSlug: `${prefix}-remote`,
        vaultItemId: `${prefix}_excluded_consumer_secret`,
        pendingRevokedAt: time,
        createdAt: time,
      },
    ],
  } satisfies FixtureRows;
};
