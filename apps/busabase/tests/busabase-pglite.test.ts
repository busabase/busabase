import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("busabase pglite integration flow", () => {
  let dataDir = "";
  let storageDir = "";

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-test-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-storage-test-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  it("seeds bases and completes change request -> review -> merge", async () => {
    const store = await import("busabase-core/logic/store");
    const skills = await import("busabase-core/domains/skill/handlers");
    const base = await import("busabase-core/domains/base/handlers");
    const { englishScenario } = await import("busabase-core/demo/dataset");

    await store.seedScenario(englishScenario);

    const bases = await base.listBases();
    expect(bases.map((base) => base.slug)).toEqual(
      expect.arrayContaining(["blog", "social-content", "newsletter"]),
    );

    const nodes = await store.listNodes();
    expect(nodes[0]?.type).toBe("folder");
    expect(nodes[0]?.children.some((node) => node.type === "folder")).toBe(true);
    expect(JSON.stringify(nodes)).toContain("Blog Posts");
    expect(JSON.stringify(nodes)).toContain("AI Research Editor");

    const seededSkills = await skills.listSkills();
    const seededSkill = seededSkills.find((item) => item.node.slug === "ai-research-editor");
    if (!seededSkill) {
      throw new Error("Expected seeded AI Research Editor skill");
    }
    expect(seededSkill.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "SKILL.md",
        "examples",
        "examples/review-comment.md",
        "references",
        "references/source-policy.md",
        "skill.json",
      ]),
    );
    const seededSkillMd = await skills.readSkillFile(seededSkill.node.id, "SKILL.md");
    expect(seededSkillMd.content).toContain("AI Research Editor");

    const folderChangeRequest = await store.createNodeChangeRequest({
      operations: [
        {
          kind: "create",
          name: "Agent Skills",
          nodeType: "folder",
          slug: "agent-skills",
        },
      ],
      submittedBy: "vitest-agent",
    });
    expect(folderChangeRequest.primaryOperation?.operation).toBe("node_create");
    await store.reviewChangeRequest(folderChangeRequest.id, { verdict: "approved" });
    const mergedFolderChangeRequest = await store.mergeChangeRequest(folderChangeRequest.id);
    expect(mergedFolderChangeRequest.record).toBeNull();
    const mergedNodeIds = mergedFolderChangeRequest.changeRequest.mergeSummary.mergedNodeIds;
    expect(Array.isArray(mergedNodeIds) ? mergedNodeIds : []).toHaveLength(1);
    const agentSkillsFolderId = String(Array.isArray(mergedNodeIds) ? mergedNodeIds[0] : "");

    const skill = await skills.createSkill({
      description: "Drafts launch announcements with a consistent review checklist.",
      files: [{ content: "Tone: concise and evidence-led.\n", path: "references/tone.md" }],
      name: "Launch Writer",
      parentNodeId: agentSkillsFolderId,
      slug: "launch-writer",
    });
    expect(skill.node.type).toBe("skill");
    expect(skill.files.some((file) => file.path === "SKILL.md")).toBe(true);
    expect(skill.files.some((file) => file.path === "references/tone.md")).toBe(true);

    const currentSkillMd = await skills.readSkillFile(skill.node.id, "SKILL.md");
    const skillChangeRequest = await skills.createSkillChangeRequest(skill.node.id, {
      operations: [
        {
          baseContentHash: currentSkillMd.contentHash,
          content: `${currentSkillMd.content}\n## Review checklist\n\n- Verify source links.\n`,
          kind: "update",
          path: "SKILL.md",
        },
      ],
      submittedBy: "vitest-agent",
    });
    expect(skillChangeRequest.primaryOperation?.operation).toBe("skill_file_update");
    await store.reviewChangeRequest(skillChangeRequest.id, { verdict: "approved" });
    await store.mergeChangeRequest(skillChangeRequest.id);
    const updatedSkillMd = await skills.readSkillFile(skill.node.id, "SKILL.md");
    expect(updatedSkillMd.content).toContain("Review checklist");

    const seededRecords = await base.listRecords({ limit: 100 });
    expect(seededRecords.length).toBeGreaterThanOrEqual(5);
    expect(seededRecords.some((record) => record.base.slug === "social-content")).toBe(true);
    const seededNewsletter = seededRecords.find((record) => record.base.slug === "newsletter");
    expect(seededNewsletter?.base.fields.find((field) => field.slug === "body")?.type).toBe("html");
    expect(String(seededNewsletter?.headCommit.fields.body)).toContain("<article>");

    const seededChangeRequests = await store.listChangeRequests({ limit: 100 });
    const seededSkillChangeRequest = seededChangeRequests.find(
      (item) => item.id === "crq_seed_skill_research_editor",
    );
    expect(seededSkillChangeRequest?.base).toBeNull();
    expect(seededSkillChangeRequest?.node?.slug).toBe("ai-research-editor");
    expect(seededSkillChangeRequest?.primaryOperation?.operation).toBe("skill_file_update");
    expect(seededSkillChangeRequest?.primaryOperation?.filePath).toBe("SKILL.md");
    const batchChangeRequest = seededChangeRequests.find(
      (item) => item.id === "crq_seed_social_batch",
    );
    expect(batchChangeRequest?.operationCount).toBe(3);
    expect(batchChangeRequest?.operations.map((operation) => operation.operation)).toEqual([
      "record_create",
      "record_update",
      "record_delete",
    ]);
    expect(seededChangeRequests.some((item) => item.status === "approved")).toBe(true);

    const blogBase = bases.find((base) => base.slug === "blog");
    if (!blogBase) {
      throw new Error("Expected blog base to be seeded");
    }
    const socialBase = bases.find((base) => base.slug === "social-content");
    if (!socialBase) {
      throw new Error("Expected social base to be seeded");
    }
    expect(blogBase.fields.find((field) => field.slug === "related_social")?.type).toBe("relation");
    expect(
      Object.fromEntries(blogBase.fields.map((field) => [field.slug, field.type])),
    ).toMatchObject({
      ai_summary: "ai_summary",
      ai_tags: "ai_tags",
      contact_email: "email",
      contact_phone: "phone",
      created_time: "created_time",
      priority: "number",
      publish_date: "date",
      ready: "checkbox",
      source_url: "url",
      status: "select",
      tags: "multiselect",
    });
    expect(
      blogBase.fields
        .find((field) => field.slug === "status")
        ?.options.choices?.map((choice) => choice.id),
    ).toEqual(["idea", "drafting", "published"]);

    const changeRequest = await base.createChangeRequest(blogBase.id, {
      fields: {
        title: "Busabase PGlite integration test",
        body: "This change request was created inside the PGlite logic integration test.",
        channel: "blog",
      },
      message: "Vitest PGlite flow",
      submittedBy: "vitest",
    });
    expect(changeRequest.status).toBe("in_review");
    const firstOperation = changeRequest.primaryOperation;
    if (!firstOperation) {
      throw new Error("Expected change request to contain a primary operation");
    }
    const firstCommitId = firstOperation.headCommitId;

    const revised = await store.reviseOperation(firstOperation.id, {
      fields: {
        title: "Busabase PGlite integration test revised",
        body: "This change request was revised on the same operation before review.",
        channel: "blog",
      },
      message: "Human revision",
      author: "vitest-human",
    });
    const revisedOperation = revised.primaryOperation;
    if (!revisedOperation) {
      throw new Error("Expected revised change request to contain a primary operation");
    }
    expect(revisedOperation.id).toBe(firstOperation.id);
    expect(revisedOperation.headCommitId).not.toBe(firstCommitId);
    expect(revisedOperation.headCommit.parentCommitId).toBe(firstCommitId);
    expect(revisedOperation.headCommit.fields.title).toBe(
      "Busabase PGlite integration test revised",
    );

    const approved = await store.reviewChangeRequest(changeRequest.id, { verdict: "approved" });
    expect(approved.status).toBe("approved");
    expect(approved.reviews[0]?.visibleOperationHeads[firstOperation.id]).toBe(
      revisedOperation.headCommitId,
    );

    const merged = await store.mergeChangeRequest(changeRequest.id);
    const mergedRecord = merged.record;
    if (!mergedRecord) {
      throw new Error("Expected record merge to return a canonical record");
    }
    expect(mergedRecord.headCommitId).toBe(revisedOperation.headCommitId);
    expect(mergedRecord.headCommit.parentCommitId).toBe(firstCommitId);
    expect(mergedRecord.headCommit.fields.title).toBe("Busabase PGlite integration test revised");

    const records = await base.listRecords({ limit: 100 });
    expect(records.some((record) => record.id === mergedRecord.id)).toBe(true);
    const seededBlogRecord = records.find((record) => record.id === "rec_seed_blog_approval");
    if (!seededBlogRecord) {
      throw new Error("Expected seeded blog record");
    }
    expect(seededBlogRecord.headCommit.fields.priority).toBe(1);
    expect(seededBlogRecord.headCommit.fields.publish_date).toBe("2026-06-10");
    expect(seededBlogRecord.headCommit.fields.ready).toBe(true);
    expect(seededBlogRecord.headCommit.fields.status).toBe("published");
    expect(seededBlogRecord.headCommit.fields.tags).toEqual(["agents", "policy"]);
    expect(seededBlogRecord.headCommit.fields.source_url).toContain("ai-agent-workflows");
    expect(seededBlogRecord.headCommit.fields.contact_email).toBe("editor@busabase.local");
    expect(seededBlogRecord.headCommit.fields.contact_phone).toBe("+1-555-0101");
    expect(seededBlogRecord.headCommit.fields.ai_summary).toContain("operator workflows");
    expect(seededBlogRecord.headCommit.fields.ai_tags).toEqual(["agents", "workflow", "trust"]);
    const seededLinks = await base.listRecordLinks(seededBlogRecord.id);
    expect(seededLinks.some((link) => link.fieldSlug === "related_social")).toBe(true);

    const updatedBase = await base.createBaseField(blogBase.id, {
      name: "Source Link",
      options: {},
      required: false,
      slug: "source-link",
      type: "text",
    });
    expect(updatedBase.fields.some((field) => field.slug === "source-link")).toBe(true);

    const recordChangeRequestHistory = await store.listRecordChangeRequests(mergedRecord.id);
    expect(recordChangeRequestHistory.some((item) => item.id === changeRequest.id)).toBe(true);
    expect(
      recordChangeRequestHistory.some((item) =>
        item.operations.some(
          (operation) => operation.headCommitId === revisedOperation.headCommitId,
        ),
      ),
    ).toBe(true);

    const comment = await store.createComment({
      authorId: "vitest-reviewer",
      body: "This canonical record is ready for the AI industry briefing.",
      mentionsAi: true,
      subjectId: mergedRecord.id,
      subjectType: "record",
    });
    expect(comment.recordId).toBe(mergedRecord.id);
    expect(comment.commitId).toBe(mergedRecord.headCommitId);
    const comments = await store.listComments({
      subjectId: mergedRecord.id,
      subjectType: "record",
    });
    expect(comments.some((item) => item.id === comment.id)).toBe(true);

    const limitedRecords = await base.listRecords({ limit: 1 });
    expect(limitedRecords).toHaveLength(1);

    const projectedRecords = await base.listRecordsByFieldText({
      baseId: blogBase.id,
      fieldSlug: "channel",
      valueText: "blog",
    });
    expect(projectedRecords.some((record) => record.id === mergedRecord.id)).toBe(true);

    const initialViews = await base.listViews(blogBase.id);
    expect(initialViews.map((view) => view.slug)).toEqual(
      expect.arrayContaining(["all-records", "ready-to-publish", "drafts"]),
    );
    const viewChangeRequest = await base.createViewChangeRequest(blogBase.id, {
      config: {
        filters: [{ fieldSlug: "tags", operator: "contains", value: "agents" }],
        sorts: [{ direction: "desc", fieldSlug: "publish_date" }],
        visibleFieldSlugs: ["title", "tags", "publish_date"],
      },
      name: "Agent Posts",
      slug: "agent-posts",
      submittedBy: "vitest-agent",
    });
    expect(viewChangeRequest.primaryOperation?.operation).toBe("view_create");
    await store.reviewChangeRequest(viewChangeRequest.id, { verdict: "approved" });
    const mergedViewChangeRequest = await store.mergeChangeRequest(viewChangeRequest.id);
    expect(mergedViewChangeRequest.record).toBeNull();
    expect(mergedViewChangeRequest.view?.slug).toBe("agent-posts");
    const defaultFieldsViewChangeRequest = await base.createViewChangeRequest(blogBase.id, {
      config: {
        filters: [],
        sorts: [],
      },
      name: "Default Fields",
      slug: "default-fields",
      submittedBy: "vitest-agent",
    });
    await store.reviewChangeRequest(defaultFieldsViewChangeRequest.id, { verdict: "approved" });
    const mergedDefaultFieldsView = await store.mergeChangeRequest(
      defaultFieldsViewChangeRequest.id,
    );
    expect(mergedDefaultFieldsView.view?.config.visibleFieldSlugs).toBeUndefined();

    const noFieldsViewChangeRequest = await base.createViewChangeRequest(blogBase.id, {
      config: {
        filters: [],
        sorts: [],
        visibleFieldSlugs: [],
      },
      name: "No Fields",
      slug: "no-fields",
      submittedBy: "vitest-agent",
    });
    await store.reviewChangeRequest(noFieldsViewChangeRequest.id, { verdict: "approved" });
    const mergedNoFieldsView = await store.mergeChangeRequest(noFieldsViewChangeRequest.id);
    expect(mergedNoFieldsView.view?.config.visibleFieldSlugs).toEqual([]);

    const mergedViews = await base.listViews(blogBase.id);
    expect(mergedViews.some((view) => view.slug === "agent-posts")).toBe(true);
    expect(
      mergedViews.find((view) => view.slug === "default-fields")?.config.visibleFieldSlugs,
    ).toBeUndefined();
    expect(mergedViews.find((view) => view.slug === "no-fields")?.config.visibleFieldSlugs).toEqual(
      [],
    );

    await store.createAuditEvent({
      action: "record.viewed",
      actorId: "vitest-viewer",
      baseId: mergedRecord.baseId,
      commitId: mergedRecord.headCommitId,
      metadata: { title: "Busabase PGlite integration test revised" },
      recordId: mergedRecord.id,
    });
    const auditEvents = await store.listAuditEvents({ limit: 20 });
    expect(auditEvents.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "change_request.created",
        "change_request.updated",
        "change_request.reviewed",
        "change_request.merged",
        "record.viewed",
      ]),
    );

    const searchResults = await store.searchBusabase({
      limit: 1,
      offset: 0,
      query: "AI",
    });
    expect(searchResults.results.length).toBeGreaterThan(0);
    expect(searchResults.hasMore).toBe(true);

    const nextSearchPage = await store.searchBusabase({
      limit: 1,
      offset: 1,
      query: "AI",
    });
    expect(nextSearchPage.offset).toBe(1);
    expect(nextSearchPage.results.length).toBeGreaterThan(0);

    const recordSearchResults = await store.searchBusabase({
      limit: 5,
      offset: 0,
      query: "PGlite integration revised",
    });
    expect(recordSearchResults.results.some((result) => result.kind === "record")).toBe(true);

    const changeRequestSearchResults = await store.searchBusabase({
      limit: 5,
      offset: 0,
      query: "browser",
    });
    expect(
      changeRequestSearchResults.results.some((result) => result.kind === "change_request"),
    ).toBe(true);

    // The richer demo seed has many "news"-heavy records, so widen the page to
    // confirm the Newsletter base still surfaces among the search results.
    const baseSearchResults = await store.searchBusabase({
      limit: 30,
      offset: 0,
      query: "Newsletter",
    });
    expect(baseSearchResults.results.some((result) => result.kind === "base")).toBe(true);

    const emptySearchResults = await store.searchBusabase({ query: "   " });
    expect(emptySearchResults.results).toEqual([]);
    expect(emptySearchResults.hasMore).toBe(false);
  });

  it("builds a typed orpc client against the shared contract", async () => {
    const { createBusabaseORPCClient } = await import("busabase-contract/api-client");
    expect(typeof createBusabaseORPCClient).toBe("function");
  });
});
