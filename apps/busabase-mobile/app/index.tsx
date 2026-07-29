import { Redirect, useRouter } from "expo-router";
import { Cloud, Sparkles } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Rect } from "react-native-svg";
import { signInWithBusabaseCloud } from "~/auth/oauth";
import { RotatingHeroHeadline } from "~/components/busabase/RotatingHeroHeadline";
import { NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useConnection } from "~/connection/connection-store";
import { spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useMobileUpdate } from "~/updates/mobile-update-provider";

interface BusabaseMarkProps {
  color: string;
  cutout: string;
  size: number;
}

function BusabaseMark({ color, cutout, size }: BusabaseMarkProps) {
  return (
    <Svg
      accessibilityLabel="Busabase logo"
      accessibilityRole="image"
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
    >
      <Rect x={96} y={96} width={832} height={832} rx={162} fill={color} />
      <Rect x={251} y={251} width={523} height={155} rx={77.5} fill={cutout} />
      <Rect x={251} y={435} width={390} height={155} rx={77.5} fill={cutout} />
      <Rect x={251} y={620} width={523} height={155} rx={77.5} fill={cutout} />
    </Svg>
  );
}

export default function ConnectionScreen() {
  const router = useRouter();
  const tokens = useTokens();
  const { height } = useWindowDimensions();
  const { connectCloud, connectDemo, demoServerUrl, state } = useConnection();
  const { isFeatureEnabled } = useMobileUpdate();
  const [cloudLoading, setCloudLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  if (state.status === "connected") {
    return <Redirect href="/drawer/home" />;
  }

  const handleCloudConnect = async () => {
    setConnectionError(null);
    setCloudLoading(true);
    try {
      const session = await signInWithBusabaseCloud();
      await connectCloud(session);
      router.replace("/drawer/home");
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : "Could not connect Busabase Cloud",
      );
    } finally {
      setCloudLoading(false);
    }
  };

  const handleDemoConnect = async () => {
    setConnectionError(null);
    setDemoLoading(true);
    try {
      await connectDemo();
      router.replace("/drawer/home");
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Could not open the demo");
    } finally {
      setDemoLoading(false);
    }
  };

  const isPreparing = state.status === "loading";
  const cloudEnabled = isFeatureEnabled("cloudLogin");
  const demoEnabled = !!demoServerUrl && isFeatureEnabled("demoServer");
  const actionsDisabled = isPreparing || cloudLoading || demoLoading;
  const isCompact = height < 720;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.cover}>
          <View style={[styles.brandStage, isCompact ? styles.brandStageCompact : null]}>
            <BusabaseMark
              color={tokens.primary}
              cutout={tokens.primaryForeground}
              size={isCompact ? 88 : 112}
            />
            <Text
              style={[
                styles.wordmark,
                isCompact ? styles.wordmarkCompact : null,
                { color: tokens.foreground },
              ]}
            >
              Busabase
            </Text>
            <RotatingHeroHeadline compact={isCompact} />
            <Text style={[typography.body, styles.subtitle, { color: tokens.mutedForeground }]}>
              Turn agent chaos into one database you can actually use.
            </Text>
          </View>

          <View style={styles.actionArea}>
            {cloudEnabled ? (
              <Button
                fullWidth
                label="Continue with Busabase Cloud"
                leadingIcon={<Cloud color={tokens.primaryForeground} size={18} />}
                loading={cloudLoading}
                disabled={actionsDisabled && !cloudLoading}
                onPress={handleCloudConnect}
              />
            ) : null}

            {demoEnabled ? (
              <Button
                fullWidth
                label="Explore demo workspace"
                leadingIcon={<Sparkles color={tokens.foreground} size={18} />}
                loading={demoLoading}
                disabled={actionsDisabled && !demoLoading}
                variant={cloudEnabled ? "secondary" : "primary"}
                onPress={handleDemoConnect}
              />
            ) : null}

            <View style={styles.textActions}>
              <Pressable
                accessibilityRole="button"
                disabled={actionsDisabled}
                style={({ pressed }) => ({ opacity: actionsDisabled ? 0.5 : pressed ? 0.64 : 1 })}
                onPress={() => router.push("/connect/self-hosted")}
              >
                <Text style={[typography.small, styles.textAction, { color: tokens.foreground }]}>
                  Connect self-hosted
                </Text>
              </Pressable>

              {state.recentServerUrl ? (
                <>
                  <Text style={[typography.small, { color: tokens.mutedForeground }]}>·</Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={actionsDisabled}
                    style={({ pressed }) => ({
                      opacity: actionsDisabled ? 0.5 : pressed ? 0.64 : 1,
                    })}
                    onPress={() =>
                      router.push({
                        pathname: "/connect/self-hosted",
                        params: { serverUrl: state.recentServerUrl },
                      })
                    }
                  >
                    <Text
                      style={[typography.small, styles.textAction, { color: tokens.foreground }]}
                    >
                      Recent server
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>

            {isPreparing ? (
              <View style={styles.preparing}>
                <ActivityIndicator color={tokens.mutedForeground} size="small" />
                <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                  Checking saved connection
                </Text>
              </View>
            ) : null}

            {connectionError ? (
              <NativeInlineError
                message={connectionError}
                onReset={() => setConnectionError(null)}
              />
            ) : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  cover: {
    width: "100%",
    maxWidth: 440,
    minHeight: "100%",
    alignSelf: "center",
    flexGrow: 1,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[6],
  },
  brandStage: {
    flexGrow: 1,
    minHeight: 470,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: spacing[8],
    paddingBottom: spacing[8],
  },
  brandStageCompact: { minHeight: 370, paddingTop: spacing[4], paddingBottom: spacing[4] },
  wordmark: {
    marginTop: spacing[5],
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: 0,
  },
  wordmarkCompact: { marginTop: spacing[3], fontSize: 26, lineHeight: 32 },
  subtitle: { marginTop: spacing[3], maxWidth: 310, textAlign: "center" },
  actionArea: { gap: spacing[3] },
  textActions: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
  },
  textAction: { fontWeight: "500", textDecorationLine: "underline" },
  preparing: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
  },
});
