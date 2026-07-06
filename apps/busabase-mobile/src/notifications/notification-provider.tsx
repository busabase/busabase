import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Linking, Platform } from "react-native";
import { useConnection } from "~/connection/connection-store";
import { registerBackgroundWatch, unregisterBackgroundWatch } from "./background-task";
import {
  checkForNewChangeRequests,
  markChangeRequestSeen,
  NOTIFICATIONS_SUPPORTED,
  primeSeenChangeRequests,
} from "./change-request-watcher";
import {
  defaultNotificationSettings,
  loadNotificationSettings,
  type NotificationSettings,
  saveNotificationSettings,
} from "./notification-settings";

if (NOTIFICATIONS_SUPPORTED) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

interface NotificationContextValue {
  supported: boolean;
  settings: NotificationSettings;
  permissionDenied: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  setPollInterval: (seconds: NotificationSettings["pollIntervalSec"]) => Promise<void>;
  openSystemSettings: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { getCloudAuthorizationHeaders, state } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;
  const connectionMode = state.status === "connected" ? state.connection.mode : null;
  const selectedSpaceId =
    state.status === "connected" ? (state.connection.selectedSpace?.id ?? null) : null;
  const [settings, setSettings] = useState<NotificationSettings>(defaultNotificationSettings);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void loadNotificationSettings().then(setSettings);
    if (Platform.OS === "android") {
      void Notifications.setNotificationChannelAsync("change-requests", {
        name: "Change requests",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
  }, []);

  // Deep link: notification taps (warm and cold start) open the change request.
  useEffect(() => {
    if (!NOTIFICATIONS_SUPPORTED) {
      return;
    }
    const openFromResponse = (response: Notifications.NotificationResponse | null) => {
      const changeRequestId = response?.notification.request.content.data?.changeRequestId;
      if (typeof changeRequestId === "string" && changeRequestId) {
        if (serverUrl) {
          void markChangeRequestSeen(serverUrl, changeRequestId, selectedSpaceId);
        }
        router.push({ pathname: "/change-requests/[id]", params: { id: changeRequestId } });
      }
    };

    void Notifications.getLastNotificationResponseAsync().then(openFromResponse);
    const subscription = Notifications.addNotificationResponseReceivedListener(openFromResponse);
    return () => subscription.remove();
  }, [router, serverUrl, selectedSpaceId]);

  // Foreground polling loop.
  useEffect(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (!NOTIFICATIONS_SUPPORTED || !settings.enabled || !serverUrl) {
      return;
    }

    const poll = () => {
      if (AppState.currentState !== "active") {
        return;
      }
      void Promise.resolve(connectionMode === "cloud" ? getCloudAuthorizationHeaders() : {})
        .then((headers) => checkForNewChangeRequests(serverUrl, headers, selectedSpaceId))
        .catch(() => {
          // Server unreachable — surface nothing; the next poll retries.
        });
    };

    poll();
    pollTimer.current = setInterval(poll, settings.pollIntervalSec * 1000);

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        poll();
      }
    });

    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      appStateSubscription.remove();
    };
  }, [
    settings.enabled,
    settings.pollIntervalSec,
    serverUrl,
    connectionMode,
    selectedSpaceId,
    getCloudAuthorizationHeaders,
  ]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!NOTIFICATIONS_SUPPORTED) {
        return;
      }
      if (enabled) {
        const current = await Notifications.getPermissionsAsync();
        let granted = current.granted;
        if (!granted && current.canAskAgain) {
          const requested = await Notifications.requestPermissionsAsync();
          granted = requested.granted;
        }
        if (!granted) {
          setPermissionDenied(true);
          return;
        }
        setPermissionDenied(false);
        if (serverUrl) {
          // Don't notify about everything that already exists when turning on.
          const headers = connectionMode === "cloud" ? await getCloudAuthorizationHeaders() : {};
          await primeSeenChangeRequests(serverUrl, headers, selectedSpaceId).catch(() => undefined);
        }
        await registerBackgroundWatch();
      } else {
        await unregisterBackgroundWatch();
        await Notifications.setBadgeCountAsync(0).catch(() => undefined);
      }
      const next = { ...settings, enabled };
      setSettings(next);
      await saveNotificationSettings(next);
    },
    [serverUrl, settings, connectionMode, selectedSpaceId, getCloudAuthorizationHeaders],
  );

  const setPollInterval = useCallback(
    async (pollIntervalSec: NotificationSettings["pollIntervalSec"]) => {
      const next = { ...settings, pollIntervalSec };
      setSettings(next);
      await saveNotificationSettings(next);
    },
    [settings],
  );

  const openSystemSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  const value = useMemo(
    () => ({
      supported: NOTIFICATIONS_SUPPORTED,
      settings,
      permissionDenied,
      setEnabled,
      setPollInterval,
      openSystemSettings,
    }),
    [settings, permissionDenied, setEnabled, setPollInterval, openSystemSettings],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used inside NotificationProvider");
  }
  return context;
}
