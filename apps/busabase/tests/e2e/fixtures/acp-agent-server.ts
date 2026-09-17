import { createServer } from "node:http";
import { type WebSocket, WebSocketServer } from "ws";

const port = Number(process.env.BUSABASE_ACP_FIXTURE_PORT ?? 15430);
const expectedToken = process.env.BUSABASE_ACP_FIXTURE_TOKEN ?? "sk_busabase_agent_chat_e2e";
const expectedAgentId = process.env.BUSABASE_ACP_FIXTURE_AGENT_ID ?? "agt_agent_chat_e2e";

type JsonRpcId = number | string;

interface JsonRpcRequest {
  id?: JsonRpcId;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
}

type ProgressVariant = "thought" | "tool";

interface PreparedPrompt {
  progress: ProgressVariant;
  pending?: {
    id: JsonRpcId;
    modelName: string;
    sessionId: string;
    socket: WebSocket;
  };
  progressReleased: boolean;
  toolCallId?: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const modelOptions = (currentValue: string) => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue,
    options: [
      { value: "auto", name: "Auto" },
      { value: "gpt-5.6", name: "GPT-5.6" },
    ],
  },
];

const sendResult = (socket: WebSocket, id: JsonRpcId, result: unknown) => {
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
};

const sendError = (socket: WebSocket, id: JsonRpcId, code: number, message: string) => {
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const preparedPrompts = new Map<string, PreparedPrompt>();

const readJsonBody = async (request: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return asRecord(JSON.parse(Buffer.concat(chunks).toString("utf8")));
};

const sendJson = (
  response: import("node:http").ServerResponse,
  status: number,
  body: Record<string, unknown>,
) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const sendProgress = (promptText: string, prepared: PreparedPrompt) => {
  const pending = prepared.pending;
  if (!pending) return false;
  if (prepared.progress === "thought") {
    pending.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: pending.sessionId,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: `Planning a response for: ${promptText}` },
          },
        },
      }),
    );
  } else {
    prepared.toolCallId = `tool_${crypto.randomUUID()}`;
    pending.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: pending.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: prepared.toolCallId,
            title: `Inspect context for: ${promptText}`,
            kind: "read",
            status: "in_progress",
          },
        },
      }),
    );
  }
  prepared.progressReleased = true;
  return true;
};

const sendReply = (promptText: string, prepared: PreparedPrompt) => {
  const pending = prepared.pending;
  if (!pending || !prepared.progressReleased) return false;
  if (prepared.toolCallId) {
    pending.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: pending.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: prepared.toolCallId,
            status: "completed",
          },
        },
      }),
    );
  }
  pending.socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: pending.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `${pending.modelName} completed controlled prompt: ${promptText}`,
          },
        },
      },
    }),
  );
  sendResult(pending.socket, pending.id, { stopReason: "end_turn" });
  preparedPrompts.delete(promptText);
  return true;
};

const httpServer = createServer((request, response) => {
  void (async () => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }
    if (request.method === "GET" && request.url === "/control/state") {
      sendJson(response, 200, { sessions: sessionModels.size });
      return;
    }
    if (request.method === "POST" && request.url === "/control/prepare") {
      const body = await readJsonBody(request);
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      const progress =
        body.progress === "tool" ? "tool" : body.progress === "thought" ? "thought" : null;
      if (!prompt || !progress) {
        sendJson(response, 400, { ok: false, error: "prompt and progress are required" });
        return;
      }
      preparedPrompts.set(prompt, { progress, progressReleased: false });
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && request.url === "/control/release-progress") {
      const body = await readJsonBody(request);
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      const prepared = preparedPrompts.get(prompt);
      if (!prepared || !sendProgress(prompt, prepared)) {
        sendJson(response, 425, { ok: false, error: "prompt has not reached the ACP fixture" });
        return;
      }
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && request.url === "/control/release-reply") {
      const body = await readJsonBody(request);
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      const prepared = preparedPrompts.get(prompt);
      if (!prepared || !sendReply(prompt, prepared)) {
        sendJson(response, 425, { ok: false, error: "progress has not been released" });
        return;
      }
      sendJson(response, 200, { ok: true });
      return;
    }
    response.writeHead(404);
    response.end();
  })().catch((error) => {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : "error" });
  });
});

const webSocketServer = new WebSocketServer({ noServer: true });
const sessionModels = new Map<string, string>();

httpServer.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const authorized = request.headers.authorization === `Bearer ${expectedToken}`;
  const correctAgent =
    url.pathname === "/api/acp" && url.searchParams.get("agentId") === expectedAgentId;

  if (!authorized || !correctAgent) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocketServer.emit("connection", webSocket, request);
  });
});

webSocketServer.on("connection", (socket) => {
  let sessionId = `acp_agent_chat_${crypto.randomUUID()}`;
  let currentModel = "auto";

  socket.on("message", (frame) => {
    void (async () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(frame.toString()) as JsonRpcRequest;
      } catch {
        return;
      }

      if (request.method === "session/cancel") {
        // ACP: `session/cancel` is a notification, not a request — it has no
        // `id` and expects no reply. What it obligates the agent to do is
        // resolve the *original* `session/prompt` request with
        // `stopReason: "cancelled"` rather than leaving it hanging, which is
        // exactly the behavior PUL-244 depends on: busabase's client must not
        // treat the turn as over until that original request settles.
        const cancelledSessionId = asRecord(request.params).sessionId;
        for (const [promptText, prepared] of preparedPrompts.entries()) {
          const pending = prepared.pending;
          if (!pending || pending.sessionId !== cancelledSessionId) continue;
          sendResult(pending.socket, pending.id, { stopReason: "cancelled" });
          preparedPrompts.delete(promptText);
        }
        return;
      }
      if (request.id === undefined) return;

      if (request.method === "initialize") {
        sendResult(socket, request.id, {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
          },
          authMethods: [],
        });
        return;
      }

      if (request.method === "session/new") {
        sessionModels.set(sessionId, currentModel);
        sendResult(socket, request.id, {
          sessionId,
          configOptions: modelOptions(currentModel),
        });
        return;
      }

      if (request.method === "session/load") {
        const savedSessionId = asRecord(request.params).sessionId;
        if (typeof savedSessionId !== "string" || !sessionModels.has(savedSessionId)) {
          sendError(socket, request.id, -32602, "Unknown ACP session");
          return;
        }
        sessionId = savedSessionId;
        currentModel = sessionModels.get(savedSessionId) ?? "auto";
        sendResult(socket, request.id, { configOptions: modelOptions(currentModel) });
        return;
      }

      if (request.method === "session/set_config_option") {
        const params = asRecord(request.params);
        const nextModel = params.value;
        if (
          params.sessionId !== sessionId ||
          params.configId !== "model" ||
          (nextModel !== "auto" && nextModel !== "gpt-5.6")
        ) {
          sendError(socket, request.id, -32602, "Invalid model selection");
          return;
        }
        // Keep this response pending long enough for the browser test to prove
        // that the composer is disabled while model selection is in flight. If
        // a prompt races this request, the reply still identifies the old model.
        await wait(1_000);
        currentModel = nextModel;
        sessionModels.set(sessionId, currentModel);
        sendResult(socket, request.id, { configOptions: modelOptions(currentModel) });
        return;
      }

      if (request.method === "session/prompt") {
        const params = asRecord(request.params);
        const prompt = Array.isArray(params.prompt) ? params.prompt : [];
        const textBlock = prompt.map(asRecord).find((block) => block.type === "text");
        const promptText = typeof textBlock?.text === "string" ? textBlock.text : "";

        if (params.sessionId !== sessionId || !promptText) {
          sendError(socket, request.id, -32602, "Invalid prompt");
          return;
        }

        const currentModelName = currentModel === "gpt-5.6" ? "GPT-5.6" : "Auto";
        // Node-context prompts include a host prefix. Match the prepared user
        // instruction without dropping the real context from the request.
        const prepared =
          preparedPrompts.get(promptText) ??
          [...preparedPrompts.entries()].find(([text]) => promptText.endsWith(text))?.[1];
        if (prepared) {
          prepared.pending = {
            id: request.id,
            modelName: currentModelName,
            sessionId,
            socket,
          };
          return;
        }
        const responseText =
          promptText === "Show a long answer"
            ? Array.from(
                { length: 40 },
                (_, index) =>
                  `Paragraph ${index + 1}: enough content to require transcript scrolling.`,
              ).join("\n\n")
            : `${currentModelName} received the first prompt: ${promptText}`;
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: {
                  type: "text",
                  text: responseText,
                },
              },
            },
          }),
        );
        sendResult(socket, request.id, { stopReason: "end_turn" });
        return;
      }

      sendError(socket, request.id, -32601, `Unsupported method: ${request.method ?? "unknown"}`);
    })();
  });
});

const shutdown = () => {
  for (const client of webSocketServer.clients) client.close();
  webSocketServer.close();
  httpServer.close();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

httpServer.listen(port, "127.0.0.1", () => {
  console.log(`ACP E2E fixture listening on http://127.0.0.1:${port}`);
});
