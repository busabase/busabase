/**
 * Agents domain — DTO (inputs) and VO (outputs) for driving EXTERNAL ACP agents.
 *
 * Standalone zod only: no drizzle, no `~/db`, no server imports. These types are
 * pulled into the browser bundle and the mobile client is generated from them.
 *
 * Vocabulary note: an "agent" here is a *backend we connect out to* (Claude Code,
 * Codex, a remote Buda agent), NOT one of Busabase's own nodes.
 */
import { z } from "zod";
/**
 * How a backend is reached. This is the axis that decides everything else:
 * `local-subprocess` runs on whichever machine serves the request (the user's
 * own laptop on the tunnel path), `remote-websocket` needs no local process at
 * all and is therefore the only kind mobile can use.
 */
export declare const AgentTransportSchema: z.ZodEnum<{
  "local-subprocess": "local-subprocess";
  "remote-websocket": "remote-websocket";
}>;
export type AgentTransport = z.infer<typeof AgentTransportSchema>;
/** A connectable backend offered to the user. */
export declare const AgentCatalogEntryVOSchema: z.ZodObject<
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
>;
export type AgentCatalogEntryVO = z.infer<typeof AgentCatalogEntryVOSchema>;
/**
 * `waiting_permission` is deliberately its own status, not folded into `busy`:
 * the UI needs to tell "the agent is thinking" apart from "the agent is
 * blocked on a human decision it cannot proceed without" — the input box stays
 * disabled either way, but only the latter shows the permission card.
 */
export declare const AgentSessionStatusSchema: z.ZodEnum<{
  busy: "busy";
  connecting: "connecting";
  ended: "ended";
  failed: "failed";
  idle: "idle";
  waiting_permission: "waiting_permission";
}>;
export type AgentSessionStatus = z.infer<typeof AgentSessionStatusSchema>;
/** One option ACP offered for a permission request — `kind` is a UI hint, not a guarantee. */
export declare const AgentPermissionOptionVOSchema: z.ZodObject<
  {
    optionId: z.ZodString;
    name: z.ZodString;
    kind: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type AgentPermissionOptionVO = z.infer<typeof AgentPermissionOptionVOSchema>;
export declare const AgentPermissionRequestVOSchema: z.ZodObject<
  {
    requestId: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    options: z.ZodArray<
      z.ZodObject<
        {
          optionId: z.ZodString;
          name: z.ZodString;
          kind: z.ZodOptional<z.ZodString>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export type AgentPermissionRequestVO = z.infer<typeof AgentPermissionRequestVOSchema>;
export declare const AgentSessionVOSchema: z.ZodObject<
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
>;
export type AgentSessionVO = z.infer<typeof AgentSessionVOSchema>;
/**
 * One streamed event from a session.
 *
 * `acpUpdate` carries the agent's own `session/update` payload near-verbatim as
 * unknown-shaped JSON: ACP v1 and v2 disagree on its inner shape and agents
 * straddle both, so re-validating it here would reject traffic that is
 * perfectly good. The client renders what it recognises and ignores the rest.
 *
 * `permissionRequest`/`permissionResolved` are deliberately their own `kind`,
 * not smuggled into `acpUpdate` — ACP's `session/request_permission` is a
 * request the AGENT makes of the CLIENT (the reverse direction from every
 * `session/update` notification), so pretending it were an update would
 * misdescribe the protocol, not just the UI.
 */
export declare const AgentSessionEventVOSchema: z.ZodObject<
  {
    sessionId: z.ZodString;
    seq: z.ZodNumber;
    kind: z.ZodEnum<{
      acpUpdate: "acpUpdate";
      error: "error";
      permissionRequest: "permissionRequest";
      permissionResolved: "permissionResolved";
      status: "status";
    }>;
    acpUpdate: z.ZodOptional<z.ZodUnknown>;
    status: z.ZodOptional<
      z.ZodEnum<{
        busy: "busy";
        connecting: "connecting";
        ended: "ended";
        failed: "failed";
        idle: "idle";
        waiting_permission: "waiting_permission";
      }>
    >;
    message: z.ZodOptional<z.ZodString>;
    permissionRequest: z.ZodOptional<
      z.ZodObject<
        {
          requestId: z.ZodString;
          title: z.ZodOptional<z.ZodString>;
          description: z.ZodOptional<z.ZodString>;
          options: z.ZodArray<
            z.ZodObject<
              {
                optionId: z.ZodString;
                name: z.ZodString;
                kind: z.ZodOptional<z.ZodString>;
              },
              z.core.$strip
            >
          >;
        },
        z.core.$strip
      >
    >;
    permissionRequestId: z.ZodOptional<z.ZodString>;
    permissionOptionId: z.ZodOptional<z.ZodString>;
    at: z.ZodString;
  },
  z.core.$strip
>;
export type AgentSessionEventVO = z.infer<typeof AgentSessionEventVOSchema>;
export declare const CreateAgentSessionInputSchema: z.ZodObject<
  {
    slug: z.ZodString;
  },
  z.core.$strip
>;
export type CreateAgentSessionInput = z.infer<typeof CreateAgentSessionInputSchema>;
export declare const DisconnectAgentInputSchema: z.ZodObject<
  {
    slug: z.ZodString;
  },
  z.core.$strip
>;
export type DisconnectAgentInput = z.infer<typeof DisconnectAgentInputSchema>;
/** Base64 image/audio the browser attached — ACP's `ImageContent`/`AudioContent` shape verbatim. */
export declare const PromptAttachmentInputSchema: z.ZodObject<
  {
    kind: z.ZodEnum<{
      audio: "audio";
      image: "image";
    }>;
    data: z.ZodString;
    mimeType: z.ZodString;
  },
  z.core.$strip
>;
export type PromptAttachmentInput = z.infer<typeof PromptAttachmentInputSchema>;
export declare const PromptAgentSessionInputSchema: z.ZodObject<
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
>;
export type PromptAgentSessionInput = z.infer<typeof PromptAgentSessionInputSchema>;
export declare const AgentSessionIdInputSchema: z.ZodObject<
  {
    sessionId: z.ZodString;
  },
  z.core.$strip
>;
export type AgentSessionIdInput = z.infer<typeof AgentSessionIdInputSchema>;
export declare const RespondToAgentPermissionInputSchema: z.ZodObject<
  {
    sessionId: z.ZodString;
    requestId: z.ZodString;
    optionId: z.ZodString;
  },
  z.core.$strip
>;
export type RespondToAgentPermissionInput = z.infer<typeof RespondToAgentPermissionInputSchema>;
