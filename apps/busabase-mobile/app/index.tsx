import { Redirect, useRouter } from "expo-router";
import { Cloud, Server } from "lucide-react-native";
import { Image, StyleSheet, Text, useColorScheme, View } from "react-native";
import { NativeLoadingState, NativeScreen } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useConnection } from "~/connection/connection-store";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

export default function ConnectionScreen() {
  const router = useRouter();
  const tokens = useTokens();
  const scheme = useColorScheme();
  const { state } = useConnection();
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

  return (
    <NativeScreen title="Busabase" subtitle="Connect to a Busabase workspace">
      <View style={[styles.hero, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
        <Image accessibilityLabel="Busabase logo" source={logoSource} style={styles.logo} />
        <Text style={[typography.display, { color: tokens.foreground }]}>
          Review change requests on the go
        </Text>
        <Text style={[typography.body, { color: tokens.mutedForeground }]}>
          Start with a self-hosted Busabase server. Cloud connection stays visible for the future
          but is disabled in this MVP.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button label="Connect Busabase Cloud" disabled fullWidth />
        <View style={[styles.actionNote, { borderColor: tokens.border }]}>
          <Cloud size={18} color={tokens.mutedForeground} />
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            Cloud auth is planned after the self-hosted review loop is stable.
          </Text>
        </View>

        <Button
          label="Connect Self-hosted Busabase"
          fullWidth
          onPress={() => router.push("/connect/self-hosted")}
        />
        {state.recentServerUrl ? (
          <Button
            label={`Use ${state.recentServerUrl}`}
            variant="secondary"
            fullWidth
            onPress={() =>
              router.push({
                pathname: "/connect/self-hosted",
                params: { serverUrl: state.recentServerUrl },
              })
            }
          />
        ) : null}
        <View style={[styles.actionNote, { borderColor: tokens.border }]}>
          <Server size={18} color={tokens.primary} />
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            Enter your Busabase server URL. The app validates /api/health, then uses /api/v1.
          </Text>
        </View>
      </View>
    </NativeScreen>
  );
}

const styles = StyleSheet.create({
  logo: { width: 44, height: 44 },
  hero: {
    marginHorizontal: 20,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 20,
    gap: 12,
  },
  actions: { marginHorizontal: 20, marginTop: 20, gap: 12 },
  actionNote: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
});
