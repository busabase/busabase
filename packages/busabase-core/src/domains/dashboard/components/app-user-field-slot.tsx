"use client";

// The seam that lets an `appUser` cell show a PERSON without busabase-core
// knowing anything about app users.
//
// App users (the end users who sign in to a space's apps — a shop's buyers)
// exist only in Busabase Cloud; busabase-core also ships in the open-source,
// single-user `apps/busabase`, which has no app-user pool. So the core field
// stores and filters the id like text, and a host that HAS app users injects
// how to look them up — the same "host injects, core consumes" pattern as
// `node-settings-app-sign-in-slot.tsx`. Without a provider `useContext`
// resolves to `null`: the cell shows the raw id (with a "Busabase Cloud" hint)
// and the editor is a plain id input.
import { createContext } from "react";

export type AppUserFieldUserStatus = "active" | "disabled";

/** One app user as an `appUser` cell shows them. */
export interface AppUserFieldUser {
  id: string;
  email: string;
  status: AppUserFieldUserStatus;
  /** ISO timestamp; null if they never finished signing in. */
  lastSignInAt: string | null;
  /** The apps they signed in to that still exist, named for people. */
  apps: ReadonlyArray<{ id: string; name: string }>;
}

export interface AppUserFieldSearchResult {
  users: AppUserFieldUser[];
  /**
   * May this viewer pick an app user at all? Listing the pool is a space-admin
   * power, so everyone else can keep or clear a value but not choose one.
   */
  canPick: boolean;
}

export interface AppUserFieldHost {
  /**
   * Cache namespace — the active space. Hosts share one QueryClient across
   * spaces, and an id from one space must never answer for another.
   */
  scope: string;
  /**
   * ids → people, in ONE call per Base for every cell on screen (the loader
   * batches). `baseId` is the Base whose rows hold the ids: the host checks the
   * viewer can read it. Ids it does not return are deleted (or never existed).
   */
  resolve: (baseId: string, ids: string[]) => Promise<AppUserFieldUser[]>;
  /** The picker: app users whose email contains `query` (newest first). */
  search: (query: string) => Promise<AppUserFieldSearchResult>;
  /** Open Space settings → App users, optionally filtered to one app. */
  openManage: (options?: { appId?: string }) => void;
}

const AppUserFieldHostContext = createContext<AppUserFieldHost | null>(null);

/** Hosts must pass a STABLE value (memoize it): the batch loader is keyed by it. */
export const AppUserFieldHostProvider = AppUserFieldHostContext.Provider;
export { AppUserFieldHostContext };
