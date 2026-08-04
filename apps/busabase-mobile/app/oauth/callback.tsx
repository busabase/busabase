import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { NativeScreen } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

/**
 * Landing route for the `busabase://oauth/callback` deep link (and, on Expo
 * web dev, `http://localhost:8081/oauth/callback`).
 *
 * In the happy path this screen is never seen: `signInWithBusabaseCloud` runs
 * the flow inside `WebBrowser.openAuthSessionAsync`, which intercepts the
 * redirect itself and resolves the promise — the URL never reaches the router.
 *
 * It renders when that interception did not happen, which is a real situation
 * rather than a theoretical one:
 *   - the app was killed while the user was signing in, so the deep link cold
 *     starts a brand-new process with no pending auth session to resolve;
 *   - Expo web, where the redirect is an ordinary same-origin navigation.
 *
 * Without this route, expo-router had no match for the path and the user was
 * dropped on the not-found screen with the authorization code in the URL bar.
 * There is nothing safe to do with that code here — the PKCE verifier lived in
 * the process that has since died — so the only honest outcome is to say the
 * sign-in has to be restarted, and give a one-tap way to do it.
 */
export default function OAuthCallbackScreen() {
  const router = useRouter();
  const tokens = useTokens();

  useEffect(() => {
    // Best effort: if an auth session IS still pending in this process (web),
    // this hands the result back to it and the screen unmounts on its own.
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  return (
    <NativeScreen title="Sign-in interrupted" subtitle="Busabase Cloud">
      <View style={styles.body}>
        <Text style={[typography.body, { color: tokens.mutedForeground }]}>
          This sign-in could not be completed, most likely because Busabase was closed while you
          were signing in. Your account is unchanged — please start the sign-in again.
        </Text>
        <Button label="Back to Busabase" onPress={() => router.replace("/")} />
      </View>
    </NativeScreen>
  );
}

const styles = StyleSheet.create({
  body: {
    // NativeScreen leaves its children edge-to-edge (rows and sections bring
    // their own insets); this screen is plain prose, so it pads itself.
    gap: spacing[4],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
  },
});
