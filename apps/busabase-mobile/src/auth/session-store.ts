import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SESSION_KEY = "busabase-mobile.cloud-session.v1";
export const MAX_CLOUD_ACCOUNTS = 5;

export interface CloudUserProfile {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user?: CloudUserProfile;
}

interface StoredCloudAccount {
  id: string;
  session: CloudSession;
}

interface CloudSessionSnapshot {
  version: 2;
  activeAccountId: string;
  accounts: StoredCloudAccount[];
}

export interface CloudAccount {
  id: string;
  isActive: boolean;
  session: CloudSession;
}

export class CloudAccountLimitError extends Error {
  constructor() {
    super(`You can save up to ${MAX_CLOUD_ACCOUNTS} Busabase Cloud accounts on this device.`);
    this.name = "CloudAccountLimitError";
  }
}

const storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      return window.localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async deleteItem(key: string): Promise<void> {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

const isCloudUserProfile = (value: unknown): value is CloudUserProfile => {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<CloudUserProfile>;
  return (
    typeof user.id === "string" &&
    typeof user.email === "string" &&
    typeof user.name === "string" &&
    (typeof user.image === "string" || user.image === null)
  );
};

const isCloudSession = (value: unknown): value is CloudSession => {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<CloudSession>;
  return (
    typeof session.accessToken === "string" &&
    session.accessToken.startsWith("bso_") &&
    typeof session.refreshToken === "string" &&
    session.refreshToken.startsWith("bsr_") &&
    typeof session.expiresAt === "string" &&
    !Number.isNaN(Date.parse(session.expiresAt)) &&
    (session.user === undefined || isCloudUserProfile(session.user))
  );
};

const accountIdForSession = (session: CloudSession) => session.user?.id ?? "legacy";

const parseSnapshot = (raw: string | null): CloudSessionSnapshot | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isCloudSession(parsed)) {
      const id = accountIdForSession(parsed);
      return { version: 2, activeAccountId: id, accounts: [{ id, session: parsed }] };
    }
    if (!parsed || typeof parsed !== "object") return null;
    const snapshot = parsed as Partial<CloudSessionSnapshot>;
    if (
      snapshot.version !== 2 ||
      typeof snapshot.activeAccountId !== "string" ||
      !Array.isArray(snapshot.accounts)
    ) {
      return null;
    }
    const accounts = snapshot.accounts.filter(
      (account): account is StoredCloudAccount =>
        !!account &&
        typeof account === "object" &&
        typeof (account as Partial<StoredCloudAccount>).id === "string" &&
        isCloudSession((account as Partial<StoredCloudAccount>).session),
    );
    if (accounts.length === 0 || !accounts.some(({ id }) => id === snapshot.activeAccountId)) {
      return null;
    }
    return { version: 2, activeAccountId: snapshot.activeAccountId, accounts };
  } catch {
    return null;
  }
};

const readSnapshot = async (): Promise<CloudSessionSnapshot | null> => {
  const raw = await storage.getItem(SESSION_KEY);
  const snapshot = parseSnapshot(raw);
  if (raw && !snapshot) await storage.deleteItem(SESSION_KEY);
  return snapshot;
};

const writeSnapshot = (snapshot: CloudSessionSnapshot) =>
  storage.setItem(SESSION_KEY, JSON.stringify(snapshot));

export const isCloudSessionAccessTokenUsable = (
  session: CloudSession | null | undefined,
  minimumValidityMs = 0,
): boolean => {
  if (!session?.accessToken) return false;
  const expiresAt = Date.parse(session.expiresAt);
  return !Number.isNaN(expiresAt) && expiresAt - Date.now() > minimumValidityMs;
};

export async function getCloudSession(): Promise<CloudSession | null> {
  const snapshot = await readSnapshot();
  return snapshot?.accounts.find(({ id }) => id === snapshot.activeAccountId)?.session ?? null;
}

export async function getCloudAccounts(): Promise<CloudAccount[]> {
  const snapshot = await readSnapshot();
  return (
    snapshot?.accounts.map(({ id, session }) => ({
      id,
      session,
      isActive: id === snapshot.activeAccountId,
    })) ?? []
  );
}

export async function addCloudSession(session: CloudSession): Promise<CloudSession | null> {
  const snapshot = await readSnapshot();
  const id = accountIdForSession(session);
  const accounts = snapshot?.accounts ?? [];
  const existing = accounts.find(({ id: accountId }) => accountId === id);
  if (!existing && accounts.length >= MAX_CLOUD_ACCOUNTS) throw new CloudAccountLimitError();
  const nextAccounts = existing
    ? accounts.map((account) => (account.id === id ? { id, session } : account))
    : [...accounts, { id, session }];
  await writeSnapshot({ version: 2, activeAccountId: id, accounts: nextAccounts });
  return existing?.session ?? null;
}

export async function setCloudSession(session: CloudSession): Promise<void> {
  const snapshot = await readSnapshot();
  if (!snapshot) {
    await addCloudSession(session);
    return;
  }
  const id = accountIdForSession(session);
  const nextAccounts = snapshot.accounts
    .filter((account) => account.id !== id || account.id === snapshot.activeAccountId)
    .map((account) => (account.id === snapshot.activeAccountId ? { id, session } : account));
  await writeSnapshot({ version: 2, activeAccountId: id, accounts: nextAccounts });
}

export async function switchCloudAccount(accountId: string): Promise<CloudSession | null> {
  const snapshot = await readSnapshot();
  const account = snapshot?.accounts.find(({ id }) => id === accountId);
  if (!snapshot || !account) return null;
  await writeSnapshot({ ...snapshot, activeAccountId: accountId });
  return account.session;
}

export async function removeCloudAccount(accountId: string): Promise<{
  removed: CloudSession | null;
  active: CloudSession | null;
}> {
  const snapshot = await readSnapshot();
  const removed = snapshot?.accounts.find(({ id }) => id === accountId)?.session ?? null;
  if (!snapshot || !removed) return { removed: null, active: await getCloudSession() };
  const accounts = snapshot.accounts.filter(({ id }) => id !== accountId);
  if (accounts.length === 0) {
    await storage.deleteItem(SESSION_KEY);
    return { removed, active: null };
  }
  const activeAccountId =
    snapshot.activeAccountId === accountId ? (accounts[0]?.id ?? "") : snapshot.activeAccountId;
  await writeSnapshot({ version: 2, activeAccountId, accounts });
  return {
    removed,
    active: accounts.find(({ id }) => id === activeAccountId)?.session ?? null,
  };
}

export async function clearCloudSession(): Promise<void> {
  await storage.deleteItem(SESSION_KEY);
}

export function getCloudSessionToken(session: CloudSession | null | undefined): string | null {
  return session?.accessToken ?? null;
}
