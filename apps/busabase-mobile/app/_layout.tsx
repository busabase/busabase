import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ConnectionProvider } from "~/connection/connection-store";
import { I18nProvider } from "~/i18n";
// Imported for its side effect: defines the background change-request watch task.
import "~/notifications/background-task";
import { NotificationProvider } from "~/notifications/notification-provider";
import { MobileUpdateGate } from "~/updates/mobile-update-gate";
import { MobileUpdateProvider } from "~/updates/mobile-update-provider";

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function AppStatusBar() {
  // SDK 54+ runs edge-to-edge by default; expo-status-bar dropped the
  // Android-only `backgroundColor` prop, so the bar is transparent.
  return <StatusBar style="auto" />;
}

export default function RootLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <I18nProvider>
            <ConnectionProvider>
              <NotificationProvider>
                <MobileUpdateProvider>
                  <AppStatusBar />
                  {/* Routes are auto-discovered from the app/ tree; every screen hides
                      the native header and renders its own NativeScreen chrome. */}
                  <Stack screenOptions={{ headerShown: false }} />
                  <MobileUpdateGate />
                </MobileUpdateProvider>
              </NotificationProvider>
            </ConnectionProvider>
          </I18nProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
