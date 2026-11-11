"use client";

import { useEffect, useState } from "react";
import {
  decodeTextChunk,
  TEXT_ATTACHMENT_MAX_BYTES,
  TextAttachmentError,
  type TextAttachmentErrorKind,
} from "./text-preview";

export const TEXT_ATTACHMENT_TIMEOUT_MS = 30_000;

export type TextState =
  | { status: "loading" }
  | { status: "ready"; content: string }
  | { status: "error"; error: TextAttachmentErrorKind };

/** Reads original bytes, independent of an inaccurate HTTP charset or asset text index. */
export const readTextAttachment = async (url: string, signal: AbortSignal): Promise<string> => {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new TextAttachmentError("failed");
  }
  const length = Number(response.headers.get("content-length"));
  if (length > TEXT_ATTACHMENT_MAX_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new TextAttachmentError("tooLarge");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let content = "";
  let complete = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > TEXT_ATTACHMENT_MAX_BYTES) throw new TextAttachmentError("tooLarge");
      content += decodeTextChunk(decoder, value);
    }
    content += decodeTextChunk(decoder);
    complete = true;
    return content;
  } finally {
    // Do not await cancellation: a broken remote stream must not hold the error state hostage.
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
};

/** A switch/unmount aborts the read; an obsolete completion can never replace the current file. */
export const useTextAttachment = (url: string, size = 0) => {
  const [attempt, setAttempt] = useState(0);
  const identity = JSON.stringify([url, size, attempt]);
  const [result, setResult] = useState<{ identity: string; state: TextState }>({
    identity,
    state: { status: "loading" },
  });

  useEffect(() => {
    let active = true;
    let timedOut = false;
    const controller = new AbortController();
    const update = (state: TextState) => {
      if (active) setResult({ identity, state });
    };
    if (size > TEXT_ATTACHMENT_MAX_BYTES) {
      update({ status: "error", error: "tooLarge" });
      return () => {
        active = false;
      };
    }
    update({ status: "loading" });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      update({ status: "error", error: "timedOut" });
    }, TEXT_ATTACHMENT_TIMEOUT_MS);

    const load = async () => {
      try {
        const content = await readTextAttachment(url, controller.signal);
        if (!controller.signal.aborted) update({ status: "ready", content });
      } catch (error) {
        if (!controller.signal.aborted) {
          update({
            status: "error",
            error: error instanceof TextAttachmentError ? error.kind : "failed",
          });
        } else if (timedOut) {
          update({ status: "error", error: "timedOut" });
        }
      } finally {
        clearTimeout(timer);
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [identity, size, url]);

  return {
    state: result.identity === identity ? result.state : { status: "loading" as const },
    retry: () => setAttempt((current) => current + 1),
  };
};
