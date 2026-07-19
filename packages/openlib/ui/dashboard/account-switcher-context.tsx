"use client";

/**
 * Supplies `NavUser` with the account switcher without threading props through
 * every layout.
 *
 * `NavUser` is rendered from `AppSidebar` (via `DashboardLayout`) *and* from
 * each app's own nested sidebar — six-plus call sites per app — so passing the
 * switcher down explicitly would mean touching every one of them and every
 * layout in between. The data is also identical everywhere: it describes the
 * browser session, not the screen.
 *
 * `openlib` must not depend on an auth client, so the app builds the value
 * (`share-domains`' `useAccountSwitcher` returns exactly this shape) and
 * provides it once, near the root of its dashboard tree.
 *
 * Absent provider → `useAccountSwitcherContext()` returns `null` and `NavUser`
 * renders exactly as it did before account switching existed.
 */

import { createContext, type ReactNode, useContext } from "react";
import type { SwitchableAccountView } from "./types";

export interface AccountSwitcherContextValue {
  accounts: SwitchableAccountView[];
  switchingTo: string | null;
  isFull: boolean;
  switchTo: (sessionToken: string) => void;
  /** Revokes only the active account. This is what "Log out" must call. */
  signOutCurrent: () => void;
  /** Revokes every account on this device. */
  signOutAll: () => void;
  onAddAccount: () => void;
}

const AccountSwitcherContext = createContext<AccountSwitcherContextValue | null>(null);

export function AccountSwitcherProvider({
  value,
  children,
}: {
  value: AccountSwitcherContextValue | null;
  children: ReactNode;
}) {
  return (
    <AccountSwitcherContext.Provider value={value}>{children}</AccountSwitcherContext.Provider>
  );
}

/** `null` when no provider is mounted — callers must treat that as "no switcher". */
export function useAccountSwitcherContext(): AccountSwitcherContextValue | null {
  return useContext(AccountSwitcherContext);
}
