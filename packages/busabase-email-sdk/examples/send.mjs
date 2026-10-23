import { readFile } from "node:fs/promises";
import { createSmtpTransport, renderEmail } from "busabase-email-sdk";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in your environment`);
  return value;
};

const message = {
  from: required("EMAIL_FROM"),
  to: required("EMAIL_TO"),
  replyTo: process.env.EMAIL_REPLY_TO,
  subject: required("EMAIL_SUBJECT"),
  markdown: await readFile(required("EMAIL_MARKDOWN_FILE"), "utf8"),
};

if (!process.argv.includes("--send")) {
  const preview = await renderEmail(message);
  console.log(preview.text);
  console.log("Preview only. Review the message and recipient before adding --send.");
} else {
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = createSmtpTransport({
    host: required("SMTP_HOST"),
    port,
    secure: port === 465,
    auth: { user: required("SMTP_USER"), pass: required("SMTP_PASS") },
  });
  try {
    const receipt = await transport.send(message);
    console.log(JSON.stringify(receipt));
  } finally {
    await transport.close?.();
  }
}
