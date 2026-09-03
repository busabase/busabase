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

interface CommentMentionVO {
  type: "member" | "agent";
  targetId: string;
  label: string;
  start: number;
  end: number;
  dispatchStatus: string;
  sessionId: string | null;
  error: string | null;
}

interface CommentVO {
  id: string;
  subjectType: string;
  subjectId: string;
  body: string;
  mentions: CommentMentionVO[];
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
    // Keyset-paginated envelope, not a bare array — same drift 07-change-requests
    // carried.
    const { changeRequests: crs } = await api<{ changeRequests: ChangeRequestVO[] }>(
      "GET",
      "/change-requests",
    );
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

  // A structured mention, not a regex over the text: `start`/`end` are UTF-16
  // code unit offsets into `body`, and the server validates them rather than
  // guessing a target from prose.
  const MENTION_BODY = "@Alice please attach the source and re-request review.";

  await step("POST /comments — structured @member mention", async () => {
    if (!crId) return;
    const comment = await api<CommentVO>("POST", "/comments", {
      subjectType: "change_request",
      subjectId: crId,
      authorId: "demo-reviewer",
      body: MENTION_BODY,
      mentions: [{ type: "member", id: "local-editor", start: 0, end: 6 }],
    });
    assert(comment.mentions.length === 1, "expected exactly one mention");
    assert(comment.mentions[0].targetId === "local-editor", "unexpected mention target");
    assert(
      comment.body.slice(comment.mentions[0].start, comment.mentions[0].end) === "@Alice",
      "mention span does not cover the mention text",
    );
  });

  await step("POST /comments — an out-of-bounds span is rejected, not dropped", async () => {
    if (!crId) return;
    let rejected = false;
    try {
      await api<CommentVO>("POST", "/comments", {
        subjectType: "change_request",
        subjectId: crId,
        authorId: "demo-reviewer",
        body: "short",
        mentions: [{ type: "member", id: "local-editor", start: 0, end: 999 }],
      });
    } catch {
      rejected = true;
    }
    assert(rejected, "expected an out-of-bounds mention span to be rejected");
  });

  await step("GET /comments — CR comments include the ones we posted", async () => {
    if (!crId) return;
    const comments = await listComments("change_request", crId);
    assert(comments.length >= 2, `expected >= 2 comments, got ${comments.length}`);
    assert(
      comments.some((c) => c.mentions.length > 0),
      "expected at least one structured mention",
    );
  });

  // ── Comment on a record ────────────────────────────────────────────────────

  await step("POST /comments + GET /comments — comment on a record", async () => {
    // Comment on a record this walkthrough CREATED, not `records[0]`.
    //
    // Seeded records are not commentable today: commenting resolves
    // record -> headCommitId -> commits ⋈ operations to find the owning
    // ChangeRequest for permission scoping, and the seeder writes commits
    // directly with no operation row, so that join comes back empty and the API
    // answers `404 Subject not found: cmt_…` for a record that plainly exists.
    // That is a real product gap (tracked separately) — not something this
    // walkthrough should paper over by skipping the step, so it comments on a
    // record with a proper CR history instead, which is also what a real user's
    // records look like.
    const bases = await api<Array<{ id: string; slug: string }>>("GET", "/bases");
    const blogBase = bases.find((b) => b.slug === "blog");
    if (!blogBase) return;

    const stamp = Date.now();
    const created = await api<{ id: string }>("POST", `/bases/${blogBase.id}/change-requests`, {
      fields: {
        title: `[demo] comment subject ${stamp}`,
        body: "A record created through the CR pipeline, so it has an operation history.",
        status: "draft",
        path: `/blog/demo-comment-subject-${stamp}`,
        slug: `demo-comment-subject-${stamp}`,
        locale: "en",
        "schema-version": 1,
      },
      message: "demo: record to comment on",
      submittedBy: "demo-script",
      autoMerge: true,
    });
    const recordId = created.id;
    assert(recordId.startsWith("rec"), `expected a materialized record id, got ${recordId}`);

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
