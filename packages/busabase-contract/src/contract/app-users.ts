import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * App users — the end users of an app built on Busabase (a shop's buyers, a
 * member page's members). Cloud only.
 *
 * They are NOT space members: one pool per space, identity = a verified email,
 * login = a 6-digit email code. Every route here is called by the app's own
 * server (its Worker), with the app's existing API key + `x-busabase-space`;
 * the browser only ever talks to the app's own routes, which proxy. The
 * routes that act AS an app user additionally carry the session token the app
 * stored in its own cookie, in the `x-busabase-app-user-session` header.
 *
 * Pure zod, no logic / db imports — the Cloud server mounts these exact
 * definitions (`oc.prefix("/api/v1")`) and the SDK builds its client from them.
 */

export const APP_USER_SESSION_HEADER = "x-busabase-app-user-session";

/**
 * The end user's IP, forwarded by the app's server on `send-code` (a Worker
 * sends `CF-Connecting-IP`, else the first `X-Forwarded-For` hop). Trusted only
 * because the request is already authenticated with the app's own key. Absent
 * or not an IPv4/IPv6 address → the per-IP limits are skipped.
 */
export const APP_USER_IP_HEADER = "x-busabase-app-user-ip";

/** Error codes a client branches on. The HTTP body is `{ code, error, ...extra }`. */
export const APP_USERS_ERROR_CODES = {
  loginDisabled: "APP_LOGIN_DISABLED",
  invalidEmail: "INVALID_EMAIL",
  rateLimited: "RATE_LIMITED",
  invalidCode: "INVALID_CODE",
  codeExpired: "CODE_EXPIRED",
  userDisabled: "APP_USER_DISABLED",
  sessionInvalid: "APP_USER_SESSION_INVALID",
  invalidOwnerField: "INVALID_OWNER_FIELD",
  /** The space's plan does not include app user sign-in (Busabase Cloud: Plus and above). */
  planRequired: "APP_USERS_PLAN_REQUIRED",
} as const;

/** In the order the limits are checked. */
export const AppUserRateLimitReasonSchema = z.enum([
  "cooldown",
  "ip_hourly_limit",
  "ip_daily_limit",
  "email_daily_limit",
  "space_daily_limit",
]);
export type AppUserRateLimitReason = z.infer<typeof AppUserRateLimitReasonSchema>;

// ── Settings ────────────────────────────────────────────────────────────────

export const AppUsersSettingsVOSchema = z.object({
  appId: z.string(),
  enabled: z.boolean(),
  appName: z.string().nullable(),
});
export type AppUsersSettingsVO = z.infer<typeof AppUsersSettingsVOSchema>;

export const GetAppUsersSettingsInputSchema = z.object({ appId: z.string().min(1) });
export type GetAppUsersSettingsInput = z.infer<typeof GetAppUsersSettingsInputSchema>;

export const PutAppUsersSettingsInputSchema = z.object({
  appId: z.string().min(1),
  enabled: z.boolean(),
  appName: z.string().trim().max(100).optional(),
});
export type PutAppUsersSettingsInput = z.infer<typeof PutAppUsersSettingsInputSchema>;

// ── Sign-in ────────────────────────────────────────────────────────────────

export const AppUserEmailSchema = z.string().trim().toLowerCase().pipe(z.string().email().max(254));

/**
 * `send-code` takes any string as `email` and checks it in the handler, so a
 * malformed address answers the documented `400 { code: "INVALID_EMAIL" }`
 * instead of the generic input-validation error a login form cannot branch on.
 */
export const SendAppUserCodeInputSchema = z.object({
  appId: z.string().min(1),
  email: z.string().max(1000),
  locale: z.string().max(35).optional(),
});
export type SendAppUserCodeInput = z.infer<typeof SendAppUserCodeInputSchema>;

/** The `send-code` request as the route sees it: the JSON body plus the optional IP header. */
export const SendAppUserCodeRequestSchema = z.object({
  body: SendAppUserCodeInputSchema,
  headers: z.object({
    // Lenient on purpose: a malformed value is ignored by the handler, never a 400.
    [APP_USER_IP_HEADER]: z.string().optional(),
  }),
});
export type SendAppUserCodeRequest = z.infer<typeof SendAppUserCodeRequestSchema>;

export const SendAppUserCodeResultSchema = z.object({
  ok: z.literal(true),
  resendAfterSeconds: z.number().int(),
});
export type SendAppUserCodeResult = z.infer<typeof SendAppUserCodeResultSchema>;

export const VerifyAppUserCodeInputSchema = z.object({
  appId: z.string().min(1),
  email: AppUserEmailSchema,
  code: z.string().trim().min(1).max(32),
});
export type VerifyAppUserCodeInput = z.infer<typeof VerifyAppUserCodeInputSchema>;

export const AppUserRefVOSchema = z.object({
  id: z.string(),
  email: z.string(),
});
export type AppUserRefVO = z.infer<typeof AppUserRefVOSchema>;

export const VerifyAppUserCodeResultSchema = z.object({
  sessionToken: z.string(),
  expiresAt: z.string(),
  user: AppUserRefVOSchema,
});
export type VerifyAppUserCodeResult = z.infer<typeof VerifyAppUserCodeResultSchema>;

/** The session header, optional at the schema so a missing one is the documented 401, not a 400. */
const AppUserSessionHeadersSchema = z.object({
  [APP_USER_SESSION_HEADER]: z.string().optional(),
});

export const GetAppUserSessionInputSchema = z.object({
  query: z.object({ appId: z.string().min(1) }),
  headers: AppUserSessionHeadersSchema,
});
export type GetAppUserSessionInput = z.infer<typeof GetAppUserSessionInputSchema>;

export const AppUserSessionResultSchema = z.object({ user: AppUserRefVOSchema });
export type AppUserSessionResult = z.infer<typeof AppUserSessionResultSchema>;

export const SignOutAppUserInputSchema = z.object({
  body: z.object({ appId: z.string().min(1) }),
  headers: AppUserSessionHeadersSchema,
});
export type SignOutAppUserInput = z.infer<typeof SignOutAppUserInputSchema>;

export const AppUserOkSchema = z.object({ ok: z.literal(true) });

// ── Records, as the signed-in app user ──────────────────────────────────────

export const QueryAppUserRecordsInputSchema = z.object({
  body: z.object({
    appId: z.string().min(1),
    baseId: z.string().min(1),
    /**
     * Slug of the App user (`appUser`) or text field in that Base that holds
     * the owning app user's id.
     * The app's own server picks it; the platform fills in the verified value.
     */
    ownerField: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
  }),
  headers: AppUserSessionHeadersSchema,
});
export type QueryAppUserRecordsInput = z.infer<typeof QueryAppUserRecordsInputSchema>;

export const AppUserRecordVOSchema = z.object({
  id: z.string(),
  fields: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AppUserRecordVO = z.infer<typeof AppUserRecordVOSchema>;

export const QueryAppUserRecordsResultSchema = z.object({
  records: z.array(AppUserRecordVOSchema),
  nextCursor: z.string().nullable(),
});
export type QueryAppUserRecordsResult = z.infer<typeof QueryAppUserRecordsResultSchema>;

// ── Administration ─────────────────────────────────────────────────────────

export const AppUserStatusSchema = z.enum(["active", "disabled"]);
export type AppUserStatus = z.infer<typeof AppUserStatusSchema>;

export const AppUserVOSchema = z.object({
  id: z.string(),
  email: z.string(),
  status: AppUserStatusSchema,
  createdAt: z.string(),
  lastSignInAt: z.string().nullable(),
  apps: z.array(z.string()),
});
export type AppUserVO = z.infer<typeof AppUserVOSchema>;

export const ListAppUsersInputSchema = z.object({
  email: z.string().optional(),
  appId: z.string().optional(),
});
export type ListAppUsersInput = z.infer<typeof ListAppUsersInputSchema>;

export const ListAppUsersResultSchema = z.object({ users: z.array(AppUserVOSchema) });
export type ListAppUsersResult = z.infer<typeof ListAppUsersResultSchema>;

export const AppUserIdInputSchema = z.object({ id: z.string().min(1) });
export type AppUserIdInput = z.infer<typeof AppUserIdInputSchema>;

// ── Routes ─────────────────────────────────────────────────────────────────

const ErrorBodySchema = z.object({ error: z.string() });
/** `APP_USERS_PLAN_REQUIRED`: `requiredPlan` is the cheapest plan that includes sign-in. */
const PlanRequiredErrorBodySchema = ErrorBodySchema.extend({ requiredPlan: z.string() });

const authErrors = {
  UNAUTHORIZED: { status: 401, message: "Unauthorized", data: ErrorBodySchema },
  FORBIDDEN: { status: 403, message: "Forbidden", data: ErrorBodySchema },
  NOT_FOUND: { status: 404, message: "Not Found", data: ErrorBodySchema },
};

const sessionErrors = {
  APP_USER_SESSION_INVALID: {
    status: 401,
    message: "The app user session is missing, expired, revoked, or for another app",
    data: ErrorBodySchema,
  },
};

const securedOperation = <T extends object>(operation: T) => ({
  ...operation,
  security: [{ bearerAuth: [] }],
});

const CALLER_NOTE =
  "Called by the app's own server with its API key and `x-busabase-space`; the credential needs at least `read` on the app node.";
const SESSION_NOTE = `Acts as the signed-in app user: send the session token from \`verify\` in the \`${APP_USER_SESSION_HEADER}\` header.`;
const ADMIN_NOTE = "The person behind the credential must be an owner or admin of the space.";

export const cloudAppUsersRoutes = {
  getSettings: oc
    .route({
      method: "GET",
      path: "/app-users/apps/{appId}/settings",
      tags: ["App Users"],
      summary: "Read an app's user sign-in settings",
      description: `Returns \`enabled: false\` for an app that was never configured. ${CALLER_NOTE}`,
      successDescription: "The app's sign-in settings.",
      spec: securedOperation,
    })
    .errors(authErrors)
    .input(GetAppUsersSettingsInputSchema)
    .output(AppUsersSettingsVOSchema),
  putSettings: oc
    .route({
      method: "PUT",
      path: "/app-users/apps/{appId}/settings",
      tags: ["App Users"],
      summary: "Turn app user sign-in on or off",
      description:
        "`appName` is the name sign-in emails use (defaults to the app node's name); leave it out to keep the current name, send an empty string to clear it. Which rows belong to which app user is decided by the app's own server when it calls `records/query`. Requires `manage` on the app node (space owners and admins have it). On Busabase Cloud, turning sign-in on requires a paid plan (Plus or above); otherwise `APP_USERS_PLAN_REQUIRED`. Turning it off is always allowed.",
      successDescription: "The saved settings.",
      spec: securedOperation,
    })
    .errors({
      ...authErrors,
      BAD_REQUEST: { status: 400, message: "Bad Request", data: ErrorBodySchema },
      APP_USERS_PLAN_REQUIRED: {
        status: 403,
        message: "App user sign-in requires a paid plan",
        data: PlanRequiredErrorBodySchema,
      },
    })
    .input(PutAppUsersSettingsInputSchema)
    .output(AppUsersSettingsVOSchema),
  sendCode: oc
    .route({
      method: "POST",
      path: "/app-users/send-code",
      tags: ["App Users"],
      summary: "Email a 6-digit sign-in code to an app user",
      description: `Same response whether or not the address already has an account. The code is valid for 10 minutes and 5 attempts; sending a new one invalidates the older ones. The email is written in \`locale\` when supported (en, zh-CN, zh-TW, ja, ko, de, fr, es, pt, vi), else English. Limits, checked in this order: one code per email per 60 s (\`cooldown\`); with the end user's IP in \`${APP_USER_IP_HEADER}\`, 5 per IP per app per hour (\`ip_hourly_limit\`) and 20 per day (\`ip_daily_limit\`); 10 per email per day (\`email_daily_limit\`); 1000 per space per day for addresses that are not yet active app users (\`space_daily_limit\`) — returning users are exempt. On Busabase Cloud the space needs a paid plan (Plus or above); otherwise \`APP_USERS_PLAN_REQUIRED\` and no email is sent. ${CALLER_NOTE}`,
      successDescription: "The code was sent.",
      inputStructure: "detailed",
      spec: securedOperation,
    })
    .errors({
      ...authErrors,
      APP_LOGIN_DISABLED: {
        status: 403,
        message: "Sign-in is not enabled for this app",
        data: ErrorBodySchema,
      },
      APP_USERS_PLAN_REQUIRED: {
        status: 403,
        message: "App user sign-in requires a paid plan",
        data: PlanRequiredErrorBodySchema,
      },
      INVALID_EMAIL: {
        status: 400,
        message: "That is not a valid email address",
        data: ErrorBodySchema,
      },
      RATE_LIMITED: {
        status: 429,
        message: "Too many codes",
        data: ErrorBodySchema.extend({
          retryAfterSeconds: z.number().int(),
          reason: AppUserRateLimitReasonSchema,
        }),
      },
    })
    .input(SendAppUserCodeRequestSchema)
    .output(SendAppUserCodeResultSchema),
  verify: oc
    .route({
      method: "POST",
      path: "/app-users/verify",
      tags: ["App Users"],
      summary: "Exchange an emailed code for an app user session",
      description: `Creates the app user in the space's pool on first sign-in. The returned \`sessionToken\` is valid for 30 days; store it in an HttpOnly cookie on the app's own domain. ${CALLER_NOTE}`,
      successDescription: "Signed in.",
      spec: securedOperation,
    })
    .errors({
      ...authErrors,
      INVALID_CODE: {
        status: 400,
        message: "Wrong code",
        data: ErrorBodySchema.extend({ attemptsLeft: z.number().int() }),
      },
      CODE_EXPIRED: {
        status: 410,
        message: "The code expired or was used up; send a new one",
        data: ErrorBodySchema,
      },
      APP_USER_DISABLED: {
        status: 403,
        message: "This account was disabled",
        data: ErrorBodySchema,
      },
      APP_LOGIN_DISABLED: {
        status: 403,
        message: "Sign-in is not enabled for this app",
        data: ErrorBodySchema,
      },
      APP_USERS_PLAN_REQUIRED: {
        status: 403,
        message: "App user sign-in requires a paid plan",
        data: PlanRequiredErrorBodySchema,
      },
    })
    .input(VerifyAppUserCodeInputSchema)
    .output(VerifyAppUserCodeResultSchema),
  session: oc
    .route({
      method: "GET",
      path: "/app-users/session",
      tags: ["App Users"],
      summary: "Who is signed in with this app user session",
      description: `${SESSION_NOTE} ${CALLER_NOTE}`,
      successDescription: "The signed-in app user.",
      inputStructure: "detailed",
      spec: securedOperation,
    })
    .errors({ ...authErrors, ...sessionErrors })
    .input(GetAppUserSessionInputSchema)
    .output(AppUserSessionResultSchema),
  signOut: oc
    .route({
      method: "POST",
      path: "/app-users/sign-out",
      tags: ["App Users"],
      summary: "End an app user session",
      description: `Idempotent: an unknown or already-ended session is still \`ok\`. ${SESSION_NOTE}`,
      successDescription: "Signed out.",
      inputStructure: "detailed",
      spec: securedOperation,
    })
    .errors(authErrors)
    .input(SignOutAppUserInputSchema)
    .output(AppUserOkSchema),
  queryRecords: oc
    .route({
      method: "POST",
      path: "/app-users/records/query",
      tags: ["App Users"],
      summary: "List the signed-in app user's own records in one Base",
      description: `The app's server names \`ownerField\` — an App user (\`appUser\`) or text field of that Base holding the owning app user's id — and the platform forces \`ownerField = signed-in user id\`, the id taken from the verified session; no parameter can widen it. Rows whose owner field is empty belong to nobody. A field that does not exist or is neither an App user nor a text field answers 400 \`INVALID_OWNER_FIELD\`. ${SESSION_NOTE}`,
      successDescription: "The user's own records, newest first.",
      inputStructure: "detailed",
      spec: securedOperation,
    })
    .errors({
      ...authErrors,
      ...sessionErrors,
      INVALID_OWNER_FIELD: {
        status: 400,
        message: "ownerField is not an App user or text field of this Base",
        data: ErrorBodySchema,
      },
    })
    .input(QueryAppUserRecordsInputSchema)
    .output(QueryAppUserRecordsResultSchema),
  list: oc
    .route({
      method: "GET",
      path: "/app-users",
      tags: ["App Users"],
      summary: "List the space's app users",
      description: `Filter by exact \`email\` and/or by an app the user has signed in to. ${ADMIN_NOTE} With \`appId\`, \`manage\` on that app is enough.`,
      successDescription: "App users, newest first.",
      spec: securedOperation,
    })
    .errors(authErrors)
    .input(ListAppUsersInputSchema)
    .output(ListAppUsersResultSchema),
  disable: oc
    .route({
      method: "POST",
      path: "/app-users/{id}/disable",
      tags: ["App Users"],
      summary: "Disable an app user and end all their sessions",
      description: ADMIN_NOTE,
      successDescription: "Disabled.",
      spec: securedOperation,
    })
    .errors(authErrors)
    .input(AppUserIdInputSchema)
    .output(AppUserOkSchema),
  enable: oc
    .route({
      method: "POST",
      path: "/app-users/{id}/enable",
      tags: ["App Users"],
      summary: "Re-enable a disabled app user",
      description: ADMIN_NOTE,
      successDescription: "Enabled.",
      spec: securedOperation,
    })
    .errors(authErrors)
    .input(AppUserIdInputSchema)
    .output(AppUserOkSchema),
  delete: oc
    .route({
      method: "DELETE",
      path: "/app-users/{id}",
      tags: ["App Users"],
      summary: "Delete an app user, their codes and sessions",
      description: `Business rows are untouched: an owner field that held this id keeps it as an orphaned value. ${ADMIN_NOTE}`,
      successDescription: "Deleted.",
      spec: securedOperation,
    })
    .errors(authErrors)
    .input(AppUserIdInputSchema)
    .output(AppUserOkSchema),
};
