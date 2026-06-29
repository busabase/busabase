import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, CheckCircle, Server, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { validateBusabaseServer } from "~/api/server-health";
import { NativeScreen } from "~/components/native-screen";
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
    >
      {demoServerUrl ? (
        <View
          style={[
            styles.card,
            { backgroundColor: tokens.primaryMuted, borderColor: tokens.primary },
          ]}
        >
          <Sparkles size={22} color={tokens.primary} />
          <Text style={[typography.h2, { color: tokens.foreground }]}>Try the demo</Text>
          <Text style={[typography.body, { color: tokens.mutedForeground }]}>
            One tap — no server setup, no login. Explore a seeded Busabase workspace and the full
            review → merge flow.
          </Text>
          <Button label="Try the demo" loading={demoLoading} fullWidth onPress={handleDemo} />
        </View>
      ) : null}

      <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
        <Server size={22} color={tokens.primary} />
        <Text style={[typography.h2, { color: tokens.foreground }]}>Server URL</Text>
        <Text style={[typography.body, { color: tokens.mutedForeground }]}>
          The app checks /api/health before saving the connection.
        </Text>

        <TextInput
          label="Busabase server URL"
          value={serverUrl}
          error={error ?? undefined}
          keyboardType="url"
          returnKeyType="go"
          autoComplete="url"
          onChangeText={setServerUrl}
          onSubmitEditing={handleConnect}
        />

        <View style={styles.examples}>
          {[...new Set([...state.serverHistory, ...urlExamples])].map((example) => (
            <Pressable
              key={example}
              style={[styles.example, { backgroundColor: tokens.primaryMuted }]}
              onPress={() => setServerUrl(example)}
            >
              <Text style={[typography.small, { color: tokens.foreground }]}>{example}</Text>
            </Pressable>
          ))}
        </View>

        {validatedUrl ? (
          <View style={styles.validated}>
            <CheckCircle size={16} color={tokens.success} />
            <Text style={[typography.small, { color: tokens.success }]}>
              Connected to {validatedUrl}
            </Text>
          </View>
        ) : null}

        <Button label="Connect" loading={loading} fullWidth onPress={handleConnect} />
      </View>
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
  card: {
    marginHorizontal: 20,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 18,
    gap: 14,
  },
  examples: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  example: { borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 8 },
  validated: { flexDirection: "row", alignItems: "center", gap: 8 },
});
