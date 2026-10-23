# Busabase Email SDK

Send an email, capture its reply, and keep the conversation in your Busabase records.

`busabase-email-sdk` is an MIT-licensed, server-side Node.js package in the
[Busabase project](https://github.com/busabase/busabase). It supports SMTP (including
SES SMTP), Amazon SES API, read-only IMAP inbox batches, and configurable Base fields.
The same primitives work for customer follow-ups, creator outreach, and support workflows.

## Install

```sh
npm install busabase-email-sdk
```

Requires Node.js 24.18 or newer. To work from source in this repository:

```sh
pnpm install
pnpm --filter busabase-email-sdk typecheck
pnpm --filter busabase-email-sdk test
pnpm --filter busabase-email-sdk build
```

## Preview a message

Markdown is the source of truth. The renderer produces sanitized HTML and a readable
plain-text fallback with complete link destinations. Headings, underlined links,
external images, and inline attachment images are supported.

```ts
import { renderEmail } from "busabase-email-sdk";

const message = {
  from: "Example team <sales@example.com>",
  to: "buyer@example.net",
  replyTo: "sales@example.com",
  subject: "Following up on your project",
  markdown: [
    "## How could this help your team?",
    "Start with one task you would like to improve.",
    "**[→ View the example](https://example.com/article#section-2)**",
  ].join("\n\n"),
};

const preview = await renderEmail(message); // No network access or delivery.
console.log(preview.text);
```

Pass `html` for a custom email layout, or `text` for a plain-text message. An explicit
`text` value overrides the generated fallback. Image URLs must be HTTP(S) or `cid:`;
attachments accept supplied bytes, never arbitrary filesystem paths or remote downloads.

## Send through SMTP or SES

```ts
import { createSmtpTransport, createSesTransport } from "busabase-email-sdk";

const smtp = createSmtpTransport({
  host: process.env.SMTP_HOST,
  port: 465,
  secure: true,
  auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
});

// Invoke only after your application has obtained the required sending approval.
const receipt = await smtp.send(message);
console.log(receipt.messageId, receipt.accepted, receipt.rejected);
await smtp.close?.();

// Alternative: AWS SDK credential provider chain; no credentials in source files.
const ses = createSesTransport({
  config: { region: process.env.AWS_REGION },
  configurationSetName: process.env.SES_CONFIGURATION_SET,
});
```

SES SMTP uses `createSmtpTransport` with SES SMTP endpoint/credentials. SES API uses
`SendRawEmail`, preserving MIME attachments, Unicode, Reply-To, and thread headers.
For a reply, pass `inReplyTo` and `references`, and keep the original subject with `Re:`.

`messageId` is the RFC Message-ID when known; `providerMessageId` is the provider's
receipt identifier. SES replaces the MIME Message-ID, so its receipt has
`messageId: null`. Keep both fields. A successful submission is not proof of delivery,
an open, a click, or a reply. Check partial SMTP rejection in `receipt.rejected`.
The record store uses accepted recipients for sent `contact`; optional `accepted`,
`rejected`, `to`, `cc`, `bcc` mappings retain submission details. Partial rejection is
also appended to the summary so refused recipients are not silently recorded as sent.

SES API defaults to one attempt because sending has no provider idempotency token.
If you supply your own AWS client or override `maxAttempts`, you own its retry policy.
On ambiguous network failure, reconcile delivery before sending again.

## Record into your own Base

Create or use a Base with an `external-key` text field. Configure the remaining fields
to match your workflow; there are no fixed workspace, Campaign, or Base IDs.

| Suggested field | Type | Purpose |
| --- | --- | --- |
| `title` | text, primary | Human-readable subject |
| `external-key` | text | Stable event identity for deduplication |
| `type` | select or text | `sent`, `reply`, `auto-reply`, `bounce` |
| `happened-at` | date | Event time |
| `contact` | text | Accepted recipient addresses for sent mail; sender for received mail |
| `accepted`, `rejected` | text, optional | Submission receipt addresses; intended To can be mapped separately |
| `campaign` | relation, optional | Your campaign record |
| `account-key` | text | Stable mailbox identity |
| `provider` | text | SMTP or SES |
| `message-id` | text | RFC Message-ID |
| `provider-message-id` | text | Provider receipt identifier |
| `summary` | markdown or longtext | Outgoing content or incoming reply |

```ts
import { createBusabaseClient } from "busabase-sdk";
import { createBusabaseEmailStore, sendAndRecord } from "busabase-email-sdk";

const client = createBusabaseClient({
  baseUrl: process.env.BUSABASE_BASE_URL,
  apiKey: process.env.BUSABASE_API_KEY,
  spaceId: process.env.BUSABASE_SPACE_ID,
});

const store = createBusabaseEmailStore({
  client,
  baseId: process.env.EMAIL_LOG_BASE_ID!,
  accountKey: "sales-mailbox",
  campaignId: process.env.EMAIL_CAMPAIGN_ID,
  fields: {
    externalKey: "external-key", title: "title", type: "type",
    date: "happened-at", contact: "contact", campaign: "campaign",
    account: "account-key", provider: "provider", messageId: "message-id",
    providerMessageId: "provider-message-id", summary: "summary",
  },
  // Override select values when your Base uses different names.
  values: { sent: "sent", reply: "reply", "auto-reply": "auto-reply", bounce: "bounce" },
});

const outcome = await sendAndRecord({ transport: smtp, store, message });
console.log(outcome.record.status); // applied, pending, or duplicate
```

Writes go through Change Requests. The SDK omits `autoMerge` and never approves or
merges proposals. With write access an event can apply immediately; with proposal
access it remains pending and returns a Change Request ID.

If delivery succeeds but recording fails, `sendAndRecord` throws
`SentEmailNotRecordedError` carrying the receipt, original message, and context. Persist
all three and retry `store.recordSent(error.originalMessage, error.receipt, error.context)`;
**do not resend the email**. Sending and
database persistence are separate operations, not a distributed transaction.

The store uses exact external-key lookup and the server's `idempotencyKey` support.
Use a Busabase version supporting record-create idempotency for concurrent workers;
on older servers, serialize writes because lookup alone cannot prevent races.
Set a stable `accountKey` for every physical mailbox, including shared aliases.

## Capture replies and resume after interruptions

```ts
import { loadReplyWatch, syncImapReplies } from "busabase-email-sdk";

const watch = await loadReplyWatch({
  client,
  baseId: process.env.EMAIL_LOG_BASE_ID!,
  campaignId: process.env.EMAIL_CAMPAIGN_ID,
  accountKey: "sales-mailbox",
  fields: {
    type: "type", campaign: "campaign", account: "account-key",
    contact: "contact", messageId: "message-id",
    provider: "provider", providerMessageId: "provider-message-id",
  },
});

const nextState = await syncImapReplies({
  accountKey: "sales-mailbox",
  watchKey: process.env.EMAIL_CAMPAIGN_ID ?? "all-outbound",
  imap: {
    host: process.env.IMAP_HOST!, port: 993, secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASS! },
  },
  watch, store,
  state: await loadState(), // Storage for this account AND watch; undefined on first run.
  limit: 100,
  saveState: async (state) => { await saveStateAtomically(state); },
});
```

`loadState` and `saveStateAtomically` are your application functions. Store the complete
state: account, watchKey, mailbox, UIDVALIDITY, UID, and pending Change Request IDs.
Use a separate state per campaign/watch: a cursor that already skipped unrelated
messages must never be reused for another campaign. Run one sync at a time per scope;
use an external worker or scheduler to call it again.
No background process or automatic reply starts when this package is imported.

IMAP uses read-only selection and BODY.PEEK, leaving Seen flags unchanged. Unmatched
mail is acknowledged without adding an outreach record. Each matching email is
persisted before its UID checkpoint advances. Pending proposals are durably retained
in the state; reconcile their approval/rejection separately. A UIDVALIDITY change
raises `MailboxResetError`: deliberately restart the scan and rely on event identity
deduplication. Preserve pending proposal IDs during that recovery.

For manual processing, `readImapReplies` returns both matched and unmatched messages
and its read cursor. Do not save that cursor before processing the complete batch.
Sender-only matches are candidates, not proof that a message belongs to one particular
campaign. `syncImapReplies` raises `ReplyNeedsResolutionError` before checkpointing a
batch containing such a candidate. Pass `resolveContext(entry)` to explicitly return
the correct `{ campaignId, contactId }`, or `null` to deliberately skip it. Use the same
accountKey in the store and sync helper so low-level and high-level writes deduplicate.
A watch should include all outgoing IDs, including follow-up messages. Canonical
records omit pending proposals: include their receipts explicitly in the watch or wait
for review before polling; otherwise an early reply could be scanned before its outgoing
ID is known. Empty watches are rejected. Anonymous mail without Message-ID requires a stable
account + mailbox + UIDVALIDITY + UID external key.

## SES notifications and inbound mail

```ts
import { parseSesNotification, parseSesInbound } from "busabase-email-sdk";

// Validate the source/signature at your HTTP endpoint before parsing.
const event = parseSesNotification(verifiedSnsPayload);
// type: delivery | bounce | complaint | open | click

const inbound = await parseSesInbound(verifiedInboundPayload);
if (inbound.kind === "s3") {
  const rawMime = await readAuthorizedS3Object(inbound.bucket, inbound.key);
  const parsed = await parseSesInbound(rawMime);
}
```

These helpers parse direct SES events or SNS JSON envelopes; they do **not** validate
webhook authenticity, confirm SNS subscriptions, read S3, or start an HTTP server.
Handle those at your ingress service using your AWS permissions. A Lambda event
containing only headers is not a complete message; the helper reports that the body
must be retrieved instead of inventing an empty reply.

Received `text` preserves the complete decoded body, including inline answers. Optional
`replyText` is only a heuristic preview with quoted history removed; never replace the
original body with that preview when saving a conversation.

Received `html` is untrusted original content. Sanitize it before showing it in an app.
Received attachments are returned as bytes and are never executed or automatically
written to disk. Delivery/open/click events and human replies remain distinct events;
classify commercial intent and unsubscribe requests in the calling workflow.

## Examples and verification

`examples/send.mjs` previews by default and requires `--send` to deliver. It reads
credentials from environment variables and has no built-in account or contact list.

Tests exercise actual localhost SMTP and IMAP connections, MIME attachment round-trips,
the real AWS SDK against a local HTTP endpoint, and the Busabase SDK's HTTP requests.
They also cover pending proposals, replay, UIDVALIDITY reset, failed persistence,
thread matching, Exmail Message-ID normalization, and Bcc privacy.

These local fixtures do not prove a production mailbox is authorized or that an AWS
identity has production sending access. Verify those with your own approved test
recipients before enabling a deployed worker.
