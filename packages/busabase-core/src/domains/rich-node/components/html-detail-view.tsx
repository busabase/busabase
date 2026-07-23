"use client";

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { parseHtmlDocument } from "busabase-contract/domains/rich-node/types";
import type { NodeVO } from "busabase-contract/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { CodeXml, Eye, FileCode2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { useReportLoadedNode } from "../../dashboard/hooks/use-report-loaded-node";
import type { NodeDetailProps } from "../../dashboard/node-detail-registry";
import { findNode, RichNodeNotFound, RichNodeShell, useNodeMetadataSave } from "./rich-node-shell";

interface HtmlDetailViewProps {
  nodes?: NodeVO[];
  orpc: BusabaseQueryUtils;
  slug: string | null;
  onNodeLoaded?: NodeDetailProps["onNodeLoaded"];
}

export function HtmlDetailView({ nodes, orpc, slug, onNodeLoaded }: HtmlDetailViewProps) {
  const messages = useCoreI18n();
  const node = useMemo(() => findNode(nodes ?? [], "html", slug), [nodes, slug]);
  useReportLoadedNode(node, onNodeLoaded);
  const initialDocument = useMemo(
    () => parseHtmlDocument(node?.metadata.htmlDocument),
    [node?.metadata.htmlDocument],
  );
  const [source, setSource] = useState(initialDocument.source);
  const { error, markDirty, save, status } = useNodeMetadataSave(orpc, node, "htmlDocument");

  if (!node) return <RichNodeNotFound type="HTML" />;

  return (
    <RichNodeShell
      error={error}
      icon={CodeXml}
      node={node}
      nodeType="html"
      onSave={() => save({ version: 1, source })}
      orpc={orpc}
      status={status}
    >
      <Tabs className="flex h-full min-h-0 flex-col" defaultValue="source">
        <div className="flex h-10 shrink-0 items-center border-border/60 border-b px-3">
          <TabsList className="h-8">
            <TabsTrigger className="gap-1.5 px-2.5 text-xs" value="source">
              <FileCode2 className="size-3.5" />
              {messages.richNodes.source}
            </TabsTrigger>
            <TabsTrigger className="gap-1.5 px-2.5 text-xs" value="preview">
              <Eye className="size-3.5" />
              {messages.richNodes.preview}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent className="m-0 min-h-0 flex-1" value="source">
          <textarea
            aria-label={messages.richNodes.htmlSource}
            className="h-full w-full resize-none border-0 bg-background p-4 font-mono text-foreground text-sm leading-6 outline-none"
            onChange={(event) => {
              setSource(event.target.value);
              markDirty();
            }}
            spellCheck={false}
            value={source}
          />
        </TabsContent>
        <TabsContent className="m-0 min-h-0 flex-1 bg-muted/20 p-3" value="preview">
          <iframe
            className="h-full w-full border border-border bg-background"
            sandbox="allow-forms allow-modals allow-scripts"
            srcDoc={source}
            title={`${node.name} preview`}
          />
        </TabsContent>
      </Tabs>
    </RichNodeShell>
  );
}
