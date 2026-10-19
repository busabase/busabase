"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Button } from "kui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "kui/dialog";
import { Check, CircleAlert, Copy, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCoreLocale } from "../../../i18n";
import { routerEnrollmentText } from "../../../i18n/router-enrollment-copy";
import { DialogContent } from "../../dashboard/components/localized-dialog-content";

interface Props {
  orpc: BusabaseQueryUtils;
  spaceId?: string;
  onConnected: (slug: string) => void;
}

interface PairingResume {
  grantId: string;
  agentSlug: "claude-acp" | "codex-acp";
  enrollmentId: string;
  expiresAt: string;
}

function readPairingResume(key: string): PairingResume | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
    return value &&
      typeof value.grantId === "string" &&
      typeof value.enrollmentId === "string" &&
      typeof value.expiresAt === "string" &&
      (value.agentSlug === "claude-acp" || value.agentSlug === "codex-acp")
      ? value
      : null;
  } catch {
    return null;
  }
}

/** Authorization and device readiness are intentionally separate milestones. */
export function RouterEnrollmentDialog({ orpc, spaceId, onConnected }: Props) {
  const locale = useCoreLocale();
  const t = useCallback((en: string, _cn: string) => routerEnrollmentText(locale, en), [locale]);
  const queryClient = useQueryClient();
  const resumeKey = `busabase-router-pairing:${spaceId ?? ""}`;
  const [resume] = useState(() => readPairingResume(resumeKey));
  const [open, setOpen] = useState(false);
  const [grantId, setGrantId] = useState(resume?.grantId ?? "");
  const [agentSlug, setAgentSlug] = useState<"claude-acp" | "codex-acp">(
    resume?.agentSlug ?? "claude-acp",
  );
  const [pairing, setPairing] = useState<{
    enrollmentId: string;
    command: string;
    expiresAt: string;
  } | null>(
    resume ? { enrollmentId: resume.enrollmentId, expiresAt: resume.expiresAt, command: "" } : null,
  );
  const [readySlug, setReadySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const popup = useRef<Window | null>(null);
  const api = orpc.agents.routerEnrollment;
  const grants = useQuery({ ...api.grants.queryOptions(), enabled: open });
  const mint = useMutation(api.mint.mutationOptions());
  const cancel = useMutation(api.cancel.mutationOptions());
  const complete = useMutation(api.complete.mutationOptions());
  const session = useMutation(orpc.agents.sessions.create.mutationOptions());
  const status = useQuery({
    ...api.status.queryOptions({ input: { grantId, enrollmentId: pairing?.enrollmentId ?? "" } }),
    enabled: open && !!pairing && !readySlug,
    refetchInterval: (query) => (query.state.data?.state === "failed" ? false : 2000),
    retry: false,
  });
  const busy = mint.isPending || cancel.isPending || complete.isPending || session.isPending;
  useEffect(() => {
    try {
      // Persist only nonsecret recovery metadata, never the command/token.
      if (pairing)
        window.sessionStorage.setItem(
          resumeKey,
          JSON.stringify({
            grantId,
            agentSlug,
            enrollmentId: pairing.enrollmentId,
            expiresAt: pairing.expiresAt,
          }),
        );
      else window.sessionStorage.removeItem(resumeKey);
    } catch {
      /* Pairing still works when storage is unavailable. */
    }
  }, [resumeKey, pairing, grantId, agentSlug]);
  const remaining = pairing
    ? Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - now) / 1000))
    : 0;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup.current) return;
      if (
        event.data?.type === "busabase:router-authorized" &&
        typeof event.data.grantId === "string"
      ) {
        setGrantId(event.data.grantId);
        setError(null);
        void grants.refetch();
      } else if (event.data?.type === "busabase:router-error") {
        setError(
          t("Router authorization was not completed. Try again.", "Router 授权未完成，请重试。"),
        );
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [grants.refetch, t]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch {
      setError(
        t(
          "This step could not finish. Check your access and connection, then retry. Your pairing is retained.",
          "此步骤未完成。请检查权限和网络后重试，配对进度已保留。",
        ),
      );
    }
  };
  const authorize = () => {
    setError(null);
    popup.current = window.open(
      `/api/agents/acprouter/oauth/start${spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ""}`,
      "busabase-router-oauth",
      "popup,width=560,height=760",
    );
    if (!popup.current)
      setError(t("Allow pop-ups, then try authorization again.", "请允许弹出窗口后重新授权。"));
  };
  const selectedGrant = grantId || grants.data?.[0]?.grantId || "";
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="min-h-11 sm:min-h-9">
          {t("Connect via ACPRouter", "通过 ACPRouter 连接")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] gap-6 overflow-y-auto p-5 sm:max-w-xl sm:p-6">
        <DialogHeader className="space-y-2 text-left">
          <DialogTitle className="pr-6 text-xl leading-tight tracking-normal">
            {t("Connect via ACPRouter", "通过 ACPRouter 连接")}
          </DialogTitle>
          <DialogDescription className="leading-6">
            {t(
              "Authorize a Router workspace, then pair an agent running on your own machine.",
              "先授权 Router 工作空间，再配对你电脑上运行的 Agent。",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-5 text-sm leading-6">
          {grants.isPending && (
            <p className="text-muted-foreground" role="status">
              {t("Loading authorizations…", "正在加载授权…")}
            </p>
          )}
          {grants.isError && (
            <Button variant="outline" onClick={() => void grants.refetch()}>
              {t("Retry loading authorizations", "重新加载授权")}
            </Button>
          )}
          {!pairing &&
            !readySlug &&
            (selectedGrant ? (
              <>
                <div className="flex flex-col items-start gap-2 border-b border-border/40 pb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <p className="flex min-w-0 items-start gap-2 leading-5" role="status">
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span>{t("Router workspace authorized.", "Router 工作空间已授权。")}</span>
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto min-h-11 shrink-0 whitespace-normal px-2 text-xs text-muted-foreground sm:min-h-9"
                    onClick={authorize}
                  >
                    {t("Authorize Router workspace", "授权 Router 工作空间")}
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-muted-foreground">
                    {t("Router workspace", "Router 工作空间")}
                    <select
                      className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      value={selectedGrant}
                      onChange={(event) => setGrantId(event.target.value)}
                    >
                      {grants.data?.map((grant) => (
                        <option key={grant.grantId} value={grant.grantId}>
                          {grant.spaceName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-0 flex-col gap-2 text-xs font-medium text-muted-foreground">
                    {t("Agent on this machine", "此电脑上的 Agent")}
                    <select
                      className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      value={agentSlug}
                      onChange={(event) => setAgentSlug(event.target.value as typeof agentSlug)}
                    >
                      <option value="claude-acp">Claude Code</option>
                      <option value="codex-acp">Codex</option>
                    </select>
                  </label>
                </div>
                <div className="flex justify-end border-t border-border/40 pt-4">
                  <Button
                    className="h-auto min-h-11 w-full whitespace-normal sm:w-auto"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setGrantId(selectedGrant);
                        setPairing(await mint.mutateAsync({ grantId: selectedGrant, agentSlug }));
                        setCopied(false);
                      })
                    }
                  >
                    {t("Generate pairing command", "生成配对命令")}
                  </Button>
                </div>
              </>
            ) : (
              <Button className="h-auto min-h-11 whitespace-normal" onClick={authorize}>
                {t("Authorize Router workspace", "授权 Router 工作空间")}
              </Button>
            ))}
          {pairing && !readySlug && (
            <>
              <p>
                {t(
                  "Run this command in a terminal on your own machine with Node.js and your agent installed and signed in.",
                  "请在自己的电脑终端运行此命令，并确保已安装 Node.js 和 Agent 且已登录。",
                )}
              </p>
              {remaining > 0 && pairing.command ? (
                <>
                  <pre
                    data-credential="pairing-command"
                    className="min-w-0 whitespace-pre-wrap rounded-md bg-muted/60 p-4 text-xs leading-5 [font-family:var(--font-mono,ui-monospace),monospace] [overflow-wrap:anywhere]"
                  >
                    <code className="[font-family:inherit]">{pairing.command}</code>
                  </pre>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t(
                      "This command contains a secret. Running it briefly exposes the token in local shell history and process listings. Do not share it.",
                      "命令含有密钥。运行时，令牌会短暂出现在本地 Shell 历史和进程列表中，请勿分享。",
                    )}
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {t("Command expires in", "命令有效期剩余")} {Math.floor(remaining / 60)}:
                      {String(remaining % 60).padStart(2, "0")}
                    </p>
                    <Button
                      className="min-h-11"
                      onClick={() =>
                        void run(async () => {
                          await navigator.clipboard.writeText(pairing.command);
                          setCopied(true);
                        })
                      }
                    >
                      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      {copied ? t("Copied", "已复制") : t("Copy command", "复制命令")}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="rounded-md bg-muted/60 p-4 leading-6" role="status">
                  {t(
                    pairing.command
                      ? "Command expired. Generate a new command to pair again."
                      : "Pairing restored. Check its status below, or cancel to generate a new command.",
                    pairing.command
                      ? "命令已过期，请重新生成以配对。"
                      : "配对进度已恢复。请查看下方状态，或取消后重新生成命令。",
                  )}
                </p>
              )}
              <div className="space-y-4 border-t border-border/40 pt-4">
                <p className="flex items-start gap-2 leading-5" role="status">
                  {status.data?.state === "online" ? (
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  ) : status.data?.state === "failed" ? (
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <Loader2
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin"
                    />
                  )}
                  <span>
                    {status.data?.state === "online"
                      ? t(
                          "Agent online. Finish pairing to make it ready.",
                          "Agent 已上线，请完成配对。",
                        )
                      : status.data?.state === "redeemed_offline"
                        ? t("Paired. Waiting for the agent bridge…", "已配对，正在等待 Agent 连接…")
                        : status.data?.state === "failed"
                          ? t(
                              "Pairing failed. Cancel and generate a new command.",
                              "配对失败，请取消并重新生成命令。",
                            )
                          : t("Waiting for local pairing…", "正在等待本地配对…")}
                  </span>
                </p>
                {status.isError && (
                  <Button variant="outline" onClick={() => void status.refetch()}>
                    {t("Retry status check", "重试状态检查")}
                  </Button>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="ghost"
                    className="h-auto min-h-11 whitespace-normal text-muted-foreground"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await cancel.mutateAsync({ grantId, enrollmentId: pairing.enrollmentId });
                        setPairing(null);
                      })
                    }
                  >
                    {t("Cancel pairing / generate another", "取消配对 / 重新生成")}
                  </Button>
                  {status.data?.state === "online" && (
                    <Button
                      className="h-auto min-h-11 whitespace-normal"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const result = await complete.mutateAsync({
                            grantId,
                            enrollmentId: pairing.enrollmentId,
                            agentSlug,
                          });
                          setReadySlug(result.connectionSlug);
                          setPairing(null);
                          await queryClient.invalidateQueries({
                            queryKey: orpc.agents.catalog.queryKey(),
                          });
                          await queryClient.invalidateQueries({
                            queryKey: orpc.agents.connections.list.queryKey({
                              input: { scope: "mine" },
                            }),
                          });
                        })
                      }
                    >
                      {t("Finish pairing", "完成配对")}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
          {readySlug && (
            <>
              <p className="flex items-start gap-2 leading-5" role="status">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>
                  {t("Agent ready. You can start a conversation.", "Agent 已就绪，可以开始对话。")}
                </span>
              </p>
              <div className="flex flex-col gap-2 border-t border-border/40 pt-4 sm:flex-row sm:justify-end">
                <Button
                  variant="ghost"
                  className="h-auto min-h-11 whitespace-normal text-muted-foreground"
                  onClick={() => {
                    setReadySlug(null);
                    setPairing(null);
                  }}
                >
                  {t("Pair another device", "配对其他设备")}
                </Button>
                <Button
                  className="h-auto min-h-11 whitespace-normal"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await session.mutateAsync({ slug: readySlug });
                      setOpen(false);
                      onConnected(result.slug);
                    })
                  }
                >
                  {t("Start conversation", "开始对话")}
                </Button>
              </div>
            </>
          )}
          {busy && (
            <p className="text-xs text-muted-foreground" role="status">
              {t("Working…", "正在处理…")}
            </p>
          )}
          {error && (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 leading-5 text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
