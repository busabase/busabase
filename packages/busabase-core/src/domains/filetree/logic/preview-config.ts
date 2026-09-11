import "server-only";

import type { FilePreviewRuntimeConfig } from "../../../context";
import { isVaultEncryptionConfigured } from "../../vault/logic/vault-crypto";

export const PREVIEWFILE_DEFAULT_BASE_URL = "https://previewfile.dev";
export const PREVIEWFILE_DEFAULT_MAX_FILE_SIZE_MB = 50;
export const PREVIEWFILE_MAX_FILE_SIZE_MB = 500;
export const PREVIEWFILE_SESSION_TTL_MINUTES = 60;

type PreviewCredentialSource = "environment" | "vault";

interface ResolveFilePreviewConfigOptions {
  apiKey?: string;
  credentialSource: PreviewCredentialSource;
  env?: NodeJS.ProcessEnv;
}

const warnedConfigurationErrors = new Set<string>();

const warnInvalidConfigurationOnce = (error: string) => {
  if (warnedConfigurationErrors.has(error)) return;
  warnedConfigurationErrors.add(error);
  console.warn(`[File Preview] PreviewFile configuration is invalid: ${error}`);
};

const parseMaxFileSize = (raw: string | undefined): { bytes: number; error?: string } => {
  const megabytes = raw === undefined ? PREVIEWFILE_DEFAULT_MAX_FILE_SIZE_MB : Number(raw);
  if (!Number.isInteger(megabytes) || megabytes < 1 || megabytes > PREVIEWFILE_MAX_FILE_SIZE_MB) {
    return {
      bytes: PREVIEWFILE_DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024,
      error: `PREVIEWFILE_MAX_FILE_SIZE_MB must be an integer between 1 and ${PREVIEWFILE_MAX_FILE_SIZE_MB}`,
    };
  }
  return { bytes: megabytes * 1024 * 1024 };
};

const parseBaseUrl = (
  raw: string | undefined,
  nodeEnv: string | undefined,
): { baseUrl: string; error?: string } => {
  const candidate = raw?.trim() || PREVIEWFILE_DEFAULT_BASE_URL;
  try {
    const url = new URL(candidate);
    const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash) {
      return { baseUrl: PREVIEWFILE_DEFAULT_BASE_URL, error: "PREVIEWFILE_BASE_URL is malformed" };
    }
    if (
      url.protocol !== "https:" &&
      !(nodeEnv !== "production" && url.protocol === "http:" && isLocalhost)
    ) {
      return {
        baseUrl: PREVIEWFILE_DEFAULT_BASE_URL,
        error: "PREVIEWFILE_BASE_URL must use HTTPS (except localhost in development)",
      };
    }
    return { baseUrl: url.toString().replace(/\/$/, "") };
  } catch {
    return { baseUrl: PREVIEWFILE_DEFAULT_BASE_URL, error: "PREVIEWFILE_BASE_URL is malformed" };
  }
};

/** Resolve host-owned preview settings without ever exposing the credential to a client contract. */
export const resolveFilePreviewRuntimeConfig = ({
  apiKey,
  credentialSource,
  env = process.env,
}: ResolveFilePreviewConfigOptions): FilePreviewRuntimeConfig => {
  const rawProvider = env.BUSABASE_FILE_PREVIEW_PROVIDER?.trim().toLowerCase() || "builtin";
  const provider = rawProvider === "previewfile" ? "previewfile" : "builtin";
  const maxFileSize = parseMaxFileSize(env.PREVIEWFILE_MAX_FILE_SIZE_MB);
  const baseUrl = parseBaseUrl(env.PREVIEWFILE_BASE_URL, env.NODE_ENV);
  const providerError =
    rawProvider === "builtin" || rawProvider === "previewfile"
      ? undefined
      : 'BUSABASE_FILE_PREVIEW_PROVIDER must be "builtin" or "previewfile"';
  const previewFileConfigurationError =
    rawProvider === "previewfile" ? (maxFileSize.error ?? baseUrl.error) : undefined;
  const configurationError = providerError ?? previewFileConfigurationError;
  if (configurationError) warnInvalidConfigurationOnce(configurationError);

  const normalizedApiKey = apiKey?.trim() || undefined;
  return {
    provider,
    apiKey: normalizedApiKey,
    baseUrl: baseUrl.baseUrl,
    maxFileSizeBytes: maxFileSize.bytes,
    sessionTtlMinutes: PREVIEWFILE_SESSION_TTL_MINUTES,
    credentialSource: normalizedApiKey ? credentialSource : "none",
    vaultEncryptionConfigured: credentialSource === "vault" ? isVaultEncryptionConfigured() : null,
    configurationError,
  };
};

export const resolveCloudFilePreviewRuntimeConfig = (
  env: NodeJS.ProcessEnv = process.env,
): FilePreviewRuntimeConfig =>
  resolveFilePreviewRuntimeConfig({
    apiKey: env.PREVIEWFILE_API_KEY,
    credentialSource: "environment",
    env,
  });

export const resolveOssFilePreviewRuntimeConfig = (
  vaultRuntimeEnv: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): FilePreviewRuntimeConfig =>
  resolveFilePreviewRuntimeConfig({
    apiKey: vaultRuntimeEnv.PREVIEWFILE_API_KEY,
    credentialSource: "vault",
    env,
  });
