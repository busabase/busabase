import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SESSION_KEY = "busabase-mobile.cloud-session.v1";

export interface CloudSession {
  accessToken: string;
  token?: string;
  expiresAt?: string;
  user?: {
    id?: string;
    email?: string;
    name?: string;
    image?: string | null;
  };
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

const isUsableSession = (session: CloudSession | null | undefined): session is CloudSession => {
  if (!session?.accessToken) return false;
  if (!session.expiresAt) return true;
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isNaN(expiresAt) || expiresAt > Date.now();
};

export async function getCloudSession(): Promise<CloudSession | null> {
  const raw = await storage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CloudSession;
    if (isUsableSession(parsed)) return parsed;
  } catch {
    // Ignore corrupt session snapshots and clear them below.
  }
  await clearCloudSession();
  return null;
}

export async function setCloudSession(session: CloudSession): Promise<void> {
  await storage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function clearCloudSession(): Promise<void> {
  await storage.deleteItem(SESSION_KEY);
}

export function getCloudSessionToken(session: CloudSession | null | undefined): string | null {
  return session?.accessToken ?? session?.token ?? null;
}
