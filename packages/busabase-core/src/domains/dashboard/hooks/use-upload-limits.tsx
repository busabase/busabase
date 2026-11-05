"use client";

import {
  ATTACHMENT_MAX_FILE_SIZE,
  createFileTooLargeClientError,
  type FileTooLargeErrorData,
  getFileTooLargeErrorData,
  resolveEffectiveMaxFileSize,
} from "open-domains/attachments/utils";
import { createContext, type ReactNode, useContext, useMemo } from "react";

/**
 * Host-injected upload limits. Generic on purpose: the dashboard knows a
 * per-file byte limit and an optional "this file was too large" callback, never
 * WHY the limit is what it is. Busabase Cloud derives both from the space's
 * plan (and opens its upgrade prompt from the callback); self-hosted Busabase
 * injects nothing and gets the 5 GB ceiling with no upgrade action.
 *
 * The limit is UX only — it lets the browser refuse a file before hashing or
 * uploading a byte. The server's upload policy stays authoritative and returns
 * the same structured error, which flows through the same callback.
 */
export interface UploadLimits {
  /** Largest file (bytes) the host accepts. Never above the 5 GB ceiling. */
  maxFileSize: number;
  /** Called whenever an upload is refused for size (pre-check or server). */
  onFileTooLarge?: (info: FileTooLargeErrorData) => void;
}

const DEFAULT_UPLOAD_LIMITS: UploadLimits = { maxFileSize: ATTACHMENT_MAX_FILE_SIZE };

const UploadLimitsContext = createContext<UploadLimits>(DEFAULT_UPLOAD_LIMITS);

export function UploadLimitsProvider({
  children,
  maxFileSize,
  onFileTooLarge,
}: {
  children: ReactNode;
  maxFileSize?: number;
  onFileTooLarge?: (info: FileTooLargeErrorData) => void;
}) {
  const value = useMemo(
    () => ({ maxFileSize: resolveEffectiveMaxFileSize(maxFileSize), onFileTooLarge }),
    [maxFileSize, onFileTooLarge],
  );
  return <UploadLimitsContext.Provider value={value}>{children}</UploadLimitsContext.Provider>;
}

export function useUploadLimits(): UploadLimits {
  return useContext(UploadLimitsContext);
}

/**
 * Throw the structured "file too large" error when `file` exceeds `limit`.
 * Called before hashing/uploading so an oversized file costs nothing.
 */
export function assertFileWithinLimit(file: { name: string; size: number }, limit: number): void {
  if (file.size > limit) {
    throw createFileTooLargeClientError({ limit, sizeBytes: file.size, fileName: file.name });
  }
}

/**
 * Run an upload, routing any size refusal (client pre-check or server policy)
 * to the host's `onFileTooLarge` before rethrowing — the caller still shows
 * its own inline/toast error.
 */
export async function withFileTooLargeReporting<T>(
  limits: UploadLimits,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const tooLarge = getFileTooLargeErrorData(error);
    if (tooLarge) limits.onFileTooLarge?.(tooLarge);
    throw error;
  }
}
