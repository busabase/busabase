import { readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  busabaseAirAppCredentialPath,
  clearBusabaseAirAppOAuthCredential,
  getBusabaseAirAppAccessToken,
  loadBusabaseAirAppOAuthCredential,
  revokeBusabaseAirAppOAuthCredential,
  storeBusabaseAirAppOAuthCredential,
} from "./oauth-node.js";

const APP_ID = "kelly-invest-stock";
let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "busabase-airapp-oauth-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

const tokenSet = (expiresAt = new Date(Date.now() + 3_600_000).toISOString()) => ({
  accessToken: "bso_access",
  refreshToken: "bsr_refresh",
  expiresIn: 3600,
  expiresAt,
  scope: ["api"],
  tokenType: "Bearer",
});

describe("local AirApp OAuth credentials", () => {
  it("registers one owner-only file per AirApp under the Busabase root", () => {
    const stored = storeBusabaseAirAppOAuthCredential(
      { appId: APP_ID, baseUrl: "https://busabase.com/api/v1", tokenSet: tokenSet() },
      { rootDir },
    );
    const path = busabaseAirAppCredentialPath(APP_ID, { rootDir });
    expect(path).toBe(join(rootDir, "airapps", `${APP_ID}.json`));
    expect(loadBusabaseAirAppOAuthCredential(APP_ID, { rootDir })).toEqual(stored);
    expect(readFileSync(path, "utf8")).toContain('"refreshToken": "bsr_refresh"');
    if (process.platform !== "win32") {
      expect(statSync(join(rootDir, "airapps")).mode & 0o777).toBe(0o700);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  it("refreshes an expiring token and persists the rotation", async () => {
    storeBusabaseAirAppOAuthCredential(
      {
        appId: APP_ID,
        baseUrl: "https://busabase.com",
        tokenSet: tokenSet(new Date(Date.now() - 1_000).toISOString()),
      },
      { rootDir },
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "bso_rotated",
            refresh_token: "bsr_rotated",
            expires_in: 3600,
            scope: "api",
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const refreshed = await getBusabaseAirAppAccessToken(
      APP_ID,
      { rootDir },
      fetchMock as unknown as typeof fetch,
    );
    expect(refreshed).toMatchObject({
      accessToken: "bso_rotated",
      refreshToken: "bsr_rotated",
    });
    expect(loadBusabaseAirAppOAuthCredential(APP_ID, { rootDir })).toMatchObject({
      accessToken: "bso_rotated",
      refreshToken: "bsr_rotated",
    });
  });

  it("shares one refresh across concurrent requests for the same AirApp", async () => {
    storeBusabaseAirAppOAuthCredential(
      {
        appId: APP_ID,
        baseUrl: "https://busabase.com",
        tokenSet: tokenSet(new Date(Date.now() - 1_000).toISOString()),
      },
      { rootDir },
    );
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(
        JSON.stringify({
          access_token: "bso_rotated",
          refresh_token: "bsr_rotated",
          expires_in: 3600,
          scope: "api",
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const [first, second] = await Promise.all([
      getBusabaseAirAppAccessToken(APP_ID, { rootDir }, fetchMock as unknown as typeof fetch),
      getBusabaseAirAppAccessToken(APP_ID, { rootDir }, fetchMock as unknown as typeof fetch),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      accessToken: "bso_rotated",
      refreshToken: "bsr_rotated",
    });
  });

  it("revokes the refresh token before removing the local registration", async () => {
    storeBusabaseAirAppOAuthCredential(
      { appId: APP_ID, baseUrl: "https://busabase.com", tokenSet: tokenSet() },
      { rootDir },
    );
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }),
    );
    await revokeBusabaseAirAppOAuthCredential(
      APP_ID,
      { rootDir },
      fetchMock as unknown as typeof fetch,
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("token=bsr_refresh");
    expect(loadBusabaseAirAppOAuthCredential(APP_ID, { rootDir })).toBeNull();
  });

  it("rejects path-like ids and can clear a missing registration", () => {
    expect(() => busabaseAirAppCredentialPath("../other", { rootDir })).toThrow(
      "AirApp id must use",
    );
    expect(() => clearBusabaseAirAppOAuthCredential(APP_ID, { rootDir })).not.toThrow();
  });
});
