import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type {
  EncryptedEnvVarsPayload,
  PlainEnvVarsPayload,
  UserEnvVarsPayload,
} from "../schema/user-env-vars";
import type { EnvVars } from "../types/user-env";

const ALGORITHM = "aes-256-gcm";

function readEncryptionKey(): Buffer | null {
  const raw = process.env.BUSABASE_ENV_ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET;
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

function encryptEnvVars(env: EnvVars, key: Buffer): EncryptedEnvVarsPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(env), "utf8"), cipher.final()]);

  return {
    version: 1,
    encoding: "encrypted",
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptEnvVars(payload: EncryptedEnvVarsPayload, key: Buffer): EnvVars {
  if (payload.algorithm !== ALGORITHM) {
    throw new Error("Unsupported environment variable encryption payload");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");

  const parsed = JSON.parse(plaintext) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid environment variable payload");
  }

  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function encodeUserEnvPayload(
  env: EnvVars,
  options: { requireEncryption?: boolean } = {},
): UserEnvVarsPayload {
  const key = readEncryptionKey();
  if (key) return encryptEnvVars(env, key);
  if (options.requireEncryption) {
    throw new Error("Set BUSABASE_ENV_ENCRYPTION_KEY before saving user environment variables.");
  }

  return { version: 1, encoding: "plain", env } satisfies PlainEnvVarsPayload;
}

export function decodeUserEnvPayload(payload: UserEnvVarsPayload): EnvVars {
  if (payload.version !== 1) {
    throw new Error("Unsupported environment variable payload");
  }

  if (payload.encoding === "plain") {
    return payload.env;
  }

  const key = readEncryptionKey();
  if (!key) {
    throw new Error("Set BUSABASE_ENV_ENCRYPTION_KEY before reading user environment variables.");
  }

  return decryptEnvVars(payload, key);
}
