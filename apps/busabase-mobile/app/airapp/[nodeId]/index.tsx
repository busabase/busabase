import { skipToken, useQuery } from "@tanstack/react-query";
import { asNodeDetail } from "busabase-core/dashboard/node-detail";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { ExternalLink } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useConnection } from "~/connection/connection-store";
import { useAirAppEmbedSource } from "~/domains/knowledge/hooks/use-airapp-embed-source";
import {
  buildAirAppExternalUrl,
  resolveAirAppSpaceId,
} from "~/domains/knowledge/utils/airapp-embed-url";
import { canEmbedAirAppInWebView } from "~/domains/knowledge/utils/airapp-webview";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { useTokens } from "~/theme/use-tokens";

/**
 * AirApp node detail — the only node type rendered as an embedded WebView
 * instead of native UI. AirApp is an agent-authored, runnable web app; its
 * full Run/Files/Logs experience is built on nodepod, a browser-only Node.js
 * runtime that can't be reimplemented natively, so this screen just embeds
 * the existing full Dashboard page instead of rebuilding that UI. Its
 * responsive Cloud/Desktop shell owns the left workspace drawer, the AirApp
 * action toolbar, and the right side-panel drawer.
 *
 * Auth differs by connection mode:
 * - self-hosted/demo: the target server has no page-level auth at all, so the
 *   WebView can load `{serverUrl}/dashboard/airapp/{slug}` directly.
 * - cloud: the dashboard route is gated by a real cookie session that never
 *   sees this app's bearer token. The WebView POSTs the bearer and target to
 *   the Cloud bridge without putting credentials in its URL. The bridge sets
 *   the cookie on a 200 bootstrap document before that document navigates to
 *   the AirApp target, so its first request already carries the web session.
 */

function AirAppDetailContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  // Node tree taps pass the real node id; search results pass its slug (see
  // app/drawer/search.tsx and app/drive|skill/[nodeId] for the same
  // convention) — the backend's `nodes.get`/dashboard route resolve both.
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const { state } = useConnection();
  const connection = state.status === "connected" ? state.connection : null;
  const selectedSpaceId = connection?.selectedSpace?.id ?? null;
  const [webviewError, setWebviewError] = useState<string | null>(null);

  const airappQuery = useQuery(
    buda && nodeId
      ? buda.orpc.nodes.get.queryOptions({ input: { nodeId, type: "airapp" } })
      : { queryKey: ["no-connection", "airapp", nodeId], queryFn: skipToken },
  );
  const verifiedSpaceQuery = useQuery({
    ...(buda
      ? buda.orpc.auth.verify.queryOptions()
      : { queryKey: ["no-connection", "airapp-space"], queryFn: skipToken }),
    enabled: connection?.mode === "cloud" && !selectedSpaceId && Boolean(buda),
  });
  const effectiveSpaceId = resolveAirAppSpaceId({
    selectedSpaceId,
    verifiedSpaceId: verifiedSpaceQuery.data?.space.id,
  });
  // `nodes.get` answers for every node type, so narrow to `airapp`. A slug that
  // resolved to something else must not continue into the AirApp embed path.
  const airapp = asNodeDetail(airappQuery.data, "airapp");
  // Two ways this id can fail to be an AirApp, and BOTH have to land here:
  // `nodes.get` answers 404 when the `type` hint contradicts the stored node, so
  // the wrong-type case arrives as an ERROR, not as data of another shape. Only
  // checking the latter left the error case falling through to the embed UI —
  // an empty page with a live "Open AirApp" button pointing at a node that is
  // not an AirApp, under a header that still said "AirApp".
  const notAnAirApp = !airappQuery.isLoading && (Boolean(airappQuery.error) || !airapp);

  const embed = useAirAppEmbedSource({
    connection,
    spaceId: effectiveSpaceId,
    nodeId,
  });
  useFocusEffect(
    useCallback(() => {
      setWebviewError(null);
    }, []),
  );

  const retry = () => {
    setWebviewError(null);
    if (connection?.mode === "cloud" && !selectedSpaceId) {
      void verifiedSpaceQuery.refetch();
    }
    embed.retry();
  };

  const embedSource = embed.source;
  const resolvingCloudSpace =
    connection?.mode === "cloud" && !effectiveSpaceId && verifiedSpaceQuery.isFetching;
  const preparingUrl = resolvingCloudSpace || embed.isPreparing;
  const noCloudSpace =
    !preparingUrl && !embedSource && connection?.mode === "cloud" && !effectiveSpaceId;
  const noSession =
    !preparingUrl && !embedSource && connection?.mode === "cloud" && Boolean(effectiveSpaceId);
  const canEmbed =
    connection &&
    canEmbedAirAppInWebView({ platform: Platform.OS, serverUrl: connection.serverUrl });

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: tokens.background }]}>
      <View style={styles.webviewWrap}>
        {notAnAirApp ? (
          <NativeEmptyState description="This AirApp is not available." title="AirApp not found" />
        ) : webviewError ? (
          <NativeErrorState message={webviewError} onRetry={retry} />
        ) : noCloudSpace ? (
          <NativeErrorState
            message="Could not load your Busabase Cloud workspace. Try again."
            onRetry={retry}
          />
        ) : noSession ? (
          <NativeErrorState
            message="Your Busabase Cloud session has expired. Reconnect and try again."
            onRetry={retry}
          />
        ) : preparingUrl || !embedSource ? (
          <NativeLoadingState label="Loading AirApp" />
        ) : Platform.OS === "web" || !canEmbed ? (
          <View style={styles.webLaunch}>
            <Button
              label="Open AirApp"
              leadingIcon={<ExternalLink size={18} color={tokens.primaryForeground} />}
              onPress={() => void Linking.openURL(buildAirAppExternalUrl(embedSource))}
            />
          </View>
        ) : (
          <WebView
            source={embedSource}
            limitsNavigationsToAppBoundDomains={Platform.OS === "ios" && Boolean(canEmbed)}
            style={styles.webview}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={Platform.OS === "android"}
            domStorageEnabled
            javaScriptEnabled
            cacheEnabled
            setSupportMultipleWindows={false}
            allowsBackForwardNavigationGestures={false}
            originWhitelist={["https://*", "http://*"]}
            startInLoadingState
            renderLoading={() => <NativeLoadingState label="Loading AirApp" />}
            onContentProcessDidTerminate={() => {
              setWebviewError("AirApp's web process stopped. Try again.");
            }}
            onRenderProcessGone={(syntheticEvent) => {
              const suffix = syntheticEvent.nativeEvent.didCrash ? " after a crash" : "";
              setWebviewError(`AirApp's web process stopped${suffix}. Try again.`);
            }}
            onError={(syntheticEvent) => {
              const { code, description, domain, url } = syntheticEvent.nativeEvent;
              const reason = description || "Could not load AirApp.";
              const nativeCode = [domain, code].filter((value) => value !== undefined).join(" ");
              setWebviewError(
                `${reason}${nativeCode ? ` (${nativeCode})` : ""}${url ? `\n${url}` : ""}`,
              );
            }}
            onHttpError={(syntheticEvent) => {
              const { statusCode } = syntheticEvent.nativeEvent;
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
  webviewWrap: { flex: 1 },
  webLaunch: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  webview: { flex: 1 },
});
