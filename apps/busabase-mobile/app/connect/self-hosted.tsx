import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Check, CheckCircle, ChevronDown, Server, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { validateBusabaseServer } from "~/api/server-health";
import {
  NativeActionBar,
  NativeBottomSheet,
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
import { useMobileUpdate } from "~/updates/mobile-update-provider";

const urlExamples = ["http://localhost:15419", "http://10.0.2.2:15419"];

export default function SelfHostedConnectionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ serverUrl?: string }>();
  const tokens = useTokens();
  const { connectSelfHosted, connectDemo, demoServerUrl, state } = useConnection();
  const { isFeatureEnabled } = useMobileUpdate();
  const initialServerUrl = typeof params.serverUrl === "string" ? params.serverUrl : urlExamples[0];
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [validatedUrl, setValidatedUrl] = useState<string | null>(null);
  const [serverPickerOpen, setServerPickerOpen] = useState(false);
  const serverOptions = [...new Set([...state.serverHistory, ...urlExamples])];

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
      router.replace("/drawer/home");
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
      router.replace("/drawer/home");
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
      {demoServerUrl && isFeatureEnabled("demoServer") ? (
        <NativeSection title="Demo">
          <NativeRow
            title="Try the demo workspace"
            subtitle="No setup or sign-in."
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

      <NativeSection title="Server">
        <View style={styles.formRow}>
          <View style={styles.formHeader}>
            <Server size={18} color={tokens.mutedForeground} />
            <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
              Busabase server URL
            </Text>
          </View>
          <TextInput
            accessibilityLabel="Busabase server URL"
            value={serverUrl}
            keyboardType="url"
            returnKeyType="go"
            autoComplete="url"
            onChangeText={setServerUrl}
            onSubmitEditing={handleConnect}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose a saved server"
            accessibilityState={{ expanded: serverPickerOpen }}
            style={({ pressed }) => [
              styles.serverPickerTrigger,
              {
                backgroundColor: tokens.surface,
                borderColor: tokens.border,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
            onPress={() => setServerPickerOpen(true)}
          >
            <Text style={[typography.body, styles.serverPickerLabel, { color: tokens.foreground }]}>
              Saved servers
            </Text>
            <ChevronDown size={18} color={tokens.mutedForeground} />
          </Pressable>

          <NativeBottomSheet
            visible={serverPickerOpen}
            title="Saved servers"
            showCloseButton
            maxHeight="80%"
            onClose={() => setServerPickerOpen(false)}
          >
            <ScrollView
              nestedScrollEnabled
              style={[styles.serverOptions, { borderColor: tokens.border }]}
            >
              {serverOptions.map((option, index) => {
                const selected = option === serverUrl;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={({ pressed }) => [
                      styles.serverOption,
                      index < serverOptions.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderColor: tokens.border,
                      },
                      {
                        backgroundColor: selected ? tokens.primaryMuted : tokens.surface,
                        opacity: pressed ? 0.72 : 1,
                      },
                    ]}
                    onPress={() => {
                      setServerUrl(option);
                      setServerPickerOpen(false);
                    }}
                  >
                    <Text
                      numberOfLines={2}
                      style={[
                        typography.body,
                        styles.serverPickerLabel,
                        { color: tokens.foreground },
                      ]}
                    >
                      {option}
                    </Text>
                    {selected ? <Check size={18} color={tokens.foreground} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </NativeBottomSheet>

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
  serverPickerTrigger: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  serverPickerLabel: { flex: 1, minWidth: 0 },
  serverOptions: {
    maxHeight: 360,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  serverOption: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  validated: { flexDirection: "row", alignItems: "center", gap: 8 },
});
