import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = await mkdtemp(join(tmpdir(), "busabase-email-consumer-"));
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
};

try {
  const emailPackage = JSON.parse(
    await readFile(join(root, "packages/busabase-email-sdk/package.json"), "utf8"),
  );
  const sdkTarball = join(scratch, "busabase-sdk.tgz");
  const emailTarball = join(scratch, "busabase-email-sdk.tgz");
  // pnpm rewrites workspace protocols to public semver ranges in the tarballs.
  run("pnpm", ["pack", "--out", sdkTarball], join(root, "apps/busabase-sdk"));
  run("pnpm", ["pack", "--out", emailTarball], join(root, "packages/busabase-email-sdk"));
  await writeFile(
    join(scratch, "package.json"),
    JSON.stringify({
      name: "email-sdk-package-check",
      private: true,
      type: "module",
      dependencies: {
        "busabase-sdk": `file:${sdkTarball}`,
        "busabase-email-sdk": `file:${emailTarball}`,
      },
      devDependencies: {
        typescript: emailPackage.devDependencies.typescript,
        "@types/node": emailPackage.devDependencies["@types/node"],
      },
    }),
  );
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], scratch);
  const installed = JSON.parse(
    await readFile(join(scratch, "node_modules/busabase-email-sdk/package.json"), "utf8"),
  );
  assert.equal(installed.version, emailPackage.version);
  assert.ok(!JSON.stringify(installed.dependencies).includes("workspace:"));
  await writeFile(
    join(scratch, "smoke.mjs"),
    `import assert from 'node:assert/strict';
import { createBusabaseClient } from 'busabase-sdk';
import { renderEmail, parseEmail, matchReply, createSmtpTransport, createSesTransport, createBusabaseEmailStore, loadReplyWatch, syncImapReplies, sendAndRecord } from 'busabase-email-sdk';
const message = await renderEmail({ from: 'sales@example.com', to: 'buyer@example.net', subject: 'Package check', markdown: '## Hello\\n\\n**[→ View](https://example.com/#case)**' });
assert.ok(message.html.includes('text-decoration:underline'));
assert.ok(message.text.includes('https://example.com/#case'));
const email = await parseEmail('From: buyer@example.net\\r\\nTo: sales@example.com\\r\\nMessage-ID: <reply@example.net>\\r\\nIn-Reply-To: <sent@example.com>\\r\\nSubject: Reply\\r\\n\\r\\nAnswers below.\\n\\nOn Thu, Sales wrote:\\n> What date works?\\nTuesday at 10 works.');
assert.equal(matchReply(email, { messageIds: ['<sent@example.com>'] }).matchedBy, 'thread');
assert.ok(email.text.includes('Tuesday at 10 works.'));
assert.equal(email.replyText, 'Answers below.');
for (const fn of [createBusabaseClient, createSmtpTransport, createSesTransport, createBusabaseEmailStore, loadReplyWatch, syncImapReplies, sendAndRecord]) assert.equal(typeof fn, 'function');
console.log('Clean package import, Markdown, MIME, thread matching and complete reply checks passed.');
`,
  );
  await writeFile(
    join(scratch, "smoke.ts"),
    `import { createBusabaseClient } from 'busabase-sdk';
import { createBusabaseEmailStore, loadReplyWatch, renderEmail, type EmailMessage, type ImapConfig } from 'busabase-email-sdk';
const client = createBusabaseClient({ baseUrl: 'http://localhost:15419' });
const store = createBusabaseEmailStore({ client, baseId: 'fixture', fields: { externalKey: 'key' } });
const watch = loadReplyWatch({ client, baseId: 'fixture', fields: { messageId: 'message-id' } });
const message: EmailMessage = { from: 'sales@example.com', to: 'buyer@example.net', subject: 'Check', markdown: 'Hello' };
const imap: ImapConfig = { host: 'localhost', port: 993, secure: true, auth: { user: 'fixture', pass: 'fixture' } };
void [store, watch, renderEmail(message), imap];
`,
  );
  run("node", ["smoke.mjs"], scratch);
  run(
    join(scratch, "node_modules/.bin/tsc"),
    [
      "--noEmit",
      "--strict",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--skipLibCheck",
      "smoke.ts",
    ],
    scratch,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
