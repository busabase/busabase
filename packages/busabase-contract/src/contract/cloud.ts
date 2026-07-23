import { oc } from "@orpc/contract";
import { z } from "zod";
import { busabaseContractRoutes } from "./busabase";
import {
  CreatedEmbedLinkVOSchema,
  CreateEmbedLinkInputSchema,
  EmbedLinkVOSchema,
  ListEmbedLinksInputSchema,
  RevokeEmbedLinkInputSchema,
  RevokeEmbedLinkVOSchema,
} from "./embed-link-schemas";

/**
 * Cloud public REST contract — the OSS workbench surface plus the cloud-only
 * public endpoints (system, the authenticated user, and agent tasks). It is the
 * superset a `busabase.com` API key can reach over `/api/v1`, and the contract a
 * cloud-aware client (CLI / mobile) builds its client from. Pure zod, no logic /
 * db imports. System-admin endpoints are intentionally NOT here — they stay an
 * internal RPC surface and are never exposed to API-key clients.
 */

const ErrorResponseSchema = z.object({
  error: z.string(),
});

export const HealthResponseSchema = z.object({
  status: z.string(),
  timestamp: z.string(),
});

export const MetaResponseSchema = z.object({
  service: z.string(),
  version: z.string(),
  timestamp: z.number(),
});

export const UserMeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  createdAt: z.string(),
});

export const AgentTaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
]);

export const AgentTaskListItemSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export const AgentTaskDetailSchema = AgentTaskListItemSchema.extend({
  result: z.string().nullable(),
});

const authenticatedErrors = {
  UNAUTHORIZED: {
    status: 401,
    message: "Unauthorized",
    data: ErrorResponseSchema,
  },
};

const notFoundErrors = {
  NOT_FOUND: {
    status: 404,
    message: "Not Found",
    data: ErrorResponseSchema,
  },
};

const embedLinksErrors = {
  BAD_REQUEST: { status: 400, message: "Bad Request", data: ErrorResponseSchema },
  ...authenticatedErrors,
  FORBIDDEN: { status: 403, message: "Forbidden", data: ErrorResponseSchema },
  ...notFoundErrors,
};

const securedRoute = (operation: Record<string, unknown>) => ({
  ...operation,
  security: [{ bearerAuth: [] }],
});

// Paths are relative — the shared `/api/v1` prefix is applied once on the router
// below, exactly like the workbench routes.
const { vault: _localVault, ...cloudWorkbenchRoutes } = busabaseContractRoutes;

const cloudExtraRoutes = {
  system: {
    health: oc
      .route({
        method: "GET",
        path: "/health",
        tags: ["System"],
        summary: "Service health status",
        successDescription: "Service health status",
      })
      .output(HealthResponseSchema),
    meta: oc
      .route({
        method: "GET",
        path: "/meta",
        tags: ["System"],
        summary: "Service metadata",
        successDescription: "Service metadata",
      })
      .output(MetaResponseSchema),
  },
  users: {
    me: oc
      .route({
        method: "GET",
        path: "/users/me",
        tags: ["Users"],
        summary: "Get authenticated user",
        successDescription: "Authenticated user information",
        spec: (operation) => ({
          ...operation,
          security: [{ bearerAuth: [] }],
        }),
      })
      .errors(authenticatedErrors)
      .output(UserMeResponseSchema),
  },
  agentTasks: {
    list: oc
      .route({
        method: "GET",
        path: "/agent-tasks",
        tags: ["Agent Tasks"],
        summary: "List agent tasks",
        successDescription: "List of agent tasks",
        inputStructure: "detailed",
        spec: (operation) => ({
          ...operation,
          security: [{ bearerAuth: [] }],
        }),
      })
      .errors(authenticatedErrors)
      .input(
        z.object({
          query: z.object({
            limit: z.string().optional(),
            offset: z.string().optional(),
            status: AgentTaskStatusSchema.optional(),
          }),
        }),
      )
      .output(
        z.object({
          tasks: z.array(AgentTaskListItemSchema),
          total: z.number(),
        }),
      ),
    get: oc
      .route({
        method: "GET",
        path: "/agent-tasks/{id}",
        tags: ["Agent Tasks"],
        summary: "Get agent task",
        successDescription: "Agent task details",
        inputStructure: "detailed",
        spec: (operation) => ({
          ...operation,
          security: [{ bearerAuth: [] }],
        }),
      })
      .errors({
        ...authenticatedErrors,
        ...notFoundErrors,
      })
      .input(
        z.object({
          params: z.object({
            id: z.string(),
          }),
        }),
      )
      .output(AgentTaskDetailSchema),
  },
  // Relative-path twin of `embedLinksContract`
  // (apps/busabase-cloud/src/domains/embed-links/contract.ts, served at the absolute
  // `/api/v1/embed-links` paths) — same schemas imported from `./embed-link-schemas`, just
  // routed relative here so the shared `/api/v1` prefix below lands on the identical real path.
  embedLinks: {
    create: oc
      .route({
        method: "POST",
        path: "/embed-links",
        tags: ["Embed Links"],
        summary: "Create a short-lived read-only embed link for one node",
        successDescription: "The capability URL is returned once; only its secret hash is stored.",
        spec: securedRoute,
      })
      .errors(embedLinksErrors)
      .input(CreateEmbedLinkInputSchema)
      .output(CreatedEmbedLinkVOSchema),
    list: oc
      .route({
        method: "GET",
        path: "/embed-links",
        tags: ["Embed Links"],
        summary: "List embed links the caller can manage",
        successDescription: "Embed link metadata without capability secrets.",
        spec: securedRoute,
      })
      .errors(embedLinksErrors)
      .input(ListEmbedLinksInputSchema)
      .output(z.array(EmbedLinkVOSchema)),
    revoke: oc
      .route({
        method: "DELETE",
        path: "/embed-links/{id}",
        tags: ["Embed Links"],
        summary: "Revoke an embed link",
        successDescription: "The capability stops resolving immediately.",
        spec: securedRoute,
      })
      .errors(embedLinksErrors)
      .input(RevokeEmbedLinkInputSchema)
      .output(RevokeEmbedLinkVOSchema),
  },
};

export const cloudContract = oc.prefix("/api/v1").router({
  ...cloudWorkbenchRoutes,
  ...cloudExtraRoutes,
});

export type CloudContract = typeof cloudContract;
