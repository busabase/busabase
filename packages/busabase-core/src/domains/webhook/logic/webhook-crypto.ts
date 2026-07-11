import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { EncryptedWebhookSecretPayload } from "../schema/webhook-rules";

const ALGORITHM = "aes-256-gcm";

// Same key-resolution approach as `../../vault/logic/vault-crypto.ts` (one key
// config covers both Vault secrets and webhook secrets). Copied rather than
// imported: Vault's `encodeVaultValue`/`decodeVaultValue` are typed around
// `VaultValuePayload` (which allows a "plain" fallback when no key is
// configured) — webhook secrets must NEVER be stored plaintext, so this
// version always requires the key and has no plain-encoding escape hatch.
function readEncryptionKey(): Buffer | null {
  const raw =
    process.env.BUSABASE_VAULT_ENCRYPTION_KEY ??
    process.env.BUSABASE_ENV_ENCRYPTION_KEY ??
    process.env.BETTER_AUTH_SECRET;
  if (!raw) return null;

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  if (/^[A-Za-z0-9+/=]{44}$/.test(raw)) {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  }

  return createHash("sha256").update(raw).digest();
}

export function encryptWebhookSecret(value: string): EncryptedWebhookSecretPayload {
  const key = readEncryptionKey();
  if (!key) {
    throw new Error(
      "Set BUSABASE_VAULT_ENCRYPTION_KEY (or BUSABASE_ENV_ENCRYPTION_KEY / BETTER_AUTH_SECRET) before saving webhook secrets.",
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return {
    version: 1,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptWebhookSecret(payload: EncryptedWebhookSecretPayload): string {
  if (payload.algorithm !== ALGORITHM) {
    throw new Error("Unsupported webhook secret encryption payload");
  }
  const key = readEncryptionKey();
  if (!key) {
    throw new Error(
      "Set BUSABASE_VAULT_ENCRYPTION_KEY (or BUSABASE_ENV_ENCRYPTION_KEY / BETTER_AUTH_SECRET) before reading webhook secrets.",
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
