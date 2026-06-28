import AsyncStorage from "@react-native-async-storage/async-storage";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { checkForNewChangeRequests, NOTIFICATIONS_SUPPORTED } from "./change-request-watcher";
import { loadNotificationSettings } from "./notification-settings";

export const CHANGE_REQUEST_TASK = "busabase-change-request-watch";

const CONNECTION_KEY = "busabase-mobile.connection.v1";

async function getActiveServerUrl(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(CONNECTION_KEY);
    if (!raw) {
      return null;
    }
    const connection = JSON.parse(raw) as { serverUrl?: string };
    return connection.serverUrl ?? null;
  } catch {
    return null;
  }
}

// Module scope so the task is defined when the app launches in the background.
// expo-task-manager is not available on web, so skip registration there.
if (NOTIFICATIONS_SUPPORTED) {
  TaskManager.defineTask(CHANGE_REQUEST_TASK, async () => {
    try {
      const [settings, serverUrl] = await Promise.all([
        loadNotificationSettings(),
        getActiveServerUrl(),
      ]);
      if (!settings.enabled || !serverUrl) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      await checkForNewChangeRequests(serverUrl);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** OS schedulers treat the interval as a minimum; expect ~15 min or longer in practice. */
export async function registerBackgroundWatch(): Promise<void> {
  if (!NOTIFICATIONS_SUPPORTED) {
    return;
  }
  try {
    await BackgroundTask.registerTaskAsync(CHANGE_REQUEST_TASK, { minimumInterval: 15 });
  } catch {
    // Background tasks are unavailable in Expo Go and on some simulators.
  }
}

export async function unregisterBackgroundWatch(): Promise<void> {
  if (!NOTIFICATIONS_SUPPORTED) {
    return;
  }
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(CHANGE_REQUEST_TASK);
    if (registered) {
      await BackgroundTask.unregisterTaskAsync(CHANGE_REQUEST_TASK);
    }
  } catch {
    // Ignore — task was never registered in this environment.
  }
}
