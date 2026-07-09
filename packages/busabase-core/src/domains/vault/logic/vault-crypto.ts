import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type {
  EncryptedVaultValuePayload,
  PlainVaultValuePayload,
  VaultValuePayload,
} from "../schema/vault-items";

const ALGORITHM = "aes-256-gcm";

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

function encryptVaultValue(value: string, key: Buffer): EncryptedVaultValuePayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return {
    version: 1,
    encoding: "encrypted",
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptVaultValue(payload: EncryptedVaultValuePayload, key: Buffer): string {
  if (payload.algorithm !== ALGORITHM) {
    throw new Error("Unsupported vault value encryption payload");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function encodeVaultValue(
  value: string,
  options: { requireEncryption?: boolean } = {},
): VaultValuePayload {
  const key = readEncryptionKey();
  if (key) return encryptVaultValue(value, key);
  if (options.requireEncryption) {
    throw new Error("Set BUSABASE_VAULT_ENCRYPTION_KEY before saving vault secrets.");
  }

  return { version: 1, encoding: "plain", value } satisfies PlainVaultValuePayload;
}

export function decodeVaultValue(payload: VaultValuePayload): string {
  if (payload.version !== 1) {
    throw new Error("Unsupported vault value payload");
  }

  if (payload.encoding === "plain") {
    return payload.value;
  }

  const key = readEncryptionKey();
  if (!key) {
    throw new Error("Set BUSABASE_VAULT_ENCRYPTION_KEY before reading vault secrets.");
  }

  return decryptVaultValue(payload, key);
}
