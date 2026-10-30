"use client";

import type { AcpResource } from "@acp-ui/core/reduce";
import { Button } from "kui/button";
import { FileIcon, Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type AcpResourceResolver = (resource: AcpResource) => Promise<AcpResource>;
export interface AcpResourceLabels {
  open: string;
  download: string;
  resolve: string;
  retry: string;
  unavailable: string;
  preview: string;
  loading: string;
  tooLarge: string;
}
export const defaultResourceLabels: AcpResourceLabels = {
  open: "Open",
  download: "Download",
  resolve: "Open resource",
  retry: "Retry",
  unavailable: "This resource cannot be opened here.",
  preview: "Preview",
  loading: "Loading preview…",
  tooLarge: "This file is too large to preview. Download it to open it.",
};

/** A remote sandbox path must never become a browser file:// link. */
export function safeResourceUrl(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  if (
    /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;(?:base64,|charset=utf-8,)/i.test(uri) &&
    !/^data:(?:text\/html|application\/xhtml\+xml);/i.test(uri)
  )
    return uri;
  try {
    const url = new URL(uri);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function AcpResourceView({
  resource,
  resolveResource,
  labels: supplied,
}: {
  resource: AcpResource;
  resolveResource?: AcpResourceResolver;
  labels?: Partial<AcpResourceLabels>;
}) {
  const labels = { ...defaultResourceLabels, ...supplied };
  const [resolved, setResolved] = useState<AcpResource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const generation = useRef(0);
  const identity = useMemo(() => JSON.stringify(resource), [resource]);
  const resourceIdentity = useRef(identity);
  const renderedIdentity = useRef(identity);
  renderedIdentity.current = identity;
  const changed = resourceIdentity.current !== identity;
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (resourceIdentity.current === identity) return;
    resourceIdentity.current = identity;
    generation.current += 1;
    setResolved(null);
    setLoading(false);
    setError(null);
    setPreviewOpen(false);
    setPreviewText(null);
    setPreviewError(null);
  }, [identity]);
  const current = !changed && resolved ? resolved : resource;
  const visiblePreview = previewOpen && !changed;
  const visibleLoading = loading && !changed;
  const visibleError = changed ? null : error;
  const url = safeResourceUrl(current.uri);
  const preview = safeResourceUrl(current.previewUri) ?? url;
  const isImage = current.mimeType?.startsWith("image/");
  const isAudio = current.mimeType?.startsWith("audio/");
  const isVideo = current.mimeType?.startsWith("video/");
  const isPdf = current.mimeType === "application/pdf";
  const isText =
    current.mimeType?.startsWith("text/") === true || current.mimeType === "application/json";
  const canPreview = Boolean(preview && (isImage || isAudio || isVideo || isPdf || isText));
  useEffect(() => {
    if (!visiblePreview || !preview || !isText) return;
    const controller = new AbortController();
    setPreviewText(null);
    setPreviewError(null);
    void (async () => {
      const response = await fetch(preview, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(labels.unavailable);
      const reader = response.body?.getReader();
      if (!reader) throw new Error(labels.unavailable);
      const decoder = new TextDecoder();
      let size = 0;
      let text = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (value) {
            size += value.byteLength;
            if (size > 1_048_576) throw new Error(labels.tooLarge);
            text += decoder.decode(value, { stream: true });
          }
          if (done) break;
        }
        text += decoder.decode();
        if (!controller.signal.aborted) setPreviewText(text);
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    })().catch((failure) => {
      if (!controller.signal.aborted)
        setPreviewError(failure instanceof Error ? failure.message : labels.unavailable);
    });
    return () => controller.abort();
  }, [visiblePreview, preview, isText, labels.unavailable, labels.tooLarge]);
  const resolve = async () => {
    if (!resolveResource || visibleLoading) return;
    const requestGeneration = generation.current;
    const requestIdentity = identity;
    const isCurrent = () =>
      generation.current === requestGeneration && renderedIdentity.current === requestIdentity;
    setLoading(true);
    setError(null);
    try {
      const next = await resolveResource(resource);
      if (!isCurrent()) return;
      if (next.id !== resource.id) throw new Error(labels.unavailable);
      if (!safeResourceUrl(next.uri) && !safeResourceUrl(next.previewUri))
        throw new Error(labels.unavailable);
      setResolved(next);
      setPreviewOpen(true);
    } catch (failure) {
      if (isCurrent()) setError(failure instanceof Error ? failure.message : labels.unavailable);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };
  return (
    <div
      className="my-2 min-w-0 rounded-md border bg-muted/20 p-3"
      data-testid="acp-resource"
      data-resource-id={resource.id}
    >
      <div className="flex min-w-0 items-center gap-2">
        <FileIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 break-all font-medium text-sm">{current.name}</span>
        {current.status ? (
          <span className="ml-auto text-muted-foreground text-xs">{current.status}</span>
        ) : null}
      </div>
      {current.description ? (
        <p className="mt-1 break-words text-muted-foreground text-xs">{current.description}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
            {labels.open}
          </a>
        ) : null}
        {url ? (
          <a
            href={url}
            download={current.name}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {labels.download}
          </a>
        ) : null}
        {canPreview ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setPreviewOpen(!visiblePreview)}
            aria-expanded={visiblePreview}
          >
            {labels.preview}
          </Button>
        ) : null}
        {resolveResource ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void resolve()}
            disabled={visibleLoading}
          >
            {visibleLoading ? <Loader2Icon className="mr-1 size-3 animate-spin" /> : null}
            {visibleError ? labels.retry : url ? labels.resolve : labels.open}
          </Button>
        ) : null}
        {!url && !resolveResource ? (
          <span className="text-muted-foreground">{labels.unavailable}</span>
        ) : null}
        {current.size !== undefined ? (
          <span className="text-muted-foreground">{current.size.toLocaleString()} B</span>
        ) : null}
      </div>
      {visibleError ? (
        <p className="mt-2 break-words text-destructive text-xs" role="alert">
          {visibleError}
        </p>
      ) : null}
      {visiblePreview && preview && isText ? (
        <div className="mt-3" data-testid="acp-text-preview">
          {previewError ? (
            <p role="alert" className="text-destructive text-xs">
              {previewError}
            </p>
          ) : previewText === null ? (
            <p role="status" className="text-muted-foreground text-xs">
              {labels.loading}
            </p>
          ) : (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border bg-background p-2 text-xs">
              {previewText}
            </pre>
          )}
        </div>
      ) : null}
      {visiblePreview && preview && isImage ? (
        <img
          alt={current.name}
          className="mt-3 max-h-96 max-w-full rounded object-contain"
          src={preview}
        />
      ) : null}
      {visiblePreview && preview && isAudio ? (
        // biome-ignore lint/a11y/useMediaCaption: This resource has no caption track in its ACP descriptor.
        <audio aria-label={current.name} controls className="mt-3 max-w-full" src={preview} />
      ) : null}
      {visiblePreview && preview && isVideo ? (
        // biome-ignore lint/a11y/useMediaCaption: This resource has no caption track in its ACP descriptor.
        <video
          aria-label={current.name}
          controls
          className="mt-3 max-h-96 max-w-full rounded"
          src={preview}
        />
      ) : null}
      {visiblePreview && preview && isPdf ? (
        <iframe
          title={current.name}
          className="mt-3 h-96 w-full rounded border"
          sandbox=""
          src={preview}
        />
      ) : null}
    </div>
  );
}
