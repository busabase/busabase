import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => mocks.values.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    mocks.values.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    mocks.values.delete(key);
  }),
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import {
  addCloudSession,
  CloudAccountLimitError,
  type CloudSession,
  getCloudAccounts,
  getCloudSession,
  MAX_CLOUD_ACCOUNTS,
  removeCloudAccount,
  setCloudSession,
  switchCloudAccount,
} from "./session-store";

const session = (id: string, tokenVersion = "1"): CloudSession => ({
  accessToken: `bso_${id}_${tokenVersion}`,
  refreshToken: `bsr_${id}_${tokenVersion}`,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  user: {
    id,
    email: `${id}@example.com`,
    name: `User ${id}`,
    image: null,
  },
});

describe("cloud session account storage", () => {
  beforeEach(() => {
    mocks.values.clear();
  });

  it("migrates the legacy single-session payload when it is read", async () => {
    const legacy = session("legacy-user");
    mocks.values.set("busabase-mobile.cloud-session.v1", JSON.stringify(legacy));

    await expect(getCloudSession()).resolves.toEqual(legacy);
    await expect(getCloudAccounts()).resolves.toEqual([
      { id: "legacy-user", isActive: true, session: legacy },
    ]);
  });

  it("keeps multiple accounts and switches the active bearer session", async () => {
    const first = session("first");
    const second = session("second");
    await addCloudSession(first);
    await addCloudSession(second);

    await expect(getCloudSession()).resolves.toEqual(second);
    await expect(switchCloudAccount("first")).resolves.toEqual(first);
    await expect(getCloudSession()).resolves.toEqual(first);
    expect((await getCloudAccounts()).find(({ id }) => id === "first")?.isActive).toBe(true);
  });

  it("updates a refreshed active session without replacing another account", async () => {
    await addCloudSession(session("first"));
    await addCloudSession(session("second"));
    const refreshed = session("second", "2");

    await setCloudSession(refreshed);

    const accounts = await getCloudAccounts();
    expect(accounts).toHaveLength(2);
    expect(accounts.find(({ id }) => id === "first")?.session.accessToken).toBe("bso_first_1");
    expect(accounts.find(({ id }) => id === "second")?.session).toEqual(refreshed);
  });

  it("falls back to another saved account when the active account is removed", async () => {
    const first = session("first");
    const second = session("second");
    await addCloudSession(first);
    await addCloudSession(second);

    await expect(removeCloudAccount("second")).resolves.toEqual({ removed: second, active: first });
    await expect(getCloudSession()).resolves.toEqual(first);
  });

  it("rejects a sixth distinct account without dropping saved sessions", async () => {
    for (let index = 0; index < MAX_CLOUD_ACCOUNTS; index += 1) {
      await addCloudSession(session(`user-${index}`));
    }

    await expect(addCloudSession(session("overflow"))).rejects.toBeInstanceOf(
      CloudAccountLimitError,
    );
    await expect(getCloudAccounts()).resolves.toHaveLength(MAX_CLOUD_ACCOUNTS);
  });
});
