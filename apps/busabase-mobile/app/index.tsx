import { Redirect, useRouter } from "expo-router";
import { Cloud, Server, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { Image, StyleSheet, Text, useColorScheme, View } from "react-native";
import { signInWithBusabaseCloud } from "~/auth/oauth";
import {
  NativeActionBar,
  NativeInlineError,
  NativeLoadingState,
  NativeRow,
  NativeScreen,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useConnection } from "~/connection/connection-store";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useMobileUpdate } from "~/updates/mobile-update-provider";

export default function ConnectionScreen() {
  const router = useRouter();
  const tokens = useTokens();
  const scheme = useColorScheme();
  const { connectCloud, state } = useConnection();
  const { isFeatureEnabled } = useMobileUpdate();
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const logoSource =
    scheme === "dark"
      ? require("../assets/splash-icon-dark.png")
      : require("../assets/splash-icon.png");

  if (state.status === "loading") {
    return (
      <NativeScreen title="Busabase" subtitle="Preparing connection state">
        <NativeLoadingState label="Checking saved connection" />
      </NativeScreen>
    );
  }

  if (state.status === "connected") {
    return <Redirect href="/drawer/inbox" />;
  }

  const handleCloudConnect = async () => {
    setCloudError(null);
    setCloudLoading(true);
    try {
      const session = await signInWithBusabaseCloud();
      await connectCloud(session);
      router.replace("/drawer/inbox");
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : "Could not connect Busabase Cloud");
    } finally {
      setCloudLoading(false);
    }
  };

  const footer = cloudError ? (
    <NativeActionBar>
      <NativeInlineError message={cloudError} onReset={() => setCloudError(null)} />
    </NativeActionBar>
  ) : undefined;
  const cloudEnabled = isFeatureEnabled("cloudLogin");

  return (
    <NativeScreen title="Busabase" subtitle="Connect to a workspace" footer={footer}>
      <View style={styles.brand}>
        <Image accessibilityLabel="Busabase logo" source={logoSource} style={styles.logo} />
        <View style={styles.brandText}>
          <Text style={[typography.h1, { color: tokens.foreground }]}>
            Review changes from your phone
          </Text>
          <Text style={[typography.body, { color: tokens.mutedForeground }]}>
            Choose a hosted workspace, a self-hosted server, or the demo.
          </Text>
        </View>
      </View>

      <NativeSection title="Workspace">
        {cloudEnabled ? (
          <NativeRow
            title="Busabase Cloud"
            subtitle="Sign in with busabase.com and return to this app."
            leading={<Cloud size={18} color={tokens.mutedForeground} />}
            trailing={
              <Button
                label="Sign in"
                loading={cloudLoading}
                variant="secondary"
                onPress={handleCloudConnect}
              />
            }
          />
        ) : null}
        <NativeRow
          title="Self-hosted server"
          subtitle="Enter a Busabase server URL and validate /api/health."
          leading={<Server size={18} color={tokens.mutedForeground} />}
          onPress={() => router.push("/connect/self-hosted")}
          last={!state.recentServerUrl}
        />
        {state.recentServerUrl ? (
          <NativeRow
            title="Recent server"
            subtitle={state.recentServerUrl}
            leading={<Sparkles size={18} color={tokens.mutedForeground} />}
            onPress={() =>
              router.push({
                pathname: "/connect/self-hosted",
                params: { serverUrl: state.recentServerUrl },
              })
            }
            last
          />
        ) : null}
      </NativeSection>
    </NativeScreen>
  );
}

const styles = StyleSheet.create({
  logo: { width: 44, height: 44 },
  brand: {
    marginHorizontal: 20,
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brandText: { flex: 1, minWidth: 0, gap: 4 },
});
