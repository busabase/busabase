import { Redirect, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { validateBusabaseServer } from "~/api/server-health";
import { NativeEmptyState, NativeLoadingState, NativeScreen } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useConnection } from "~/connection/connection-store";

const HEALTH_CHECK_MIN_GAP_MS = 30_000;

export function ConnectionGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { state, disconnect } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;
  const [unreachable, setUnreachable] = useState(false);
  const [checking, setChecking] = useState(false);
  const lastCheckAt = useRef(0);

  const checkHealth = useCallback(
    async (force = false) => {
      if (!serverUrl) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastCheckAt.current < HEALTH_CHECK_MIN_GAP_MS) {
        return;
      }
      lastCheckAt.current = now;
      setChecking(true);
      try {
        await validateBusabaseServer(serverUrl);
        setUnreachable(false);
      } catch {
        setUnreachable(true);
      } finally {
        setChecking(false);
      }
    },
    [serverUrl],
  );

  useEffect(() => {
    void checkHealth(true);
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void checkHealth();
      }
    });
    return () => subscription.remove();
  }, [checkHealth]);

  if (state.status === "loading") {
    return (
      <NativeScreen title="Busabase" subtitle="Loading connection">
        <NativeLoadingState label="Checking saved connection" />
      </NativeScreen>
    );
  }

  if (state.status === "disconnected") {
    return <Redirect href="/" />;
  }

  if (unreachable) {
    return (
      <NativeScreen title="Busabase" subtitle={state.connection.serverUrl}>
        <NativeEmptyState
          title="Server unreachable"
          description="The connected Busabase server is not responding. Check that it is running and reachable from this device."
        />
        <View style={styles.actions}>
          <Button
            label={checking ? "Retrying..." : "Retry"}
            loading={checking}
            fullWidth
            onPress={() => void checkHealth(true)}
          />
          <Button
            label="Connect to a different server"
            variant="secondary"
            fullWidth
            onPress={async () => {
              await disconnect();
              router.replace("/");
            }}
          />
        </View>
      </NativeScreen>
    );
  }

  return children;
}

const styles = StyleSheet.create({
  actions: { marginHorizontal: 20, marginTop: 16, gap: 10 },
});
