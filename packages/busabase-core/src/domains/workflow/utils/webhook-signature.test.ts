import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  newWorkflowSigningSecret,
  signWorkflowWebhook,
  WORKFLOW_SIGNATURE_TOLERANCE_SECONDS,
} from "./webhook-signature";

const SECRET = "whsec_test_secret_0123456789";
const OTHER = "whsec_other_secret_9876543210";

/**
 * The receiver snippet from the guide, verbatim in spirit: split the header,
 * reject an old timestamp, recompute, compare in constant time. Tests run the
 * documented check rather than the signer checking itself.
 */
const verify = (secret: string, header: string, body: string, nowSeconds: number): boolean => {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || typeof parts.v1 !== "string") return false;
  if (Math.abs(nowSeconds - t) > WORKFLOW_SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const given = Buffer.from(parts.v1, "hex");
  const wanted = Buffer.from(expected, "hex");
  return given.length === wanted.length && timingSafeEqual(given, wanted);
};

describe("workflow webhook signature", () => {
  it("matches an HMAC computed independently, with the timestamp inside the signed text", async () => {
    // Expected values from Python's hmac, not from this module.
    expect(await signWorkflowWebhook(SECRET, '{"a":1}', 1_700_000_000_123)).toBe(
      "t=1700000000,v1=10fb0e5eb2c2204d471e7d252958fb5af663638b8d24fc8dc03090a74bcc366c",
    );
    expect(await signWorkflowWebhook(OTHER, '{"a":1}', 1_700_000_000_000)).toBe(
      "t=1700000000,v1=ef133aab53b4269d01e333af7139c46dc26d386b56c6c896b9995a410798ffd5",
    );
  });

  it("signs an empty body, as a GET sends", async () => {
    expect(await signWorkflowWebhook(SECRET, "", 1_700_000_000_000)).toBe(
      "t=1700000000,v1=8f40661c06ee078c83c534185b6a503938fdf41ab4f0a17e2ac9c109da2e2c92",
    );
  });

  it("verifies with the receiver check, and rotating the secret changes it", async () => {
    const now = 1_700_000_100;
    const body = JSON.stringify({ event: "workflow.step", runId: "wfr_1" });
    const header = await signWorkflowWebhook(SECRET, body, now * 1000);
    expect(verify(SECRET, header, body, now)).toBe(true);
    // The old secret does not verify a request signed with the new one.
    const rotated = await signWorkflowWebhook(OTHER, body, now * 1000);
    expect(rotated).not.toBe(header);
    expect(verify(SECRET, rotated, body, now)).toBe(false);
    expect(verify(OTHER, rotated, body, now)).toBe(true);
  });

  it("is not satisfied by a changed body, a moved timestamp, or a malformed header", async () => {
    const now = 1_700_000_100;
    const header = await signWorkflowWebhook(SECRET, '{"amount":10}', now * 1000);
    expect(verify(SECRET, header, '{"amount":99}', now)).toBe(false);
    const moved = header.replace(/^t=\d+/, `t=${now + 1}`);
    expect(verify(SECRET, moved, '{"amount":10}', now)).toBe(false);
    expect(verify(SECRET, "garbage", '{"amount":10}', now)).toBe(false);
    expect(verify(SECRET, "t=abc,v1=00", '{"amount":10}', now)).toBe(false);
  });

  it("shows a replay by its age", async () => {
    const sentAt = 1_700_000_000;
    const header = await signWorkflowWebhook(SECRET, "{}", sentAt * 1000);
    expect(verify(SECRET, header, "{}", sentAt + 60)).toBe(true);
    expect(verify(SECRET, header, "{}", sentAt + WORKFLOW_SIGNATURE_TOLERANCE_SECONDS)).toBe(true);
    // The same bytes, six minutes later: valid HMAC, rejected for its age.
    expect(verify(SECRET, header, "{}", sentAt + 360)).toBe(false);
  });

  it("makes secrets that are long enough, distinct, and prefixed", () => {
    const secrets = new Set(Array.from({ length: 50 }, newWorkflowSigningSecret));
    expect(secrets.size).toBe(50);
    for (const secret of secrets) {
      expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
    }
  });
});
