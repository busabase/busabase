import {
  APP_USER_IP_HEADER,
  APP_USER_SESSION_HEADER,
  type AppUserRefVO,
  type AppUsersSettingsVO,
  type ListAppUsersInput,
  type ListAppUsersResult,
  type QueryAppUserRecordsResult,
  type SendAppUserCodeResult,
  type VerifyAppUserCodeResult,
} from "busabase-contract/contract/app-users";
import type { BusabaseClient } from "./client.js";

export {
  APP_USER_IP_HEADER,
  APP_USER_SESSION_HEADER,
  APP_USERS_ERROR_CODES,
  type AppUserRecordVO,
  type AppUserRefVO,
  type AppUsersSettingsVO,
  type AppUserVO,
  type QueryAppUserRecordsResult,
  type SendAppUserCodeResult,
  type VerifyAppUserCodeResult,
} from "busabase-contract/contract/app-users";

/** The cookie a site keeps the app user's session token in, unless told otherwise. */
export const DEFAULT_APP_USER_SESSION_COOKIE = "busabase_app_session";

/** 30 days, the server-side session lifetime. */
export const APP_USER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * App users — the end users of an app built on Busabase (a shop's buyers).
 * Every method is meant for the app's SERVER (its Worker): it calls Busabase
 * with the app's API key, and keeps the returned session token in an HttpOnly
 * cookie on its own domain. Never ship the API key to a browser.
 *
 * @example
 * ```ts
 * const bb = new Busabase({ apiKey: env.BUSABASE_API_KEY, spaceId: env.BUSABASE_SPACE_ID });
 * await bb.appUsers.sendCode({
 *   appId,
 *   email,
 *   locale: "de",
 *   ip: request.headers.get("CF-Connecting-IP") ?? undefined,
 * });
 * const { sessionToken, user } = await bb.appUsers.verify({ appId, email, code });
 * // later, on another request:
 * const token = getAppUserSessionToken(request, { cookieName: "busa_shop_session" });
 * const { records } = await bb.appUsers.queryRecords({
 *   appId,
 *   sessionToken: token,
 *   baseId: "orders",
 *   ownerField: "customer-account",
 * });
 * ```
 */
export interface BusabaseAppUsersClient {
  /**
   * Email a 6-digit sign-in code. Throws `APP_LOGIN_DISABLED` / `INVALID_EMAIL` /
   * `RATE_LIMITED` (`data.reason`: `cooldown`, `ip_hourly_limit`,
   * `ip_daily_limit`, `email_daily_limit`, `space_daily_limit`).
   */
  sendCode(input: {
    appId: string;
    email: string;
    /** Language of the email (`en`, `zh-CN`, `de`, …); unsupported → English. */
    locale?: string;
    /**
     * The END USER's IP — on a Worker, `CF-Connecting-IP`, else the first
     * `X-Forwarded-For` hop. Turns on the per-IP limits (5 / hour, 20 / day per
     * app). Busabase keeps only a keyed hash of it. Omit when unknown.
     */
    ip?: string;
  }): Promise<SendAppUserCodeResult>;
  /** Exchange the code for a session. Throws `INVALID_CODE` / `CODE_EXPIRED` / `APP_USER_DISABLED`. */
  verify(input: { appId: string; email: string; code: string }): Promise<VerifyAppUserCodeResult>;
  /** Who the session belongs to. Throws `APP_USER_SESSION_INVALID` (401). */
  session(input: { appId: string; sessionToken: string }): Promise<{ user: AppUserRefVO }>;
  /**
   * The signed-in user, or `null` for a missing / expired / revoked session —
   * the convenient form for "show the account page or the login form".
   */
  getUser(input: {
    appId: string;
    sessionToken: string | null | undefined;
  }): Promise<AppUserRefVO | null>;
  /** End the session. Idempotent. */
  signOut(input: { appId: string; sessionToken: string | null | undefined }): Promise<{ ok: true }>;
  /**
   * The signed-in user's own records in one Base. `ownerField` is the slug of
   * the App user (`appUser`) or text field that holds the owning app user's id — your server chooses
   * it; Busabase fills in the verified session's user id and enforces
   * `ownerField = user id`. Throws `INVALID_OWNER_FIELD` (400) for a missing or
   * field that is neither an App user nor a text field.
   */
  queryRecords(input: {
    appId: string;
    sessionToken: string;
    baseId: string;
    ownerField: string;
    limit?: number;
    cursor?: string;
  }): Promise<QueryAppUserRecordsResult>;
  getSettings(input: { appId: string }): Promise<AppUsersSettingsVO>;
  putSettings(input: {
    appId: string;
    enabled: boolean;
    appName?: string;
  }): Promise<AppUsersSettingsVO>;
  list(input?: ListAppUsersInput): Promise<ListAppUsersResult>;
  disable(input: { id: string }): Promise<{ ok: true }>;
  enable(input: { id: string }): Promise<{ ok: true }>;
  delete(input: { id: string }): Promise<{ ok: true }>;
}

const sessionHeaders = (sessionToken: string | null | undefined) =>
  sessionToken ? { [APP_USER_SESSION_HEADER]: sessionToken } : {};

const isSessionInvalid = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "APP_USER_SESSION_INVALID";

/** Flatten the raw (partly header-carrying) `appUsers` routes into plain calls. */
export function createAppUsersClient(client: BusabaseClient): BusabaseAppUsersClient {
  const raw = client.appUsers;
  const session = (input: { appId: string; sessionToken: string }) =>
    raw.session({ query: { appId: input.appId }, headers: sessionHeaders(input.sessionToken) });
  return {
    sendCode: ({ ip, ...body }) =>
      raw.sendCode({ body, headers: ip ? { [APP_USER_IP_HEADER]: ip } : {} }),
    verify: (input) => raw.verify(input),
    session,
    getUser: async ({ appId, sessionToken }) => {
      if (!sessionToken) return null;
      try {
        return (await session({ appId, sessionToken })).user;
      } catch (error) {
        if (isSessionInvalid(error)) return null;
        throw error;
      }
    },
    signOut: ({ appId, sessionToken }) =>
      raw.signOut({ body: { appId }, headers: sessionHeaders(sessionToken) }),
    queryRecords: ({ sessionToken, ...body }) =>
      raw.queryRecords({ body, headers: sessionHeaders(sessionToken) }),
    getSettings: (input) => raw.getSettings(input),
    putSettings: (input) => raw.putSettings(input),
    list: (input = {}) => raw.list(input),
    disable: (input) => raw.disable(input),
    enable: (input) => raw.enable(input),
    delete: (input) => raw.delete(input),
  };
}

/**
 * Read the app user's session token from a request's `Cookie` header (a Worker
 * `Request`, or anything with `headers.get`). `null` when absent.
 */
export function getAppUserSessionToken(
  request: { headers: { get(name: string): string | null } },
  options: { cookieName?: string } = {},
): string | null {
  const name = options.cookieName ?? DEFAULT_APP_USER_SESSION_COOKIE;
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/**
 * The `Set-Cookie` value that stores a session token: HttpOnly, Secure,
 * SameSite=Lax, Path=/, 30 days. Pass `maxAgeSeconds: 0` with an empty token to
 * clear it (or use {@link clearAppUserSessionCookie}).
 */
export function appUserSessionCookie(
  sessionToken: string,
  options: { cookieName?: string; maxAgeSeconds?: number } = {},
): string {
  const name = options.cookieName ?? DEFAULT_APP_USER_SESSION_COOKIE;
  const maxAge = options.maxAgeSeconds ?? APP_USER_SESSION_MAX_AGE_SECONDS;
  return `${name}=${encodeURIComponent(sessionToken)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

/** The `Set-Cookie` value that deletes the session cookie. */
export function clearAppUserSessionCookie(options: { cookieName?: string } = {}): string {
  return appUserSessionCookie("", { ...options, maxAgeSeconds: 0 });
}
