import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const port = Number(process.env.BUSABASE_ACP_PERMISSION_PORT ?? 15530);
const token = "sk_busabase_permission_fixture";
const agentId = "agt_busabase_permission_fixture";
type Id = string | number;
type Payload = Record<string, unknown>;
type Surface = "config" | "legacy" | "unsupported";
interface Session {
  id: string;
  surface: Surface;
  mode: string;
  prompts: Array<{ text: string; mode: string; askedPermission: boolean }>;
  selections: Array<{ method: string; value: string; accepted: boolean }>;
  decisions: string[];
  pending?: { id: Id; socket: WebSocket; text: string; permissionId: string };
}
const sessions = new Map<string, Session>();
let nextSurface: Surface = "config";
let rejectNextSelection = false;
const record = (value: unknown): Payload =>
  value !== null && typeof value === "object" ? (value as Payload) : {};
const send = (socket: WebSocket, value: unknown) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
};
const result = (socket: WebSocket, id: Id, value: unknown) =>
  send(socket, { jsonrpc: "2.0", id, result: value });
const error = (socket: WebSocket, id: Id, message: string) =>
  send(socket, { jsonrpc: "2.0", id, error: { code: -32602, message } });
const options = [
  { value: "default", name: "Default" },
  { value: "full-access", name: "Full access" },
];
const configuration = (session: Session) =>
  session.surface === "config"
    ? {
        configOptions: [
          {
            id: "permission_mode",
            name: "Permission mode",
            category: "mode",
            type: "select",
            currentValue: session.mode,
            options,
          },
        ],
      }
    : session.surface === "legacy"
      ? {
          modes: {
            currentModeId: session.mode,
            availableModes: options.map((option) => ({ id: option.value, name: option.name })),
          },
        }
      : {};
const finish = (session: Session, socket: WebSocket, id: Id, text: string) => {
  send(socket, {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: session.id,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
  result(socket, id, { stopReason: "end_turn" });
};
const server = createServer((request, response) => {
  void (async () => {
    if (request.url === "/health") {
      response.writeHead(200).end("ok");
      return;
    }
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/control/state") {
      response.end(
        JSON.stringify({
          sessions: [...sessions.values()].map(({ pending: _pending, ...session }) => session),
        }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/control/configure") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = record(JSON.parse(Buffer.concat(chunks).toString()));
      if (["config", "legacy", "unsupported"].includes(String(body.surface))) {
        nextSurface = body.surface as Surface;
      }
      rejectNextSelection = body.rejectNextSelection === true;
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404).end(JSON.stringify({ ok: false }));
  })().catch(() => response.writeHead(500).end(JSON.stringify({ ok: false })));
});
const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (
    request.headers.authorization !== `Bearer ${token}` ||
    url.pathname !== "/api/acp" ||
    url.searchParams.get("agentId") !== agentId
  ) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (client) => sockets.emit("connection", client));
});
sockets.on("connection", (socket) => {
  let session: Session | undefined;
  socket.on("message", (frame) => {
    void (async () => {
      const request = record(JSON.parse(frame.toString()));
      const params = record(request.params);
      const id = request.id as Id | undefined;
      if (!request.method && id !== undefined && session?.pending?.permissionId === id) {
        const pending = session.pending;
        session.pending = undefined;
        const outcome = record(record(request.result).outcome);
        const decision = String(outcome.optionId ?? "cancelled");
        session.decisions.push(decision);
        finish(
          session,
          pending.socket,
          pending.id,
          `${decision === "allow-once" ? "Approved" : "Rejected"}: ${pending.text}`,
        );
        return;
      }
      if (id === undefined) return;
      if (request.method === "initialize") {
        result(socket, id, {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true, promptCapabilities: {} },
          authMethods: [],
        });
        return;
      }
      if (request.method === "session/new") {
        session = {
          id: `acp_permission_${crypto.randomUUID()}`,
          surface: nextSurface,
          mode: "default",
          prompts: [],
          selections: [],
          decisions: [],
        };
        sessions.set(session.id, session);
        result(socket, id, { sessionId: session.id, ...configuration(session) });
        return;
      }
      if (request.method === "session/load") {
        session = sessions.get(String(params.sessionId));
        if (!session) error(socket, id, "Unknown session");
        else result(socket, id, configuration(session));
        return;
      }
      if (!session || params.sessionId !== session.id) {
        error(socket, id, "Unknown session");
        return;
      }
      if (request.method === "session/set_config_option" || request.method === "session/set_mode") {
        const value = String(params.value ?? params.modeId);
        const valid =
          (session.surface === "config" &&
            request.method === "session/set_config_option" &&
            params.configId === "permission_mode") ||
          (session.surface === "legacy" && request.method === "session/set_mode");
        const accepted =
          valid && options.some((option) => option.value === value) && !rejectNextSelection;
        rejectNextSelection = false;
        session.selections.push({ method: String(request.method), value, accepted });
        await new Promise((resolve) => setTimeout(resolve, 800));
        if (!accepted) {
          error(socket, id, "Fixture rejected permission mode selection");
          return;
        }
        session.mode = value;
        result(socket, id, session.surface === "config" ? configuration(session) : {});
        return;
      }
      if (request.method === "session/prompt") {
        const blocks = Array.isArray(params.prompt) ? params.prompt.map(record) : [];
        const text = blocks
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        const askedPermission = session.mode === "default";
        session.prompts.push({ text, mode: session.mode, askedPermission });
        if (!askedPermission) {
          finish(session, socket, id, `Full access completed: ${text}`);
          return;
        }
        const permissionId = `permission:${crypto.randomUUID()}`;
        session.pending = { id, socket, text, permissionId };
        send(socket, {
          jsonrpc: "2.0",
          id: permissionId,
          method: "session/request_permission",
          params: {
            sessionId: session.id,
            toolCall: {
              toolCallId: permissionId,
              title: `Allow writing preview: ${text}?`,
              kind: "edit",
              status: "pending",
              rawInput: { file: "preview.txt" },
            },
            options: [
              { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
              { optionId: "reject-once", name: "Reject", kind: "reject_once" },
            ],
          },
        });
        return;
      }
      error(socket, id, `Unsupported method: ${String(request.method)}`);
    })().catch(() => socket.close(1011, "Fixture request failed"));
  });
});
const shutdown = () => {
  for (const socket of sockets.clients) socket.close();
  sockets.close();
  server.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
server.listen(port, "127.0.0.1", () => console.log(`ACP permission fixture ready on ${port}`));
