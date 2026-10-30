import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const port = Number(process.env.BUSABASE_ACP_FIDELITY_PORT ?? 15442);
const expectedToken = "sk_busabase_fidelity_fixture";
const expectedAgentId = "agt_busabase_fidelity_fixture";
type RpcId = string | number;
type Payload = Record<string, unknown>;
type Entry = { jsonrpc: "2.0"; method: string; params: Payload };
interface Interaction {
  id: string;
  wireId: string;
  kind: "input" | "permission";
  stage: number;
}
interface Session {
  id: string;
  seq: number;
  turn: number;
  turnId: string;
  phase: string;
  history: Entry[];
  sockets: Set<WebSocket>;
  pending?: { id: RpcId; socket: WebSocket; prompt: string };
  interaction?: Interaction;
  prompts: string[];
  answers: Payload[];
  decisions: string[];
  loads: number[];
  resourceReads: string[];
  snapshotReads: number;
  snapshotUnavailable?: boolean;
}
const sessions = new Map<string, Session>();
const configuration = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "auto",
    options: [{ value: "auto", name: "Auto" }],
  },
];
const asRecord = (value: unknown): Payload =>
  value !== null && typeof value === "object" ? (value as Payload) : {};
const send = (socket: WebSocket, payload: unknown) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
};
const result = (socket: WebSocket, id: RpcId, value: unknown) =>
  send(socket, { jsonrpc: "2.0", id, result: value });
const error = (socket: WebSocket, id: RpcId, message: string) =>
  send(socket, { jsonrpc: "2.0", id, error: { code: -32602, message } });
const currentTime = () => new Date().toISOString();
function publish(session: Session, method: string, params: Payload, duplicate = false): Entry {
  session.seq += 1;
  const entry: Entry = {
    jsonrpc: "2.0",
    method,
    params: {
      ...params,
      _meta: {
        ...asRecord(params._meta),
        "buda.im": {
          seq: session.seq,
          eventId: `${session.id}:${session.seq}`,
          turnId: session.turnId,
        },
      },
    },
  };
  session.history.push(entry);
  for (const socket of session.sockets) {
    send(socket, entry);
    if (duplicate) send(socket, entry);
  }
  return entry;
}
function update(session: Session, payload: Payload, duplicate = false): void {
  session.seq += 1;
  const entry: Entry = {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: session.id,
      update: {
        ...payload,
        _meta: {
          ...asRecord(payload._meta),
          "buda.im": {
            seq: session.seq,
            eventId: `${session.id}:${session.seq}`,
            turnId: session.turnId,
          },
        },
      },
    },
  };
  session.history.push(entry);
  for (const socket of session.sockets) {
    send(socket, entry);
    if (duplicate) send(socket, entry);
  }
}
function event(session: Session, type: string, extra: Payload = {}, duplicate = false) {
  return publish(
    session,
    "_buda.im/session_event",
    {
      sessionId: session.id,
      event: { version: 1, type, turnId: session.turnId, at: currentTime(), ...extra },
    },
    duplicate,
  );
}
function begin(session: Session, id: RpcId, socket: WebSocket, prompt: string): void {
  if (session.pending) {
    error(socket, id, "A turn is already running.");
    return;
  }
  session.sockets.add(socket);
  session.pending = { id, socket, prompt };
  session.prompts.push(prompt);
  session.turn += 1;
  session.turnId = `${session.id}:turn:${session.turn}`;
  event(session, "turn_started");
  if (prompt.includes("CANCEL_FIDELITY")) {
    session.phase = "cancellable";
    event(session, "step_started", {
      stepId: `${session.turnId}:waiting`,
      label: "Cancellable work",
    });
    update(session, {
      sessionUpdate: "tool_call",
      toolCallId: `${session.turnId}:long`,
      title: "Wait for cancellation",
      kind: "execute",
      status: "in_progress",
      rawInput: { operation: "fixture wait" },
    });
    return;
  }
  if (!prompt.includes("FULL_FIDELITY")) {
    session.phase = "follow-up";
    update(session, {
      sessionUpdate: "agent_message_chunk",
      messageId: `${session.turnId}:answer`,
      content: { type: "text", text: "Follow-up completed in the same session." },
    });
    complete(session);
    return;
  }
  session.phase = "progress";
  update(session, { sessionUpdate: "session_info_update", title: "Fidelity acceptance" });
  update(session, {
    sessionUpdate: "plan",
    entries: [
      { content: "Inspect sources", priority: "high", status: "in_progress" },
      { content: "Deliver report", priority: "medium", status: "pending" },
    ],
  });
  event(session, "step_started", { stepId: `${session.turnId}:inspect`, label: "Inspect sources" });
  update(session, {
    sessionUpdate: "agent_thought_chunk",
    messageId: `${session.turnId}:thought`,
    content: { type: "text", text: "I am inspecting the source before preparing the report." },
  });
  const parent = `${session.turnId}:parent`;
  update(session, {
    sessionUpdate: "tool_call",
    toolCallId: parent,
    title: "Inspect project with a subtask",
    kind: "think",
    status: "in_progress",
  });
  update(
    session,
    {
      sessionUpdate: "tool_call",
      toolCallId: `${session.turnId}:child`,
      title: "Read acceptance source",
      kind: "read",
      status: "in_progress",
      rawInput: { path: "/agent/report.md" },
      _meta: { "bunny-agent/parentToolCallId": parent },
    },
    true,
  );
  update(session, {
    sessionUpdate: "tool_call_update",
    toolCallId: `${session.turnId}:child`,
    status: "completed",
    locations: [{ path: "/agent/report.md", line: 2 }],
    content: [{ type: "content", content: { type: "text", text: "Read the existing draft." } }],
    rawOutput: "Read the existing draft.",
  });
  update(session, {
    sessionUpdate: "tool_call_update",
    toolCallId: parent,
    status: "completed",
    rawOutput: "Source inspection finished.",
  });
  update(session, {
    sessionUpdate: "tool_call",
    toolCallId: `${session.turnId}:edit`,
    title: "Update report draft",
    kind: "edit",
    status: "completed",
    locations: [{ path: "/agent/report.md", line: 1 }],
    content: [
      {
        type: "diff",
        path: "/agent/report.md",
        oldText: "Draft before acceptance",
        newText: "Draft after acceptance",
      },
    ],
    rawInput: { path: "/agent/report.md" },
    rawOutput: { changed: true },
  });
  event(session, "step_finished", { stepId: `${session.turnId}:inspect` });
  event(session, "job_update", {
    job: { id: `${session.turnId}:job`, title: "Prepare report image", status: "running" },
  });
}
function requestInput(session: Session): void {
  if (!session.pending || session.phase !== "progress") return;
  session.phase = "question";
  event(session, "step_started", { stepId: `${session.turnId}:deliver`, label: "Deliver report" });
  const id = `${session.turnId}:question`;
  const wireId = `rpc:${id}`;
  session.interaction = { id, wireId, kind: "input", stage: 0 };
  const requestedSchema = {
    type: "object",
    required: ["approach", "topics", "notes"],
    properties: {
      approach: { type: "string", title: "Approach", enum: ["Complete", "Focused"] },
      topics: {
        type: "array",
        title: "Topics",
        items: { type: "string", enum: ["UI", "Recovery"] },
        minItems: 1,
      },
      notes: { type: "string", title: "Notes", minLength: 1 },
    },
  };
  event(session, "input_request", {
    requestId: id,
    message: "Choose the report scope",
    requestedSchema,
  });
  send(session.pending.socket, {
    jsonrpc: "2.0",
    id: wireId,
    method: "elicitation/create",
    params: {
      sessionId: session.id,
      mode: "form",
      message: "Choose the report scope",
      requestedSchema,
      _meta: { "buda.im": { interactionId: id } },
    },
  });
}
function requestPermission(session: Session, stage: number): void {
  if (!session.pending) return;
  session.phase = stage === 1 ? "allow-permission" : "deny-permission";
  const id = `${session.turnId}:permission:${stage}`;
  const wireId = `rpc:${id}`;
  session.interaction = { id, wireId, kind: "permission", stage };
  const title =
    stage === 1 ? "Allow creating the report preview?" : "Allow deleting the source draft?";
  const options = [
    { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
    { optionId: "reject-once", name: "Reject", kind: "reject_once" },
  ];
  event(session, "permission_request", { requestId: id, title, options });
  send(session.pending.socket, {
    jsonrpc: "2.0",
    id: wireId,
    method: "session/request_permission",
    params: {
      sessionId: session.id,
      toolCall: { toolCallId: id, title, kind: stage === 1 ? "edit" : "delete", status: "pending" },
      options,
      _meta: { "buda.im": { interactionId: id } },
    },
  });
}
function decide(session: Session, response: Payload): void {
  const interaction = session.interaction;
  if (!interaction) return;
  session.interaction = undefined;
  if (interaction.kind === "input") {
    const answer = {
      action: response.action,
      ...(response.action === "accept" && response.content ? { content: response.content } : {}),
    };
    session.answers.push(answer);
    event(session, "input_resolved", { requestId: interaction.id, ...answer });
    requestPermission(session, 1);
  } else {
    const outcome = asRecord(response.outcome);
    const optionId =
      typeof outcome.optionId === "string"
        ? outcome.optionId
        : typeof response.optionId === "string"
          ? response.optionId
          : "cancelled";
    session.decisions.push(optionId);
    event(session, "permission_resolved", { requestId: interaction.id, optionId });
    if (interaction.stage === 1) requestPermission(session, 2);
    else session.phase = "ready-to-finish";
  }
}
function complete(session: Session): void {
  if (!session.pending) return;
  const pending = session.pending;
  event(session, "turn_finished", {
    stopReason: "end_turn",
    usage: { inputTokens: 21, outputTokens: 13, totalTokens: 34 },
  });
  session.phase = "idle";
  session.pending = undefined;
  result(pending.socket, pending.id, {
    stopReason: "end_turn",
    usage: { inputTokens: 21, outputTokens: 13, totalTokens: 34 },
  });
}
function finish(session: Session): void {
  if (session.phase !== "ready-to-finish") return;
  update(session, {
    sessionUpdate: "plan",
    entries: [
      { content: "Inspect sources", priority: "high", status: "completed" },
      { content: "Deliver report", priority: "medium", status: "completed" },
    ],
  });
  event(session, "step_finished", { stepId: `${session.turnId}:deliver` });
  event(session, "resource_update", {
    resource: {
      id: "result-image",
      uri: "buda://resource/result-image",
      name: "acceptance-result.png",
      mimeType: "image/png",
      status: "ready",
    },
  });
  event(session, "job_update", {
    job: {
      id: `${session.turnId}:job`,
      title: "Prepare report image",
      status: "succeeded",
      resourceIds: ["result-image"],
    },
  });
  const text = "Fidelity report ready [1].";
  const messageId = `${session.turnId}:answer`;
  update(session, {
    sessionUpdate: "agent_message_chunk",
    messageId,
    content: { type: "text", text },
  });
  update(session, {
    sessionUpdate: "agent_message_chunk",
    messageId,
    content: {
      type: "resource_link",
      uri: "https://example.com/fidelity",
      name: "Acceptance reference",
      _meta: { "bunny-agent/sourceId": "source-1" },
    },
  });
  update(session, {
    sessionUpdate: "agent_message_chunk",
    messageId,
    content: { type: "text", text: "" },
    _meta: {
      "bunny-agent/providerMetadata": {
        "bunny-agent": {
          citation_contract: {
            schema_version: 1,
            offset_unit: "unicode-code-points",
            processing: "complete",
            annotations: [
              {
                type: "url_citation",
                start_index: text.indexOf("[1]"),
                end_index: text.indexOf("[1]") + 3,
                url: "https://example.com/fidelity",
                title: "Acceptance reference",
              },
            ],
            bindings: [
              {
                annotation_index: 0,
                source_id: "source-1",
                origin: "explicit_source_marker",
                tool_call_ids: [],
              },
            ],
          },
        },
      },
    },
  });
  update(session, {
    sessionUpdate: "usage_update",
    used: 64,
    size: 8192,
    cost: { amount: 0.01, currency: "USD" },
  });
  complete(session);
}
function cancel(session: Session): void {
  if (!session.pending) return;
  const pending = session.pending;
  session.pending = undefined;
  const interaction = session.interaction;
  session.interaction = undefined;
  if (interaction?.kind === "input")
    event(session, "input_resolved", { requestId: interaction.id, action: "cancel" });
  if (interaction?.kind === "permission")
    event(session, "permission_cancelled", { requestId: interaction.id });
  event(session, "turn_finished", { stopReason: "cancelled" });
  session.phase = "idle";
  result(pending.socket, pending.id, { stopReason: "cancelled" });
}

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAACi0lEQVR4nO3csUmEQRCA0evK1EaswsQOrEIwNrYD27ANES4yOy6U9cfZj3vwClgGvmxnTl/fZyDqNP4CYJmAIUzAECZgCBMwhAkYwgQMYQKGMAFDmIAhTMAQ9quA7x8+gX8mYAgTMIQJGMIEDGEChjABQ5iAIUzAECZgCBMwhAkYwgQMYQKGMAFDmIAhTMAQJmAIEzCECRjCBAxhAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGEChrDDAgb2JGAIEzCECRjCBAxhAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGEChjABQ5iAIUzAECZgCBMwhAkYwgQMYQKGsAMCvnt9/LvxQUCRgCFMwBAmYAjrBfz0/AJpAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGEChrCbDhi4EDCECRjCBAxhAoYwAUOYgCFMwBAmYAhzFxrCBAxhAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGEChjABQ5iAIUzAECZgCBMwhAkYwg4I+O39A7gmYAgTMIQJGMIEDGEChjABQ5iAIawUMDBFwBAmYAgTMIQJGMIEDGEChjABQ5iAIUzAECZgCBMwhAkYwgQMYQKGMAFDmIV+bsh4bwKGdeO9CRjWjfcmYFg33puAYd14bwKGdeO9CRjWjfcmYFg33tuOAQNTBAxhAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGEChjABQ5iAIUzAECZgCBMwhFnoZzvjVYQImO2MVxEiYLYzXkWIgNnOeBUhAmY741WECJjtjFcRImC2M15FiIDZzngVIT5yQJiAIUzAECZgCBMwhAkYwgQMYQKGMAFDmIAhTMAQJmAIEzCECRjCBAxhAoYwAUOYgCFMwBAmYAj7AeaEC1IalO12AAAAAElFTkSuQmCC",
  "base64",
);
const server = createServer((request, response) => {
  void (async () => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/health") {
      response.end("ok");
      return;
    }
    if (url.pathname === "/files/result.png") {
      response.writeHead(200, { "content-type": "image/png", "content-length": pixel.length });
      response.end(pixel);
      return;
    }
    if (url.pathname === "/files/recovered.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("Recovered while disconnected.");
      return;
    }
    if (url.pathname === "/control/state") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          sessions: [...sessions.values()].map((session) => ({
            id: session.id,
            seq: session.seq,
            phase: session.phase,
            prompts: session.prompts,
            answers: session.answers,
            decisions: session.decisions,
            loads: session.loads,
            resourceReads: session.resourceReads,
            snapshotReads: session.snapshotReads,
            sockets: [...session.sockets].filter((socket) => socket.readyState === WebSocket.OPEN)
              .length,
          })),
        }),
      );
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(404);
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? asRecord(JSON.parse(Buffer.concat(chunks).toString("utf8"))) : {};
    const session =
      typeof body.sessionId === "string"
        ? sessions.get(body.sessionId)
        : [...sessions.values()].at(-1);
    if (!session) {
      response.writeHead(409);
      response.end("No session");
      return;
    }
    if (url.pathname === "/control/ask") requestInput(session);
    else if (url.pathname === "/control/snapshot-unavailable") session.snapshotUnavailable = true;
    else if (url.pathname === "/control/finish") finish(session);
    else if (url.pathname === "/control/duplicate") {
      const last = session.history.at(-1);
      for (const socket of session.sockets) if (last) send(socket, last);
    } else if (url.pathname === "/control/offline-update") {
      for (const socket of session.sockets) socket.terminate();
      event(session, "resource_update", {
        resource: {
          id: "recovered-note",
          uri: "buda://resource/recovered-note",
          name: "recovered-note.txt",
          mimeType: "text/plain",
        },
      });
    } else {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, phase: session.phase, seq: session.seq }));
  })().catch((failure) => {
    response.writeHead(500);
    response.end(failure instanceof Error ? failure.message : String(failure));
  });
});
const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (
    request.headers.authorization !== `Bearer ${expectedToken}` ||
    url.searchParams.get("agentId") !== expectedAgentId
  ) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (websocket) =>
    sockets.emit("connection", websocket),
  );
});
sockets.on("connection", (socket) => {
  socket.on("close", () => {
    for (const session of sessions.values()) session.sockets.delete(socket);
  });
  socket.on("message", (bytes) => {
    const request = JSON.parse(bytes.toString()) as {
      id?: RpcId;
      method?: string;
      params?: unknown;
      result?: unknown;
    };
    const params = asRecord(request.params);
    if (!request.method && request.id !== undefined) {
      const session = [...sessions.values()].find(
        (candidate) => candidate.interaction?.wireId === request.id,
      );
      if (session) decide(session, asRecord(request.result));
      return;
    }
    if (request.method === "initialize" && request.id !== undefined) {
      result(socket, request.id, {
        protocolVersion: 1,
        agentInfo: { name: "fidelity-fixture", version: "1" },
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true, audio: true, embeddedContext: true },
          _meta: {
            "buda.im": {
              eventStream: 1,
              replayCursor: 1,
              resourceRead: 1,
              interactionRespond: 1,
              sessionSnapshot: 1,
            },
          },
        },
      });
      return;
    }
    if (request.method === "session/new" && request.id !== undefined) {
      const id = `fixture_${sessions.size + 1}`;
      const session: Session = {
        id,
        seq: -1,
        turn: 0,
        turnId: "",
        phase: "idle",
        history: [],
        sockets: new Set([socket]),
        prompts: [],
        answers: [],
        decisions: [],
        loads: [],
        resourceReads: [],
        snapshotReads: 0,
      };
      sessions.set(id, session);
      result(socket, request.id, { sessionId: id, configOptions: configuration });
      return;
    }
    const session =
      typeof params.sessionId === "string" ? sessions.get(params.sessionId) : undefined;
    if (!session) {
      if (request.id !== undefined) error(socket, request.id, "Unknown session.");
      return;
    }
    if (request.method === "session/load" && request.id !== undefined) {
      const cursor = asRecord(asRecord(params._meta)["buda.im"]).afterSeq;
      const afterSeq = typeof cursor === "number" ? cursor : -1;
      session.loads.push(afterSeq);
      session.sockets.add(socket);
      // Deliberately redeliver the cursor event as well as new entries.
      for (const entry of session.history) {
        const payload =
          entry.method === "session/update" ? asRecord(entry.params.update) : entry.params;
        const seq = asRecord(asRecord(payload._meta)["buda.im"]).seq;
        if (typeof seq === "number" && seq >= afterSeq) send(socket, entry);
      }
      result(socket, request.id, { configOptions: configuration });
      return;
    }
    if (request.method === "session/prompt" && request.id !== undefined) {
      const text = Array.isArray(params.prompt)
        ? params.prompt.map((part) => asRecord(part).text ?? "").join("")
        : "";
      begin(session, request.id, socket, text);
      return;
    }
    if (request.method === "session/cancel") {
      cancel(session);
      return;
    }
    if (request.method === "_buda.im/session/snapshot" && request.id !== undefined) {
      session.snapshotReads += 1;
      const observedAt = currentTime();
      result(socket, request.id, {
        version: 1,
        agentId: expectedAgentId,
        sessionId: session.id,
        runtime: { runner: "fixture-runner", model: "fixture-model", workdir: "/agent/acceptance" },
        views: session.snapshotUnavailable
          ? [
              {
                kind: "browser",
                status: "unavailable",
                message: "No browser activity has been observed.",
              },
              {
                kind: "terminal",
                status: "unavailable",
                message: "No terminal output has been observed.",
              },
            ]
          : [
              {
                kind: "browser",
                status: "available",
                resource: {
                  id: "browser-snapshot",
                  uri: "buda://snapshot/browser",
                  previewUri: `data:image/png;base64,${pixel.toString("base64")}`,
                  name: "Observed browser frame",
                  mimeType: "image/png",
                  _meta: { "buda.im": { observedAt } },
                },
              },
              {
                kind: "terminal",
                status: "available",
                resource: {
                  id: "terminal-snapshot",
                  uri: "buda://snapshot/terminal",
                  name: "Observed terminal output",
                  mimeType: "text/plain",
                  _meta: {
                    "buda.im": {
                      observedAt,
                      snapshotText: "Read the existing draft.\nSource inspection finished.",
                    },
                  },
                },
              },
            ],
      });
      return;
    }
    if (request.method === "_buda.im/resource/read" && request.id !== undefined) {
      const resourceId = String(params.resourceId ?? "");
      session.resourceReads.push(resourceId);
      if (!["result-image", "recovered-note"].includes(resourceId)) {
        error(socket, request.id, "Unknown resource.");
        return;
      }
      result(socket, request.id, {
        id: resourceId,
        uri: `http://127.0.0.1:${port}/files/${resourceId === "result-image" ? "result.png" : "recovered.txt"}`,
        name: resourceId === "result-image" ? "acceptance-result.png" : "recovered-note.txt",
        mimeType: resourceId === "result-image" ? "image/png" : "text/plain",
      });
      return;
    }
    if (request.method === "_buda.im/interaction/respond" && request.id !== undefined) {
      if (!session.interaction || params.requestId !== session.interaction.id) {
        error(socket, request.id, "Request no longer pending.");
        return;
      }
      decide(
        session,
        params.optionId ? { outcome: { outcome: "selected", optionId: params.optionId } } : params,
      );
      result(socket, request.id, { ok: true });
      return;
    }
    if (request.method === "session/set_config_option" && request.id !== undefined) {
      result(socket, request.id, { configOptions: configuration });
      return;
    }
    if (request.id !== undefined) error(socket, request.id, `Unsupported method ${request.method}`);
  });
});
server.listen(port, "127.0.0.1", () =>
  process.stdout.write(`ACP fidelity fixture ready on ${port}\n`),
);
const close = () => {
  for (const client of sockets.clients) client.terminate();
  sockets.close();
  server.close(() => process.exit(0));
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
