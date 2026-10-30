"use client";

import type { AcpResource, ContentBlock, ToolCallContent } from "@acp-ui/core/reduce";
import { Response } from "kui/ai-elements/response";
import { type ComponentType, useMemo } from "react";
import { type AcpResourceLabels, type AcpResourceResolver, AcpResourceView } from "./resource-view";

export function resourceFromContent(content: ContentBlock): AcpResource | undefined {
  if (content.type === "resource_link")
    return {
      id: content.uri,
      uri: content.uri,
      name: content.title ?? content.name,
      ...(content.mimeType ? { mimeType: content.mimeType } : {}),
      ...(content.description ? { description: content.description } : {}),
      ...(content.size != null ? { size: content.size } : {}),
      ...(content._meta ? { _meta: content._meta } : {}),
    };
  if (content.type === "resource") {
    const { resource } = content;
    const filename = resource.uri.split(/[?#]/)[0]?.split("/").pop() || resource.uri;
    let name = filename;
    try {
      name = decodeURIComponent(filename);
    } catch {
      /* Keep malformed URI names readable. */
    }
    const mimeType =
      resource.mimeType ?? ("text" in resource ? "text/plain" : "application/octet-stream");
    const uri =
      "text" in resource
        ? `data:${mimeType};charset=utf-8,${encodeURIComponent(resource.text)}`
        : `data:${mimeType};base64,${resource.blob}`;
    return {
      id: resource.uri,
      uri,
      name,
      mimeType,
      ...(content._meta ? { _meta: content._meta } : {}),
    };
  }
  return undefined;
}

export function AcpContentView({
  content,
  Markdown = Response,
  resolveResource,
  resourceLabels,
}: {
  content: ContentBlock;
  Markdown?: ComponentType<{ children: string }>;
  resolveResource?: AcpResourceResolver;
  resourceLabels?: Partial<AcpResourceLabels>;
}) {
  const resource = useMemo(() => resourceFromContent(content), [content]);
  if (content.type === "text") return <Markdown>{content.text}</Markdown>;
  if (content.type === "image")
    return (
      <img
        alt={typeof content._meta?.alt === "string" ? content._meta.alt : "Agent image"}
        src={`data:${content.mimeType};base64,${content.data}`}
        className="my-2 max-h-96 max-w-full rounded object-contain"
      />
    );
  if (content.type === "audio")
    return (
      // biome-ignore lint/a11y/useMediaCaption: ACP audio blocks do not carry caption tracks.
      <audio
        aria-label="Agent audio"
        src={`data:${content.mimeType};base64,${content.data}`}
        controls
        className="my-2 max-w-full"
      />
    );
  if (content.type === "resource" && "text" in content.resource) {
    return (
      <div className="my-2 min-w-0 rounded border p-3">
        <p className="mb-2 break-all font-medium text-xs">{resource?.name}</p>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
          {content.resource.text}
        </pre>
      </div>
    );
  }
  return resource ? (
    <AcpResourceView
      resource={resource}
      resolveResource={resolveResource}
      labels={resourceLabels}
    />
  ) : null;
}

export function AcpToolContentView({
  content,
  resolveResource,
  resourceLabels,
}: {
  content: ToolCallContent;
  resolveResource?: AcpResourceResolver;
  resourceLabels?: Partial<AcpResourceLabels>;
}) {
  if (content.type === "content")
    return (
      <AcpContentView
        content={content.content}
        resolveResource={resolveResource}
        resourceLabels={resourceLabels}
      />
    );
  if (content.type === "diff")
    return (
      <details className="my-2 rounded border" data-testid="acp-tool-diff">
        <summary className="cursor-pointer break-all p-2 font-mono text-xs">{content.path}</summary>
        <div className="grid min-w-0 gap-2 border-t p-2">
          {content.oldText != null ? (
            <pre
              role="region"
              aria-label="Previous content"
              className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-destructive/5 p-2 text-xs"
            >
              {content.oldText}
            </pre>
          ) : null}
          <pre
            role="region"
            aria-label="Updated content"
            className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-primary/5 p-2 text-xs"
          >
            {content.newText}
          </pre>
        </div>
      </details>
    );
  if (content.type === "terminal")
    return (
      <div
        className="my-2 rounded border p-2 font-mono text-xs"
        data-testid="acp-terminal-reference"
      >
        Terminal: {content.terminalId}
      </div>
    );
  return null;
}
