/**
 * The demo's scripted agent.
 *
 * Why a fake agent at all: demo mode cannot spawn a process or hold a socket,
 * so `router-demo.ts` used to answer "connecting to agents is disabled" for
 * everything. That turned Ask Agent — a first-class button on every node
 * toolbar — into a permanently greyed control on the most public surface the
 * product has, shown to people who have not signed up. A demo that greys out
 * its own headline interaction demos nothing.
 *
 * What this is NOT: a second chat implementation. It emits the same
 * `AgentSessionEventVO` shapes the real `agent-session-manager.ts` emits
 * (`acpUpdate` carrying ACP `session/update` payloads, plus
 * `permissionRequest` / `permissionResolved`), so the demo renders through the
 * real `@acp-ui/web` panel. If the real streaming UI breaks, the demo breaks
 * with it — which is the point.
 *
 * Honesty rules baked into the script:
 *  - the agent is named as a demo agent; it never impersonates Claude Code or
 *    Codex, and the other catalog rows keep their real `unavailableReason`;
 *  - it proposes a ChangeRequest and stops. It never says it wrote, merged or
 *    saved anything, because nothing here persists;
 *  - it asks permission before proposing, because asking first is the product.
 */

import type {
  AgentCatalogEntryVO,
  AgentSessionEventVO,
  AgentSessionStatus,
  AgentSessionVO,
} from "busabase-contract/domains/agents/types";
import { type DemoLocale, getContextDemoLocale } from "../../../context";

export const DEMO_AGENT_SLUG = "busabase-demo-agent";

interface DemoCopy {
  name: string;
  description: string;
  thought: string[];
  opening: string[];
  toolTitle: string;
  permissionTitle: string;
  allow: string;
  reject: string;
  approved: string[];
  declined: string[];
}

const COPY: Record<DemoLocale, DemoCopy> = {
  en: {
    name: "Demo Agent (scripted)",
    description:
      "A canned, read-only agent that runs only in this demo. It replays a fixed conversation — no model, no machine, nothing saved.",
    thought: ["Reading the node you pointed me at", " and checking what I'm allowed to change…"],
    opening: [
      "I've read this node. ",
      "Here's what I'd change:\n\n",
      "1. tighten the summary so it says what this is for\n",
      "2. fill in the two fields that are still empty\n",
      "3. link it to the record it belongs under\n\n",
      "Busabase is approval-first, so I can't just write this — I'd submit it as a ChangeRequest for you to review.",
    ],
    toolTitle: "Read this node",
    permissionTitle: "Submit a ChangeRequest with these three edits?",
    allow: "Submit it for review",
    reject: "Not now",
    approved: [
      "Submitted. ",
      "It's a proposal waiting in your Inbox — nothing has been written to the workspace yet. ",
      "Open the ChangeRequest to see the exact diff, then approve or reject it.\n\n",
      "(This is a demo: the proposal is scripted, and nothing here persists.)",
    ],
    declined: [
      "Understood — I haven't proposed anything. ",
      "The node is unchanged. Ask me again whenever you want the edits written up.",
    ],
  },
  "zh-CN": {
    name: "演示 Agent（脚本）",
    description:
      "只在本演示里运行的脚本 Agent。它只会重放一段固定对话——没有模型、没有真实机器，也不会保存任何东西。",
    thought: ["正在读取你指定的节点", "，并确认我被允许改动哪些内容…"],
    opening: [
      "我已经读完这个节点了。",
      "我想做这几处修改：\n\n",
      "1. 收紧摘要，让人一眼看出它是干什么的\n",
      "2. 补上还空着的两个字段\n",
      "3. 把它关联到所属的那条记录\n\n",
      "Busabase 是先审后改的，所以我不能直接写入——我会提交一个变更请求给你审。",
    ],
    toolTitle: "读取该节点",
    permissionTitle: "要把这三处修改提交为变更请求吗？",
    allow: "提交给我审",
    reject: "先不用",
    approved: [
      "已提交。",
      "它是一条待审的提案，正在你的收件箱里——工作区里还没有写入任何内容。",
      "打开这条变更请求就能看到具体差异，然后再决定通过还是拒绝。\n\n",
      "（这是演示：提案内容是写死的，什么都不会留下。）",
    ],
    declined: ["明白，我没有提交任何提案。", "节点保持原样。想让我把修改写成提案时随时再叫我。"],
  },
};

const copyFor = (locale: DemoLocale): DemoCopy => COPY[locale] ?? COPY.en;

/**
 * The demo catalog row. Appended to the existing (all-unavailable) rows rather
 * than replacing them, so the demo still tells the truth about what a real
 * install adds.
 */
export const demoAgentCatalogEntry = (locale: DemoLocale): AgentCatalogEntryVO => {
  const copy = copyFor(locale);
  return {
    slug: DEMO_AGENT_SLUG,
    name: copy.name,
    description: copy.description,
    transport: "local-subprocess",
    version: null,
    available: true,
    comingSoon: false,
    unavailableReason: null,
    connectionRequired: false,
    connectedAgentName: null,
    connectedAgents: [],
  };
};

interface DemoSession {
  id: string;
  locale: DemoLocale;
  agentName: string;
  status: AgentSessionStatus;
  createdAt: string;
  lastActivityAt: string;
  seq: number;
  events: AgentSessionEventVO[];
  listeners: Set<(event: AgentSessionEventVO) => void>;
  pendingPermission: { requestId: string; resolve: (optionId: string) => void } | null;
  permissionCounter: number;
  turn: number;
}

/**
 * `globalThis`-scoped for the same reason the real session map is: Next's
 * dev-mode per-route compilation can re-evaluate this module per importer, and
 * a second empty map would mean the subscribe route never sees the session the
 * create route made.
 *
 * This is process-wide state in an otherwise stateless demo router. It is
 * bounded (a scripted transcript, capped below) and holds nothing about anyone
 * — the alternative, a stateless fake, cannot stream or answer a permission
 * card, which is most of what this exists to demo.
 */
type GlobalWithDemoAgents = typeof globalThis & {
  __busabaseDemoAgentSessions?: Map<string, DemoSession>;
};

const sessions = (): Map<string, DemoSession> => {
  const g = globalThis as GlobalWithDemoAgents;
  if (!g.__busabaseDemoAgentSessions) g.__busabaseDemoAgentSessions = new Map();
  return g.__busabaseDemoAgentSessions;
};

/** Keeps an abandoned demo tab from growing the map without bound. */
const MAX_DEMO_SESSIONS = 50;

const nowIso = () => new Date().toISOString();

const emit = (
  session: DemoSession,
  event: Omit<AgentSessionEventVO, "sessionId" | "seq" | "at">,
): void => {
  session.seq += 1;
  session.lastActivityAt = nowIso();
  const full: AgentSessionEventVO = {
    sessionId: session.id,
    seq: session.seq,
    at: session.lastActivityAt,
    ...event,
  };
  session.events.push(full);
  for (const listener of session.listeners) {
    try {
      listener(full);
    } catch {
      // A dead subscriber must not stop the script for the live ones.
    }
  }
};

const setStatus = (session: DemoSession, status: AgentSessionStatus): void => {
  session.status = status;
  emit(session, { kind: "status", status });
};

const toVO = (session: DemoSession): AgentSessionVO => ({
  id: session.id,
  slug: DEMO_AGENT_SLUG,
  agentName: session.agentName,
  transport: "local-subprocess",
  status: session.status,
  createdAt: session.createdAt,
  lastActivityAt: session.lastActivityAt,
  error: null,
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createDemoAgentSession = (slug: string): AgentSessionVO => {
  if (slug !== DEMO_AGENT_SLUG) {
    throw new Error(`"${slug}" cannot be launched in the demo. Try the demo agent instead.`);
  }
  const locale = getContextDemoLocale();
  const store = sessions();
  if (store.size >= MAX_DEMO_SESSIONS) {
    // Oldest first — a Map iterates in insertion order.
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  const id = `demo_sess_${Math.random().toString(36).slice(2, 10)}`;
  const session: DemoSession = {
    id,
    locale,
    agentName: copyFor(locale).name,
    status: "idle",
    createdAt: nowIso(),
    lastActivityAt: nowIso(),
    seq: 0,
    events: [],
    listeners: new Set(),
    pendingPermission: null,
    permissionCounter: 0,
    turn: 0,
  };
  store.set(id, session);
  // A note, exactly as the real manager emits one after `session/new`, so the
  // visitor is told what they are looking at inside the transcript rather than
  // only in a tooltip somewhere.
  emit(session, {
    kind: "acpUpdate",
    acpUpdate: {
      sessionUpdate: "note",
      text:
        locale === "zh-CN"
          ? "这是演示 Agent：回复是写死的脚本，不连任何模型，也不会改动工作区。"
          : "This is the demo agent: its replies are a fixed script. No model runs, and nothing in the workspace changes.",
    },
  });
  return toVO(session);
};

export const listDemoAgentSessions = (): AgentSessionVO[] => [...sessions().values()].map(toVO);

const requireDemoSession = (sessionId: string): DemoSession => {
  const session = sessions().get(sessionId);
  if (!session) throw new Error("That demo session is no longer available. Start a new one.");
  return session;
};

/**
 * Run one scripted turn.
 *
 * Started, never awaited, by the prompt handler — exactly like the real path
 * must be: it parks on the permission card until a human answers, and awaiting
 * that inside a request would hold the HTTP response open indefinitely.
 */
const runScript = async (session: DemoSession): Promise<void> => {
  const copy = copyFor(session.locale);
  setStatus(session, "busy");

  const chunk = async (text: string, variant: "agent_message_chunk" | "agent_thought_chunk") => {
    await sleep(90);
    emit(session, {
      kind: "acpUpdate",
      acpUpdate: { sessionUpdate: variant, content: { type: "text", text } },
    });
  };

  for (const text of copy.thought) await chunk(text, "agent_thought_chunk");

  const toolCallId = `demo_tool_${session.id}_${session.turn}`;
  await sleep(120);
  emit(session, {
    kind: "acpUpdate",
    acpUpdate: {
      sessionUpdate: "tool_call",
      toolCallId,
      title: copy.toolTitle,
      kind: "read",
      status: "in_progress",
    },
  });
  await sleep(220);
  emit(session, {
    kind: "acpUpdate",
    acpUpdate: { sessionUpdate: "tool_call_update", toolCallId, status: "completed" },
  });

  for (const text of copy.opening) await chunk(text, "agent_message_chunk");

  // The permission card — the most distinctive thing about this product's agent
  // integration, and the reason the demo cannot be a one-shot canned reply.
  const requestId = `demo_perm_${session.id}_${++session.permissionCounter}`;
  setStatus(session, "waiting_permission");
  emit(session, {
    kind: "permissionRequest",
    permissionRequest: {
      requestId,
      title: copy.permissionTitle,
      options: [
        { optionId: "allow", name: copy.allow, kind: "allow_once" },
        { optionId: "reject", name: copy.reject, kind: "reject_once" },
      ],
    },
  });

  const optionId = await new Promise<string>((resolve) => {
    session.pendingPermission = { requestId, resolve };
  });
  session.pendingPermission = null;

  emit(session, {
    kind: "permissionResolved",
    permissionRequestId: requestId,
    permissionOptionId: optionId,
  });
  setStatus(session, "busy");

  for (const text of optionId === "allow" ? copy.approved : copy.declined) {
    await chunk(text, "agent_message_chunk");
  }

  setStatus(session, "idle");
};

export const promptDemoAgentSession = (sessionId: string, text: string): void => {
  const session = requireDemoSession(sessionId);
  if (session.status === "busy" || session.status === "waiting_permission") {
    throw new Error("The demo agent is still working on the previous message.");
  }
  session.turn += 1;
  // Echo the user's own message in busabase's synthetic `user_message` shape —
  // the client's `translate()` adapter unpacks it, so a late subscriber sees
  // the whole turn rather than a reply to nothing.
  emit(session, { kind: "acpUpdate", acpUpdate: { sessionUpdate: "user_message", text } });
  void runScript(session).catch(() => {
    setStatus(session, "idle");
  });
};

export const respondToDemoAgentPermission = (
  sessionId: string,
  requestId: string,
  optionId: string,
): void => {
  const session = requireDemoSession(sessionId);
  if (!session.pendingPermission) {
    throw new Error("No permission request is pending for this session.");
  }
  if (session.pendingPermission.requestId !== requestId) {
    throw new Error("This permission request is no longer pending.");
  }
  if (optionId !== "allow" && optionId !== "reject") {
    throw new Error(`"${optionId}" is not one of the offered options.`);
  }
  session.pendingPermission.resolve(optionId);
};

export const cancelDemoAgentSession = (sessionId: string): void => {
  const session = sessions().get(sessionId);
  if (!session) return;
  // Cancelling while a card is up would otherwise leave `runScript` parked
  // forever on a promise nobody can resolve.
  session.pendingPermission?.resolve("reject");
  session.pendingPermission = null;
  if (session.status !== "ended") setStatus(session, "idle");
};

export const closeDemoAgentSession = (sessionId: string): void => {
  const session = sessions().get(sessionId);
  if (!session) return;
  session.pendingPermission?.resolve("reject");
  session.pendingPermission = null;
  session.status = "ended";
  emit(session, { kind: "status", status: "ended" });
  sessions().delete(sessionId);
};

/**
 * Replay everything after `afterSeq`, then follow live — the same contract the
 * real `subscribeAgentSession` offers, so a reconnect mid-stream catches up
 * instead of showing a gap.
 */
export async function* subscribeDemoAgentSession(
  sessionId: string,
  afterSeq: number,
  signal?: AbortSignal,
): AsyncGenerator<AgentSessionEventVO> {
  const session = sessions().get(sessionId);
  // An unknown id in the demo means the process restarted; an empty stream is
  // the honest answer, and it is what the real path does for a dead session.
  if (!session) return;

  const queue: AgentSessionEventVO[] = session.events.filter((event) => event.seq > afterSeq);
  let notify: (() => void) | undefined;
  const listener = (event: AgentSessionEventVO) => {
    queue.push(event);
    notify?.();
  };
  session.listeners.add(listener);

  try {
    while (!signal?.aborted) {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) yield next;
      }
      if (session.status === "ended") return;
      await new Promise<void>((resolve) => {
        notify = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      notify = undefined;
    }
  } finally {
    session.listeners.delete(listener);
  }
}

/** Test seam — the demo map is process-wide, so tests must be able to clear it. */
export const resetDemoAgentSessions = (): void => {
  sessions().clear();
};
