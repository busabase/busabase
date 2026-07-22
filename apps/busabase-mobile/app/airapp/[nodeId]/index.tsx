import { skipToken, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { getValidBusabaseCloudSession } from "~/auth/oauth";
import { getCloudSessionToken } from "~/auth/session-store";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { useConnection } from "~/connection/connection-store";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

/**
 * AirApp node detail — the only node type rendered as an embedded WebView
 * instead of native UI. AirApp is an agent-authored, runnable web app; its
 * full Run/Files/Logs experience is built on nodepod, a browser-only Node.js
 * runtime that can't be reimplemented natively, so this screen just embeds
 * the existing web page (in `?chromeless=1` mode — no sidebar/topbar, see
 * `BusabaseDashboard`'s `chromeless` prop) instead of rebuilding that UI.
 *
 * Auth differs by connection mode:
 * - self-hosted/demo: the target server has no page-level auth at all, so the
 *   WebView can load `{serverUrl}/dashboard/airapp/{slug}?chromeless=1` directly.
 * - cloud: the dashboard route is gated by a real cookie session that never
 *   sees this app's bearer token, so the WebView instead opens
 *   `{cloudUrl}/api/auth/mobile-embed-token?token=<bearer>&target=<path>` — a
 *   bridge route that validates the bearer, mints a cookie session for the
 *   same user, and 302s to the target with that session attached.
 */
function buildAirAppEmbedUrl(
  serverUrl: string,
  mode: "self-hosted" | "demo" | "cloud",
  bearerToken: string | null,
  nodeId: string,
): string | null {
  const target = `/dashboard/airapp/${encodeURIComponent(nodeId)}?chromeless=1`;
  const base = serverUrl.replace(/\/+$/, "");
  if (mode !== "cloud") {
    return `${base}${target}`;
  }
  if (!bearerToken) return null;
  return `${base}/api/auth/mobile-embed-token?token=${encodeURIComponent(bearerToken)}&target=${encodeURIComponent(target)}`;
}

function AirAppDetailContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  // Node tree taps pass the real node id; search results pass its slug (see
  // app/drawer/search.tsx and app/drive|skill/[nodeId] for the same
  // convention) — the backend's `airapps.get`/dashboard route resolve both.
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const { state } = useConnection();
  const connection = state.status === "connected" ? state.connection : null;
  const webviewRef = useRef<WebView>(null);
  const [webviewError, setWebviewError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const airappQuery = useQuery(
    buda && nodeId
      ? buda.orpc.airapps.get.queryOptions({ input: { nodeId } })
      : { queryKey: ["no-connection", "airapp", nodeId], queryFn: skipToken },
  );
  const airapp = airappQuery.data ?? null;

  const embedUrlQuery = useQuery({
    queryKey: ["airapp-embed-url", connection?.serverUrl, connection?.mode, nodeId, reloadToken],
    queryFn: async () => {
      if (!connection || !nodeId) return null;
      if (connection.mode !== "cloud") {
        return buildAirAppEmbedUrl(connection.serverUrl, connection.mode, null, nodeId);
      }
      const session = await getValidBusabaseCloudSession();
      const token = getCloudSessionToken(session);
      return buildAirAppEmbedUrl(connection.serverUrl, connection.mode, token, nodeId);
    },
    enabled: Boolean(connection && nodeId),
  });

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/drawer/bases"));

  const retry = () => {
    setWebviewError(null);
    setReloadToken((current) => current + 1);
    webviewRef.current?.reload();
  };

  const embedUrl = embedUrlQuery.data ?? null;
  const preparingUrl = embedUrlQuery.isLoading || embedUrlQuery.isRefetching;
  const noSession = !preparingUrl && !embedUrl && connection?.mode === "cloud";

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: tokens.background }]}>
      <View style={[styles.header, { borderColor: tokens.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={mobile.hitSlop}
          style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
          onPress={goBack}
        >
          <ArrowLeft size={22} color={tokens.foreground} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text numberOfLines={1} style={[typography.h2, { color: tokens.foreground }]}>
            {airapp?.node.name ?? "AirApp"}
          </Text>
          {airapp?.node.description ? (
            <Text numberOfLines={1} style={[typography.small, { color: tokens.mutedForeground }]}>
              {airapp.node.description}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.webviewWrap}>
        {webviewError ? (
          <NativeErrorState message={webviewError} onRetry={retry} />
        ) : noSession ? (
          <NativeErrorState
            message="Your Busabase Cloud session has expired. Reconnect and try again."
            onRetry={retry}
          />
        ) : preparingUrl || !embedUrl ? (
          <NativeLoadingState label="Loading AirApp" />
        ) : (
          <WebView
            ref={webviewRef}
            key={reloadToken}
            source={{ uri: embedUrl }}
            style={styles.webview}
            startInLoadingState
            renderLoading={() => <NativeLoadingState label="Loading AirApp" />}
            onError={(syntheticEvent) => {
              setWebviewError(syntheticEvent.nativeEvent.description || "Could not load AirApp.");
            }}
            onHttpError={(syntheticEvent) => {
              const { statusCode } = syntheticEvent.nativeEvent;
              // A 401/403 here means the bridge rejected the bearer token
              // (expired/invalid) — surface that distinctly from a generic
              // load failure so retrying is meaningful (re-auth, not just reload).
              if (statusCode === 401 || statusCode === 403) {
                setWebviewError("Your session could not be verified. Reconnect and try again.");
              } else {
                setWebviewError(`AirApp failed to load (HTTP ${statusCode}).`);
              }
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

export default function AirAppDetailScreen() {
  return (
    <ConnectionGuard>
      <AirAppDetailContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: { flex: 1, minWidth: 0, gap: 1 },
  webviewWrap: { flex: 1 },
  webview: { flex: 1 },
});
