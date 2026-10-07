/**
 * Node subscriptions against a real PGLite database: auto-subscribe at every
 * choke point (create, submit, comment, vote), the sticky opt-out, folder
 * inheritance with a child mute, a node move changing the audience, the
 * resolvers a host builds recipients from, and the `onNotificationEvent` hook
 * contract (fired after the write, never able to fail it).
 */
import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type BusabaseContext,
  type BusabaseNotificationEvent,
  LOCAL_SPACE_ID,
  runWithBusabaseContext,
} from "../src/context";
import { busabaseNodeSubscriptions } from "../src/db/schema";
import {
  filterActorsWithNodeReadAccess,
  resolveChangeRequestParticipants,
  resolveChangeRequestTarget,
  resolveNodeSubscribers,
} from "../src/logic/node-subscriptions";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const events: BusabaseNotificationEvent[] = [];

const as = <T>(actorId: string, fn: () => Promise<T>, extra: Partial<BusabaseContext> = {}) =>
  runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId,
      isSpaceManager: true,
      onNotificationEvent: (event) => {
        events.push(event);
      },
      ...extra,
    },
    fn,
  );

describe("node subscriptions", () => {
  let raw: RawClient;
  let db: Awaited<ReturnType<typeof seedScenario>>["db"];
  let folderId = "";
  let siblingId = "";
  let otherFolderId = "";
  let baseId = "";
  let baseNodeId = "";

  const rowFor = async (nodeId: string, actorId: string) => {
    const [row] = await db
      .select()
      .from(busabaseNodeSubscriptions)
      .where(
        and(
          eq(busabaseNodeSubscriptions.nodeId, nodeId),
          eq(busabaseNodeSubscriptions.actorId, actorId),
        ),
      );
    return row ?? null;
  };

  const createFolder = (actorId: string, slug: string, parentNodeId?: string) =>
    as(actorId, async () => {
      const cr = await raw.nodes.createChangeRequest({
        operations: [
          {
            kind: "create",
            nodeType: "folder",
            slug,
            name: slug,
            ...(parentNodeId ? { parentNodeId } : {}),
          },
        ],
        autoMerge: true,
      });
      const nodeId = cr.mergeSummary.mergedNodeIds?.[0];
      if (!nodeId) throw new Error("expected a merged folder");
      return nodeId as string;
    });

  const submitRecord = (actorId: string, title: string) =>
    as(actorId, () =>
      raw.bases.createChangeRequest({
        baseId,
        fields: { title },
        message: "Create",
        autoMerge: false,
      }),
    );

  beforeAll(async () => {
    const scenario = await seedScenario("node-subscriptions");
    db = scenario.db;
    raw = createRouterClient(busabaseRouter);
    folderId = await createFolder("alice", "projects");
    siblingId = await createFolder("alice", "projects-notes", folderId);
    otherFolderId = await createFolder("alice", "archive-area");
    const base = await as("alice", async () => {
      const created = await raw.bases.create({
        name: "Roadmap",
        slug: "roadmap",
        parentNodeId: folderId,
        autoMerge: true,
      });
      if (!("nodeId" in created) || "status" in created) throw new Error("expected a base");
      await raw.bases.createField({
        baseId: created.id,
        name: "title",
        slug: "title",
        type: "text",
      });
      return created;
    });
    baseId = base.id;
    baseNodeId = base.nodeId;
  });

  it("subscribes the creator of every new node (folder, Base) through the merged create", async () => {
    expect(await rowFor(folderId, "alice")).toMatchObject({ source: "auto", mutedAt: null });
    expect(await rowFor(siblingId, "alice")).toMatchObject({ source: "auto", mutedAt: null });
    expect(await rowFor(baseNodeId, "alice")).toMatchObject({ source: "auto", mutedAt: null });
    // A direct create is announced as a direct change to the new node.
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "node.changed", nodeId: baseNodeId, actorId: "alice" }),
    );
  });

  it("subscribes on submit, comment and vote, and emits one event per action", async () => {
    events.length = 0;
    const cr = await submitRecord("bob", "First");
    expect(await rowFor(baseNodeId, "bob")).toMatchObject({ source: "auto" });
    expect(events).toContainEqual({
      kind: "change_request.pending_review",
      spaceId: LOCAL_SPACE_ID,
      changeRequestId: cr.id,
      nodeId: baseNodeId,
      baseId,
      actorId: "bob",
    });

    await as("carol", () =>
      raw.comments.create({ subjectType: "change_request", subjectId: cr.id, body: "Looks good" }),
    );
    expect(await rowFor(baseNodeId, "carol")).toMatchObject({ source: "auto" });
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "change_request.commented",
        changeRequestId: cr.id,
        actorId: "carol",
      }),
    );

    await as("dave", () =>
      raw.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" }),
    );
    expect(await rowFor(baseNodeId, "dave")).toMatchObject({ source: "auto" });
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "change_request.reviewed",
        changeRequestId: cr.id,
        verdict: "approved",
        actorId: "dave",
      }),
    );

    const participants = await resolveChangeRequestParticipants(db, LOCAL_SPACE_ID, cr.id);
    expect(Object.fromEntries(participants.map((p) => [p.actorId, p.roles]))).toEqual({
      bob: ["submitter"],
      carol: ["commenter"],
      dave: ["reviewer"],
    });

    events.length = 0;
    await as("dave", () => raw.changeRequests.merge({ changeRequestIds: [cr.id] }));
    expect(events).toEqual([
      expect.objectContaining({
        kind: "change_request.resolved",
        changeRequestId: cr.id,
        status: "merged",
        submittedBy: "bob",
        wasHumanReviewed: true,
        actorId: "dave",
      }),
    ]);
  });

  it("fires change_request.revised when an operation is revised", async () => {
    const cr = await submitRecord("kate", "Will be revised");
    events.length = 0;
    const operationId = cr.primaryOperation?.id ?? "";
    expect(operationId).not.toBe("");
    await as("kate", () =>
      raw.operations.revise({ operationId, fields: { title: "Revised title" } }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "change_request.revised",
        changeRequestId: cr.id,
        actorId: "kate",
      }),
    );
    // Revising re-touches the submitter's own (already-auto) subscription —
    // it must not flip it to "manual" or otherwise disturb it.
    expect(await rowFor(baseNodeId, "kate")).toMatchObject({ source: "auto", mutedAt: null });
  });

  it("subscribes a record commenter to the node without firing a Change Request event", async () => {
    const cr = await submitRecord("leo", "Record for a direct comment");
    // Merge it first so the record is addressable outside the CR — a create
    // operation only gets its `mergedRecordId` once merged.
    const recordId = await as("alice", async () => {
      await raw.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
      await raw.changeRequests.merge({ changeRequestIds: [cr.id] });
      const detail = await raw.changeRequests.get({ changeRequestId: cr.id });
      return detail?.operations[0]?.mergedRecordId;
    });
    expect(recordId).toBeTruthy();
    events.length = 0;
    await as("mia", () =>
      raw.comments.create({
        subjectType: "record",
        subjectId: recordId as string,
        body: "Nice record",
      }),
    );
    // Subscribes Mia to the Base's node — but a record comment carries no
    // changeRequestId, so there is no `change_request.commented` event to fire.
    expect(await rowFor(baseNodeId, "mia")).toMatchObject({ source: "auto" });
    expect(events).toEqual([]);
  });

  it("does not treat a direct write's automatic self-approval as a vote", async () => {
    events.length = 0;
    const created = await as("gina", () =>
      raw.bases.createChangeRequest({ baseId, fields: { title: "Direct" }, message: "Direct" }),
    );
    expect(created.materialized).toBe(true);
    expect(events.map((event) => event.kind)).toEqual(["change_request.resolved", "node.changed"]);
    expect(events[0]).toMatchObject({ wasHumanReviewed: false });
    expect(events[1]).toMatchObject({ nodeId: baseNodeId, actorId: "gina" });
    // gina is subscribed because she wrote to it — not as a "reviewer".
    expect(await rowFor(baseNodeId, "gina")).toMatchObject({ source: "auto" });
  });

  it("keeps an unsubscribe through later submits and comments", async () => {
    await as("bob", () => raw.nodes.subscription.set({ nodeId: baseNodeId, subscribed: false }));
    expect(await as("bob", () => raw.nodes.subscription.get({ nodeId: baseNodeId }))).toMatchObject(
      { state: "muted" },
    );

    const cr = await submitRecord("bob", "Second");
    await as("bob", () =>
      raw.comments.create({ subjectType: "change_request", subjectId: cr.id, body: "bump" }),
    );
    const row = await rowFor(baseNodeId, "bob");
    expect(row?.mutedAt).toBeInstanceOf(Date);
    expect(await as("bob", () => raw.nodes.subscription.get({ nodeId: baseNodeId }))).toMatchObject(
      { state: "muted" },
    );
    const { subscribers } = await resolveNodeSubscribers(db, LOCAL_SPACE_ID, baseNodeId);
    expect(subscribers.map((s) => s.actorId)).not.toContain("bob");

    // Only a manual Subscribe clears the mute.
    await as("bob", () => raw.nodes.subscription.set({ nodeId: baseNodeId, subscribed: true }));
    expect(await rowFor(baseNodeId, "bob")).toMatchObject({ source: "manual", mutedAt: null });
  });

  it("inherits a folder subscription, and a child mute silences only that child", async () => {
    await as("erin", () => raw.nodes.subscription.set({ nodeId: folderId, subscribed: true }));
    expect(await as("erin", () => raw.nodes.subscription.get({ nodeId: baseNodeId }))).toEqual({
      nodeId: baseNodeId,
      state: "inherited",
      source: "manual",
      via: { id: folderId, name: "projects", type: "folder", slug: "projects" },
    });

    await as("erin", () => raw.nodes.subscription.set({ nodeId: baseNodeId, subscribed: false }));
    expect(
      await as("erin", () => raw.nodes.subscription.get({ nodeId: baseNodeId })),
    ).toMatchObject({ state: "muted" });
    // The folder row is untouched; the sibling still inherits it.
    expect(await rowFor(folderId, "erin")).toMatchObject({ mutedAt: null });
    expect(await as("erin", () => raw.nodes.subscription.get({ nodeId: siblingId }))).toMatchObject(
      { state: "inherited", via: { id: folderId } },
    );

    const base = await resolveNodeSubscribers(db, LOCAL_SPACE_ID, baseNodeId);
    expect(base.subscribers.map((s) => s.actorId)).not.toContain("erin");
    const sibling = await resolveNodeSubscribers(db, LOCAL_SPACE_ID, siblingId);
    expect(sibling.subscribers).toContainEqual(
      expect.objectContaining({ actorId: "erin", viaNodeId: folderId }),
    );
  });

  it("follows the CURRENT ancestor chain when a node moves", async () => {
    await as("frank", () => raw.nodes.subscription.set({ nodeId: folderId, subscribed: true }));
    await as("yuki", () => raw.nodes.subscription.set({ nodeId: otherFolderId, subscribed: true }));
    const before = await resolveNodeSubscribers(db, LOCAL_SPACE_ID, baseNodeId);
    expect(before.subscribers.map((s) => s.actorId)).toContain("frank");
    expect(before.subscribers.map((s) => s.actorId)).not.toContain("yuki");

    await as("alice", () => raw.nodes.move({ nodeId: baseNodeId, parentNodeId: otherFolderId }));

    const after = await resolveNodeSubscribers(db, LOCAL_SPACE_ID, baseNodeId);
    expect(after.subscribers.map((s) => s.actorId)).not.toContain("frank");
    expect(after.subscribers).toContainEqual(
      expect.objectContaining({ actorId: "yuki", viaNodeId: otherFolderId }),
    );
    expect(after.node).toMatchObject({ id: baseNodeId, type: "base", createdBy: "alice" });
    expect(after.chain[1]?.id).toBe(otherFolderId);
  });

  it("resolves a pending node create to its parent without subscribing the proposer to it", async () => {
    events.length = 0;
    const cr = await as("hank", () =>
      raw.nodes.createChangeRequest({
        operations: [
          {
            kind: "create",
            nodeType: "folder",
            slug: "proposal",
            name: "Proposal",
            parentNodeId: folderId,
          },
        ],
        autoMerge: false,
      }),
    );
    expect(await resolveChangeRequestTarget(db, LOCAL_SPACE_ID, cr.id)).toMatchObject({
      nodeId: folderId,
      scope: "parent",
    });
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "change_request.pending_review", nodeId: folderId }),
    );
    expect(await rowFor(folderId, "hank")).toBeNull();

    // Merging it is what subscribes the proposer — to the new node only.
    await as("alice", async () => {
      await raw.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
      await raw.changeRequests.merge({ changeRequestIds: [cr.id] });
    });
    const merged = await as("alice", () => raw.changeRequests.get({ changeRequestId: cr.id }));
    const newNodeId = merged?.mergeSummary.mergedNodeIds?.[0];
    expect(newNodeId).toBeTruthy();
    expect(await rowFor(newNodeId as string, "hank")).toMatchObject({ source: "auto" });
    expect(await rowFor(folderId, "hank")).toBeNull();
  });

  it("announces a close as a rejected outcome", async () => {
    const cr = await submitRecord("ivan", "Will be closed");
    events.length = 0;
    await as("alice", () => raw.changeRequests.close({ changeRequestId: cr.id }));
    expect(events).toEqual([
      expect.objectContaining({
        kind: "change_request.resolved",
        status: "rejected",
        submittedBy: "ivan",
        actorId: "alice",
      }),
    ]);
  });

  it("never lets a failing host hook fail the write", async () => {
    const result = await as(
      "jules",
      () =>
        raw.bases.createChangeRequest({
          baseId,
          fields: { title: "Hook explodes" },
          message: "Create",
          autoMerge: false,
        }),
      {
        onNotificationEvent: () => {
          throw new Error("notification service is down");
        },
      },
    );
    expect(result.status).toBe("in_review");
    expect(await rowFor(baseNodeId, "jules")).toMatchObject({ source: "auto" });
  });

  it("filters other actors by node read access", async () => {
    const privateNodeId = await createFolder("alice", "secret");
    await as("alice", async () => {
      await raw.nodes.updateVisibility({ nodeId: privateNodeId, visibility: "private" });
      await raw.nodes.principals.add({
        nodeId: privateNodeId,
        principalType: "user",
        principalId: "granted",
        role: "read",
      });
    });
    const allowed = await filterActorsWithNodeReadAccess(db, {
      spaceId: LOCAL_SPACE_ID,
      nodeId: privateNodeId,
      actorIds: ["admin", "granted", "outsider"],
      managerIds: new Set(["admin"]),
      restrictedVisibility: false,
    });
    expect([...allowed].sort()).toEqual(["admin", "granted"]);

    // Open mode, default visibility: every candidate can read.
    const open = await filterActorsWithNodeReadAccess(db, {
      spaceId: LOCAL_SPACE_ID,
      nodeId: folderId,
      actorIds: ["a", "b"],
      managerIds: new Set(),
      restrictedVisibility: false,
    });
    expect([...open].sort()).toEqual(["a", "b"]);
    // Restricted mode hides a node with no explicit visibility from non-managers.
    const restricted = await filterActorsWithNodeReadAccess(db, {
      spaceId: LOCAL_SPACE_ID,
      nodeId: folderId,
      actorIds: ["a", "admin"],
      managerIds: new Set(["admin"]),
      restrictedVisibility: true,
    });
    expect([...restricted]).toEqual(["admin"]);
  });
});
