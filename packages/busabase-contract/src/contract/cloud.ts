import { oc } from "@orpc/contract";
import { z } from "zod";
import { busabaseContractRoutes } from "./busabase";

/**
 * Cloud public REST contract — the OSS workbench surface plus the cloud-only
 * public endpoints (system, the authenticated user, agent tasks, and member
 * invitations). It is the superset a `busabase.com` API key can reach over
 * `/api/v1`, and the contract a cloud-aware client (CLI / mobile) builds its
 * client from. Pure zod, no logic / db imports. System-admin endpoints are
 * intentionally NOT here — they stay an internal RPC surface and are never
 * exposed to API-key clients.
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

// ── Members (cloud-only) ──────────────────────────────────────────────────────
// The web People settings page's invitation features, for an API key. Standalone
// zod: this package cannot import share-domains or the cloud app, so Cloud pins
// these against the DTOs its logic accepts (see the cloud app's
// `members-api-logic.ts`, where the public inputs are passed straight into the
// web's own functions, plus its contract test for the defaults).

/** Roles grantable over the public API. `owner` is never accepted here. */
export const MemberGrantRoleSchema = z.enum(["member", "admin"]);
export type MemberGrantRole = z.infer<typeof MemberGrantRoleSchema>;

export const InviteMemberRequestSchema = z.object({
  email: z.string().email(),
  role: MemberGrantRoleSchema.default("member"),
});
export type InviteMemberRequest = z.infer<typeof InviteMemberRequestSchema>;

/** `resent` is present when a pending invitation for this address was re-sent. */
export const MemberInvitationResultSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string().nullable(),
  status: z.string(),
  resent: z.boolean().optional(),
});
export type MemberInvitationResult = z.infer<typeof MemberInvitationResultSchema>;

export const PendingMemberInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string().nullable(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  inviterName: z.string(),
});
export type PendingMemberInvitation = z.infer<typeof PendingMemberInvitationSchema>;

export const MemberInvitationIdRequestSchema = z.object({ invitationId: z.string() });

export const MemberSuccessSchema = z.object({ success: z.boolean() });

/** Same fields and defaults as the web's invite-link form: never expires, no approval. */
export const CreateMemberInviteLinkRequestSchema = z.object({
  role: MemberGrantRoleSchema.default("member"),
  teamId: z.string().nullish(),
  requiresApproval: z.boolean().default(false),
  /** ISO datetime; null/omitted = never expires. */
  expiresAt: z.string().datetime().nullish(),
  /** Positive cap on successful joins; null/omitted = unlimited. */
  maxUses: z.number().int().positive().nullish(),
});
export type CreateMemberInviteLinkRequest = z.infer<typeof CreateMemberInviteLinkRequestSchema>;

export const MemberInviteLinkSchema = z.object({
  id: z.string(),
  /** The join URL to share — what the web's Copy button copies. */
  url: z.string(),
  role: z.string(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  requiresApproval: z.boolean(),
  expiresAt: z.string().nullable(),
  maxUses: z.number().nullable(),
  useCount: z.number(),
  createdByUserId: z.string(),
  createdByName: z.string(),
  createdByImage: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MemberInviteLink = z.infer<typeof MemberInviteLinkSchema>;

export const MemberInviteLinkIdRequestSchema = z.object({ inviteLinkId: z.string() });

export const MemberJoinRequestSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string(),
  userEmail: z.string(),
  userImage: z.string().nullable(),
  source: z.string(),
  role: z.string(),
  status: z.string(),
  createdAt: z.string(),
});
export type MemberJoinRequest = z.infer<typeof MemberJoinRequestSchema>;

export const ReviewMemberJoinRequestRequestSchema = z.object({
  joinRequestId: z.string(),
  decision: z.enum(["approve", "reject"]),
});
export type ReviewMemberJoinRequestRequest = z.infer<typeof ReviewMemberJoinRequestRequestSchema>;

export const ReviewMemberJoinRequestResultSchema = z.object({
  success: z.boolean(),
  status: z.enum(["pending", "approved", "rejected"]),
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

const forbiddenErrors = {
  FORBIDDEN: {
    status: 403,
    message: "Forbidden",
    data: ErrorResponseSchema,
  },
};

const securedOperation = <T extends object>(operation: T) => ({
  ...operation,
  security: [{ bearerAuth: [] }],
});

const MEMBERS_PERMISSION_NOTE =
  "The person behind the credential must be an owner or admin of the space. A `write`-level API key may grant the `member` role; granting `admin` needs a `manage`-level key.";

/**
 * Cloud's `/api/v1/members/*`, relative like every route here. Exported so the
 * Cloud server mounts these exact definitions (`oc.prefix("/api/v1")`) — the
 * routes the CLI calls and the routes Cloud serves cannot drift apart.
 */
export const cloudMembersRoutes = {
  invite: oc
    .route({
      method: "POST",
      path: "/members/invitations",
      tags: ["Members"],
      summary: "Invite someone to the space by email",
      description: `Sends the invitation email right away; it is valid for 7 days. Inviting an address that already has a pending invitation re-sends it. ${MEMBERS_PERMISSION_NOTE}`,
      successDescription:
        "Invite one person to this space by email. Sends the invitation email immediately.",
      spec: securedOperation,
    })
    .errors({
      ...authenticatedErrors,
      ...forbiddenErrors,
      CONFLICT: { status: 409, message: "Conflict", data: ErrorResponseSchema },
    })
    .input(InviteMemberRequestSchema)
    .output(MemberInvitationResultSchema),
  listInvitations: oc
    .route({
      method: "GET",
      path: "/members/invitations",
      tags: ["Members"],
      summary: "List pending email invitations",
      description: MEMBERS_PERMISSION_NOTE,
      successDescription: "Pending email invitations for this space.",
      spec: securedOperation,
    })
    .errors({ ...authenticatedErrors, ...forbiddenErrors })
    .output(z.array(PendingMemberInvitationSchema)),
  cancelInvitation: oc
    .route({
      method: "DELETE",
      path: "/members/invitations/{invitationId}",
      tags: ["Members"],
      summary: "Cancel an email invitation",
      description: MEMBERS_PERMISSION_NOTE,
      successDescription: "Cancel a pending email invitation so its link stops working.",
      spec: securedOperation,
    })
    .errors({ ...authenticatedErrors, ...forbiddenErrors })
    .input(MemberInvitationIdRequestSchema)
    .output(MemberSuccessSchema),
  listInviteLinks: oc
    .route({
      method: "GET",
      path: "/members/invite-links",
      tags: ["Members"],
      summary: "List active invite links",
      description: MEMBERS_PERMISSION_NOTE,
      successDescription:
        "Invite links of this space that have not been revoked, each with its `url`.",
      spec: securedOperation,
    })
    .errors({ ...authenticatedErrors, ...forbiddenErrors })
    .output(z.array(MemberInviteLinkSchema)),
  createInviteLink: oc
    .route({
      method: "POST",
      path: "/members/invite-links",
      tags: ["Members"],
      summary: "Create an invite link",
      description: `Defaults match the web: role \`member\`, never expires, unlimited uses, no approval. With \`requiresApproval\`, people who open it file a join request instead of joining. ${MEMBERS_PERMISSION_NOTE}`,
      successDescription:
        "Create a shareable invite link for this space; share the returned `url` with the people who should join.",
      spec: securedOperation,
    })
    .errors({
      ...authenticatedErrors,
      ...forbiddenErrors,
      BAD_REQUEST: { status: 400, message: "Bad Request", data: ErrorResponseSchema },
    })
    .input(CreateMemberInviteLinkRequestSchema)
    .output(MemberInviteLinkSchema),
  revokeInviteLink: oc
    .route({
      method: "DELETE",
      path: "/members/invite-links/{inviteLinkId}",
      tags: ["Members"],
      summary: "Revoke an invite link",
      description: `People who already joined through it stay members. ${MEMBERS_PERMISSION_NOTE}`,
      successDescription: "Revoke an invite link so nobody new can join through it.",
      spec: securedOperation,
    })
    .errors({ ...authenticatedErrors, ...forbiddenErrors, ...notFoundErrors })
    .input(MemberInviteLinkIdRequestSchema)
    .output(MemberSuccessSchema),
  listJoinRequests: oc
    .route({
      method: "GET",
      path: "/members/join-requests",
      tags: ["Members"],
      summary: "List pending join requests",
      description: MEMBERS_PERMISSION_NOTE,
      successDescription:
        "Pending join requests from invite links that require approval, with the role each would get.",
      spec: securedOperation,
    })
    .errors({ ...authenticatedErrors, ...forbiddenErrors })
    .output(z.array(MemberJoinRequestSchema)),
  reviewJoinRequest: oc
    .route({
      method: "POST",
      path: "/members/join-requests/{joinRequestId}/review",
      tags: ["Members"],
      summary: "Approve or reject a join request",
      description: `Approving adds the requester with the role their invite link grants; approving an \`admin\` request needs a \`manage\`-level key. ${MEMBERS_PERMISSION_NOTE}`,
      successDescription: "Approve or reject a pending join request.",
      spec: securedOperation,
    })
    .errors({
      ...authenticatedErrors,
      ...forbiddenErrors,
      ...notFoundErrors,
      BAD_REQUEST: { status: 400, message: "Bad Request", data: ErrorResponseSchema },
    })
    .input(ReviewMemberJoinRequestRequestSchema)
    .output(ReviewMemberJoinRequestResultSchema),
};

// Paths are relative — the shared `/api/v1` prefix is applied once on the router
// below, exactly like the workbench routes.
const {
  // Cloud publishes this shared slice once through `cloudExtraRoutes` below.
  embedLinks: _embedLinksAlreadyPublishedAtRoot,
  vault: _localVault,
  ...cloudWorkbenchRoutes
} = busabaseContractRoutes;

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
  // Cloud keeps the same public top-level client shape, but the route definitions
  // now come from the OSS/Cloud workbench contract so tunnels and Desktop expose
  // exactly the same capability.
  embedLinks: busabaseContractRoutes.embedLinks,
  // Cloud only. The open-source and Desktop servers have no members, so these
  // answer their router's 404 there (see busabase-cli's `isRouteMissing`).
  members: cloudMembersRoutes,
};

export const cloudContract = oc.prefix("/api/v1").router({
  ...cloudWorkbenchRoutes,
  ...cloudExtraRoutes,
});

export type CloudContract = typeof cloudContract;
