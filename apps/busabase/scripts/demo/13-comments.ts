/**
 * 13-comments: Comment lifecycle — post a review comment on a change request
 * (including an @agent mention) and on a record, then list them back.
 * POST /comments → GET /comments?subjectType=…&subjectId=…
 */

import { api, assert, BASE, makeRunner } from "./_client";

interface ChangeRequestVO {
  id: string;
  status: string;
}

interface RecordVO {
  id: string;
}

interface CommentVO {
  id: string;
  subjectType: string;
  subjectId: string;
  body: string;
  mentionsAi: boolean;
}

const listComments = (subjectType: string, subjectId: string) =>
  api<CommentVO[]>(
    "GET",
    `/comments?subjectType=${encodeURIComponent(subjectType)}&subjectId=${encodeURIComponent(subjectId)}`,
  );

export async function run() {
  const { step, summary } = makeRunner("13-comments");
  console.log(`\n💬  Comments  →  ${BASE}\n`);

  // ── Comment on a change request (with an @agent mention) ───────────────────

  let crId = "";
  await step("GET /change-requests — pick a change request to discuss", async () => {
    const crs = await api<ChangeRequestVO[]>("GET", "/change-requests");
    assert(Array.isArray(crs) && crs.length > 0, "expected at least one change request");
    // Prefer an in-review CR (an open discussion); fall back to the first.
    crId = (crs.find((c) => c.status === "in_review") ?? crs[0]).id;
  });

  await step("POST /comments — reviewer comment on the CR", async () => {
    if (!crId) return;
    const comment = await api<CommentVO>("POST", "/comments", {
      subjectType: "change_request",
      subjectId: crId,
      authorId: "demo-reviewer",
      body: "Looks close. Can you add a dated source for the headline claim before I approve?",
    });
    assert(comment.subjectId === crId, "subjectId mismatch");
    assert(
      comment.subjectType === "change_request",
      `unexpected subjectType ${comment.subjectType}`,
    );
  });

  await step("POST /comments — @agent mention (mentionsAi=true)", async () => {
    if (!crId) return;
    const comment = await api<CommentVO>("POST", "/comments", {
      subjectType: "change_request",
      subjectId: crId,
      authorId: "demo-reviewer",
      body: "@agent please attach the source and re-request review.",
      mentionsAi: true,
    });
    assert(comment.mentionsAi === true, "expected mentionsAi=true");
  });

  await step("GET /comments — CR comments include the ones we posted", async () => {
    if (!crId) return;
    const comments = await listComments("change_request", crId);
    assert(comments.length >= 2, `expected >= 2 comments, got ${comments.length}`);
    assert(
      comments.some((c) => c.mentionsAi),
      "expected at least one @agent mention",
    );
  });

  // ── Comment on a record ────────────────────────────────────────────────────

  await step("POST /comments + GET /comments — comment on a record", async () => {
    const records = await api<RecordVO[]>("GET", "/records");
    if (records.length === 0) return;
    const recordId = records[0].id;

    const comment = await api<CommentVO>("POST", "/comments", {
      subjectType: "record",
      subjectId: recordId,
      authorId: "demo-reviewer",
      body: "Nice — this record reads well now.",
    });
    assert(comment.subjectId === recordId, "record subjectId mismatch");

    const comments = await listComments("record", recordId);
    assert(
      comments.some((c) => c.id === comment.id),
      "posted record comment not found in list",
    );
  });

  return summary();
}

if (process.argv[1]?.endsWith("13-comments.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
