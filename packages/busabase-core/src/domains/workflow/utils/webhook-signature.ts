/**
 * The signature on a workflow Webhook step's request, in the shape Stripe's
 * webhooks use, so a receiver can reuse a verification snippet it already has:
 *
 *     X-Busabase-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + body)>
 *
 * `body` is the exact text of the request body ("" when there is none, as for
 * GET). The timestamp is inside the signed text, so a replay cannot move it
 * forward; a receiver that rejects a `t` more than a few minutes old rejects
 * replays.
 *
 * Isomorphic and dependency-free (Web Crypto only): the server signs with it,
 * and the editor generates the secret with it.
 */

export const WORKFLOW_SIGNATURE_HEADER = "x-busabase-signature";

/** How old a signature may be before the documented receiver snippet rejects it. */
export const WORKFLOW_SIGNATURE_TOLERANCE_SECONDS = 300;

const SECRET_PREFIX = "whsec_";

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** A new random signing secret: `whsec_` and 32 URL-safe characters. */
export const newWorkflowSigningSecret = (): string => {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${SECRET_PREFIX}${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
};

/** `t=<seconds>,v1=<hex>` for this secret, body, and moment. */
export const signWorkflowWebhook = async (
  secret: string,
  body: string,
  nowMs: number,
): Promise<string> => {
  const timestamp = Math.floor(nowMs / 1000);
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return `t=${timestamp},v1=${toHex(mac)}`;
};
