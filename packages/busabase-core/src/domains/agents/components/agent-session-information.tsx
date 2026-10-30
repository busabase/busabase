"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Button } from "kui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "kui/dialog";
import { Info, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useCoreLocale } from "../../../i18n";

/** Read existing observations only. Opening this view never starts a browser or shell. */
export function AgentSessionInformation({
  orpc,
  sessionId,
}: {
  orpc: BusabaseQueryUtils;
  sessionId: string;
}) {
  const locale = useCoreLocale();
  const chinese = locale === "zh-CN" || locale === "zh-TW";
  const [open, setOpen] = useState(false);
  const title = chinese ? "会话信息" : "Session information";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          title={title}
          aria-label={title}
          data-testid="agent-session-information-trigger"
        >
          <Info className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[85dvh] max-w-xl overflow-y-auto"
        data-testid="agent-session-information"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {open ? <SessionSnapshotBody orpc={orpc} sessionId={sessionId} chinese={chinese} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SessionSnapshotBody({
  orpc,
  sessionId,
  chinese,
}: {
  orpc: BusabaseQueryUtils;
  sessionId: string;
  chinese: boolean;
}) {
  const snapshot = useQuery(
    orpc.agents.sessions.snapshot.queryOptions({
      input: { sessionId },
      staleTime: 5_000,
      retry: false,
    }),
  );
  return (
    <>
      {snapshot.isPending ? (
        <Loader2 className="size-5 animate-spin" aria-label={chinese ? "正在读取" : "Loading"} />
      ) : null}
      {snapshot.error ? (
        <p role="alert" className="break-words text-muted-foreground text-sm">
          {snapshot.error.message}
        </p>
      ) : null}
      {snapshot.data ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all text-sm">
            {snapshot.data.provenance?.authorName ? (
              <>
                <dt>{chinese ? "创建者" : "Author"}</dt>
                <dd>{snapshot.data.provenance.authorName}</dd>
              </>
            ) : null}
            {snapshot.data.provenance?.source ? (
              <>
                <dt>{chinese ? "来源" : "Source"}</dt>
                <dd>{snapshot.data.provenance.source}</dd>
              </>
            ) : null}
            {snapshot.data.context?.promptMode ? (
              <>
                <dt>{chinese ? "交互模式" : "Mode"}</dt>
                <dd>{snapshot.data.context.promptMode}</dd>
              </>
            ) : null}
            {snapshot.data.context?.channelLabel ? (
              <>
                <dt>{chinese ? "渠道" : "Channel"}</dt>
                <dd>{snapshot.data.context.channelLabel}</dd>
              </>
            ) : null}
            <dt>{chinese ? "执行器" : "Runner"}</dt>
            <dd>{snapshot.data.runtime.runner}</dd>
            <dt>{chinese ? "模型" : "Model"}</dt>
            <dd>{snapshot.data.runtime.model}</dd>
            <dt>{chinese ? "工作目录" : "Workspace"}</dt>
            <dd>{snapshot.data.runtime.workdir}</dd>
          </dl>
          {snapshot.data.views.map((view) => {
            const metadata = view.resource?._meta?.["buda.im"] as
              | { snapshotText?: unknown; observedAt?: unknown }
              | undefined;
            const image = view.resource?.previewUri;
            const safeImage =
              image &&
              (/^data:image\/(?:png|jpeg|webp);base64,/i.test(image) || /^https:\/\//i.test(image));
            return (
              <section
                key={view.kind}
                className="min-w-0 rounded-md border p-3"
                data-testid={`agent-${view.kind}-snapshot`}
              >
                <h3 className="mb-2 font-medium text-sm">
                  {view.kind === "browser"
                    ? chinese
                      ? "浏览器快照"
                      : "Browser snapshot"
                    : chinese
                      ? "终端快照"
                      : "Terminal snapshot"}
                </h3>
                {view.status === "unavailable" ? (
                  <p className="text-muted-foreground text-sm">
                    {view.message ??
                      (chinese ? "尚无可用快照。" : "No observed snapshot is available.")}
                  </p>
                ) : null}
                {view.status === "available" && safeImage ? (
                  <img
                    src={image}
                    alt={view.resource?.name ?? "Browser snapshot"}
                    className="max-h-72 max-w-full rounded border object-contain"
                  />
                ) : null}
                {view.status === "available" && typeof metadata?.snapshotText === "string" ? (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">
                    {metadata.snapshotText}
                  </pre>
                ) : null}
                {typeof metadata?.observedAt === "string" ? (
                  <p className="mt-2 text-muted-foreground text-xs">{metadata.observedAt}</p>
                ) : null}
              </section>
            );
          })}
        </>
      ) : null}
      <Button
        type="button"
        variant="outline"
        onClick={() => void snapshot.refetch()}
        disabled={snapshot.isFetching}
      >
        <RefreshCw className="mr-2 size-4" />
        {chinese ? "刷新快照" : "Refresh snapshot"}
      </Button>
    </>
  );
}
