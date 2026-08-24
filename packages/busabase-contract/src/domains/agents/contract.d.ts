import { z } from "zod";
/**
 * Agents contract — Busabase acting as an ACP *client*, driving external agents.
 *
 * Every procedure here is RPC-only (no `.route(...)`): these drive processes and
 * long-lived sockets, which is not something to publish as a REST/MCP tool
 * surface. It also keeps `subscribe`'s Event Iterator out of OpenAPI generation,
 * matching how `live.subscribe` is declared.
 */
export declare const agentsContract: {
  /** Connectable backends. Availability is resolved per request, not cached in the client. */
  catalog: import("@orpc/contract").ContractProcedureBuilderWithOutput<
    import("@orpc/contract").Schema<unknown, unknown>,
    z.ZodArray<
      z.ZodObject<
        {
          slug: z.ZodString;
          name: z.ZodString;
          description: z.ZodDefault<z.ZodString>;
          transport: z.ZodEnum<{
            "local-subprocess": "local-subprocess";
            "remote-websocket": "remote-websocket";
          }>;
          version: z.ZodDefault<z.ZodNullable<z.ZodString>>;
          available: z.ZodDefault<z.ZodBoolean>;
          unavailableReason: z.ZodDefault<z.ZodNullable<z.ZodString>>;
          connectionRequired: z.ZodDefault<z.ZodBoolean>;
          connectedAgentName: z.ZodDefault<z.ZodNullable<z.ZodString>>;
          connectedAgents: z.ZodDefault<
            z.ZodArray<
              z.ZodObject<
                {
                  slug: z.ZodString;
                  name: z.ZodString;
                },
                z.core.$strip
              >
            >
          >;
        },
        z.core.$strip
      >
    >,
    Record<never, never>,
    Record<never, never>
  >;
  disconnect: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        slug: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        ok: z.ZodBoolean;
        deletedSessionCount: z.ZodNumber;
      },
      z.core.$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  sessions: {
    list: import("@orpc/contract").ContractProcedureBuilderWithOutput<
      import("@orpc/contract").Schema<unknown, unknown>,
      z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            slug: z.ZodString;
            agentName: z.ZodString;
            transport: z.ZodEnum<{
              "local-subprocess": "local-subprocess";
              "remote-websocket": "remote-websocket";
            }>;
            status: z.ZodEnum<{
              busy: "busy";
              connecting: "connecting";
              ended: "ended";
              failed: "failed";
              idle: "idle";
              waiting_permission: "waiting_permission";
            }>;
            createdAt: z.ZodString;
            lastActivityAt: z.ZodString;
            error: z.ZodDefault<z.ZodNullable<z.ZodString>>;
          },
          z.core.$strip
        >
      >,
      Record<never, never>,
      Record<never, never>
    >;
    create: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
      z.ZodObject<
        {
          slug: z.ZodString;
        },
        z.core.$strip
      >,
      z.ZodObject<
        {
          id: z.ZodString;
          slug: z.ZodString;
          agentName: z.ZodString;
          transport: z.ZodEnum<{
            "local-subprocess": "local-subprocess";
            "remote-websocket": "remote-websocket";
          }>;
          status: z.ZodEnum<{
            busy: "busy";
            connecting: "connecting";
            ended: "ended";
            failed: "failed";
            idle: "idle";
            waiting_permission: "waiting_permission";
          }>;
          createdAt: z.ZodString;
          lastActivityAt: z.ZodString;
          error: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        },
        z.core.$strip
      >,
      Record<never, never>,
      Record<never, never>
    >;
    /**
     * Send a message. Returns as soon as the turn is accepted — the reply arrives
     * on `subscribe`, not here, so a slow agent never blocks the caller.
     */
    prompt: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
      z.ZodObject<
        {
          sessionId: z.ZodString;
          text: z.ZodString;
          attachments: z.ZodOptional<
            z.ZodArray<
              z.ZodObject<
                {
                  kind: z.ZodEnum<{
                    audio: "audio";
                    image: "image";
                  }>;
                  data: z.ZodString;
                  mimeType: z.ZodString;
                },
                z.core.$strip
              >
            >
          >;
        },
        z.core.$strip
      >,
      z.ZodObject<
        {
          accepted: z.ZodBoolean;
          sessionId: z.ZodString;
        },
        z.core.$strip
      >,
      Record<never, never>,
      Record<never, never>
    >;
    cancel: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
      z.ZodObject<
        {
          sessionId: z.ZodString;
        },
        z.core.$strip
      >,
      z.ZodObject<
        {
          ok: z.ZodBoolean;
        },
        z.core.$strip
      >,
      Record<never, never>,
      Record<never, never>
    >;
    close: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
      z.ZodObject<
        {
          sessionId: z.ZodString;
        },
        z.core.$strip
      >,
      z.ZodObject<
        {
          ok: z.ZodBoolean;
        },
        z.core.$strip
      >,
      Record<never, never>,
      Record<never, never>
    >;
    /**
     * Answer a pending `session/request_permission`. There is no auto-approve
     * and no "remember this choice" in this pass (deliberate, see spec) — every
     * request blocks the turn until a human calls this.
     */
    respondToPermission: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
      z.ZodObject<
        {
          sessionId: z.ZodString;
          requestId: z.ZodString;
          optionId: z.ZodString;
        },
        z.core.$strip
      >,
      z.ZodObject<
        {
          ok: z.ZodBoolean;
        },
        z.core.$strip
      >,
      Record<never, never>,
      Record<never, never>
    >;
    /**
     * Live event stream for one session. Replays buffered events from `afterSeq`
     * first so a client that reconnects mid-turn does not lose the tokens it
     * missed, then follows live.
     */
    subscribe: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
      z.ZodObject<
        {
          sessionId: z.ZodString;
          afterSeq: z.ZodDefault<z.ZodNumber>;
        },
        z.core.$strip
      >,
      import("@orpc/contract").Schema<
        AsyncIteratorObject<
          {
            sessionId: string;
            seq: number;
            kind: "acpUpdate" | "error" | "permissionRequest" | "permissionResolved" | "status";
            acpUpdate?: unknown;
            status?:
              | "busy"
              | "connecting"
              | "ended"
              | "failed"
              | "idle"
              | "waiting_permission"
              | undefined;
            message?: string | undefined;
            permissionRequest?:
              | {
                  requestId: string;
                  title?: string | undefined;
                  description?: string | undefined;
                  options: {
                    optionId: string;
                    name: string;
                    kind?: string | undefined;
                  }[];
                }
              | undefined;
            permissionRequestId?: string | undefined;
            permissionOptionId?: string | undefined;
            at: string;
          },
          unknown,
          void
        >,
        import("@orpc/shared").AsyncIteratorClass<
          {
            sessionId: string;
            seq: number;
            kind: "acpUpdate" | "error" | "permissionRequest" | "permissionResolved" | "status";
            acpUpdate?: unknown;
            status?:
              | "busy"
              | "connecting"
              | "ended"
              | "failed"
              | "idle"
              | "waiting_permission"
              | undefined;
            message?: string | undefined;
            permissionRequest?:
              | {
                  requestId: string;
                  title?: string | undefined;
                  description?: string | undefined;
                  options: {
                    optionId: string;
                    name: string;
                    kind?: string | undefined;
                  }[];
                }
              | undefined;
            permissionRequestId?: string | undefined;
            permissionOptionId?: string | undefined;
            at: string;
          },
          unknown,
          void
        >
      >,
      Record<never, never>,
      Record<never, never>
    >;
  };
};
