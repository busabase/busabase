import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import {
  fetchMobileUpdateManifest,
  getCurrentMobileVersion,
  isMobileFeatureEnabled,
  type MobileFeatureKey,
  type MobileUpdateDecision,
  resolveMobileUpdateDecision,
} from "./mobile-update-policy";

interface MobileUpdateContextValue {
  checking: boolean;
  error: string | null;
  decision: MobileUpdateDecision | null;
  checkForUpdates: (options?: { manual?: boolean }) => Promise<MobileUpdateDecision | null>;
  dismissOptionalUpdate: () => Promise<void>;
  isFeatureEnabled: (feature: MobileFeatureKey) => boolean;
}

const MobileUpdateContext = createContext<MobileUpdateContextValue | null>(null);

const dismissedVersionKey = "busabase.mobileUpdate.dismissedVersion";

export function MobileUpdateProvider({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<MobileUpdateDecision | null>(null);

  const checkForUpdates = useCallback(async (options?: { manual?: boolean }) => {
    setChecking(true);
    setError(null);
    try {
      const manifest = await fetchMobileUpdateManifest();
      const nextDecision = resolveMobileUpdateDecision(manifest, getCurrentMobileVersion());
      const dismissedVersion = await AsyncStorage.getItem(dismissedVersionKey);
      const shouldHideOptional =
        !options?.manual &&
        nextDecision.action === "optional" &&
        !!nextDecision.latestVersion &&
        dismissedVersion === nextDecision.latestVersion;

      setDecision(shouldHideOptional ? { ...nextDecision, action: "none" } : nextDecision);
      return nextDecision;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not check for updates.";
      setError(message);
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  const dismissOptionalUpdate = useCallback(async () => {
    if (decision?.latestVersion) {
      await AsyncStorage.setItem(dismissedVersionKey, decision.latestVersion);
    }
    setDecision((current) => (current ? { ...current, action: "none" } : current));
  }, [decision]);

  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  return (
    <MobileUpdateContext.Provider
      value={{
        checking,
        error,
        decision,
        checkForUpdates,
        dismissOptionalUpdate,
        isFeatureEnabled: (feature) => isMobileFeatureEnabled(decision, feature),
      }}
    >
      {children}
    </MobileUpdateContext.Provider>
  );
}

export function useMobileUpdate() {
  const value = useContext(MobileUpdateContext);
  if (!value) {
    throw new Error("useMobileUpdate must be used inside MobileUpdateProvider");
  }
  return value;
}
