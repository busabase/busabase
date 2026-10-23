# Changelog

## 0.1.0 — 2026-10-23

First public release of the Busabase Email SDK.

- Send text, Markdown, HTML, and attachments through SMTP or Amazon SES.
- Read IMAP replies without marking messages as read; persist replay-safe checkpoints.
- Match replies to sent messages and record conversations through permission-aware Busabase Change Requests.
- Preserve delivery receipts when recording fails so callers can retry storage without sending again.
- Normalize SES delivery events and inbound email metadata.

Validation includes protocol tests against local SMTP, IMAP, and HTTP servers;
real HTTP round-trips to a file-backed Busabase database; and a controlled
enterprise mailbox send-and-reply exercise. Production SES credentials, sender
identity, and account limits must be verified in the deploying account.
