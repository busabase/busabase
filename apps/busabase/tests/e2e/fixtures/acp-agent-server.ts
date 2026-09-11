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

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  response.writeHead(404);
  response.end();
});

const webSocketServer = new WebSocketServer({ noServer: true });

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
  const sessionId = `acp_agent_chat_${Date.now().toString(36)}`;
  let currentModel = "auto";

  socket.on("message", (frame) => {
    void (async () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(frame.toString()) as JsonRpcRequest;
      } catch {
        return;
      }

      if (request.method === "session/cancel") return;
      if (request.id === undefined) return;

      if (request.method === "initialize") {
        sendResult(socket, request.id, {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: false,
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
          },
          authMethods: [],
        });
        return;
      }

      if (request.method === "session/new") {
        sendResult(socket, request.id, {
          sessionId,
          configOptions: modelOptions(currentModel),
        });
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
                  text: `${currentModelName} received the first prompt: ${promptText}`,
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
