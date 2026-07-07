import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, CheckCircle, Server, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { validateBusabaseServer } from "~/api/server-health";
import {
  NativeActionBar,
  NativeChipList,
  NativeInlineError,
  NativeRow,
  NativeScreen,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { useConnection } from "~/connection/connection-store";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const urlExamples = ["http://localhost:15419", "http://10.0.2.2:15419"];

export default function SelfHostedConnectionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ serverUrl?: string }>();
  const tokens = useTokens();
  const { connectSelfHosted, connectDemo, demoServerUrl, state } = useConnection();
  const initialServerUrl = typeof params.serverUrl === "string" ? params.serverUrl : urlExamples[0];
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [validatedUrl, setValidatedUrl] = useState<string | null>(null);
  const serverOptions = [...new Set([...state.serverHistory, ...urlExamples])].map((example) => ({
    value: example,
    label: example,
  }));

  // One tap into the preset hosted demo — no server setup, no login. This is what
  // App Review uses; new users can try Busabase instantly.
  const handleDemo = async () => {
    setError(null);
    setValidatedUrl(null);
    setDemoLoading(true);
    try {
      if (demoServerUrl) {
        await validateBusabaseServer(demoServerUrl);
      }
      await connectDemo();
      router.replace("/drawer/inbox");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect to the demo server");
    } finally {
      setDemoLoading(false);
    }
  };

  const handleConnect = async () => {
    setError(null);
    setValidatedUrl(null);
    setLoading(true);

    try {
      const result = await validateBusabaseServer(serverUrl);
      await connectSelfHosted(result.serverUrl);
      setValidatedUrl(result.serverUrl);
      router.replace("/drawer/inbox");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not connect to this Busabase server",
      );
    } finally {
      setLoading(false);
    }
  };

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={() => router.back()}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  return (
    <NativeScreen
      title="Connect to Busabase"
      subtitle="Try the demo, or connect your own server"
      headerLeading={headerLeading}
      footer={
        <NativeActionBar>
          {error ? <NativeInlineError message={error} onReset={() => setError(null)} /> : null}
          <Button
            label="Connect"
            loading={loading}
            disabled={serverUrl.trim().length === 0}
            fullWidth
            onPress={handleConnect}
          />
        </NativeActionBar>
      }
    >
      {demoServerUrl ? (
        <NativeSection title="Demo">
          <NativeRow
            title="Try the demo workspace"
            subtitle="No server setup or login. Explore seeded review flows."
            leading={<Sparkles size={18} color={tokens.mutedForeground} />}
            trailing={
              <Button
                label="Try demo"
                loading={demoLoading}
                variant="secondary"
                onPress={handleDemo}
              />
            }
            last
          />
        </NativeSection>
      ) : null}

      <NativeSection title="Server" caption="/api/health">
        <View style={styles.formRow}>
          <View style={styles.formHeader}>
            <Server size={18} color={tokens.mutedForeground} />
            <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
              Busabase server URL
            </Text>
          </View>
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            The app validates the server before saving it on this device.
          </Text>

          <TextInput
            value={serverUrl}
            keyboardType="url"
            returnKeyType="go"
            autoComplete="url"
            onChangeText={setServerUrl}
            onSubmitEditing={handleConnect}
          />

          <View style={styles.fullBleedChips}>
            <NativeChipList<string>
              value={serverUrl}
              options={serverOptions}
              onChange={setServerUrl}
            />
          </View>

          {validatedUrl ? (
            <View style={styles.validated}>
              <CheckCircle size={16} color={tokens.success} />
              <Text style={[typography.small, { color: tokens.success }]}>
                Connected to {validatedUrl}
              </Text>
            </View>
          ) : null}
        </View>
      </NativeSection>
    </NativeScreen>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  formRow: { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  formHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  fullBleedChips: { marginHorizontal: -14 },
  validated: { flexDirection: "row", alignItems: "center", gap: 8 },
});
