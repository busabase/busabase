import Constants from "expo-constants";
import { Platform } from "react-native";

interface BusabaseExtra {
  cloudUrl?: string;
  demoServerUrl?: string;
}

const readExtra = (): BusabaseExtra => {
  const extra = Constants.expoConfig?.extra as { busabase?: BusabaseExtra } | undefined;
  return extra?.busabase ?? {};
};

const extra = readExtra();
const defaultCloudUrl = __DEV__ ? "https://busabase.com" : "https://busabase.com";
const localWebOAuthRedirectUri =
  __DEV__ && Platform.OS === "web" ? "http://localhost:8081/oauth/callback" : undefined;

export const busabaseConfig = {
  cloudUrl: process.env.EXPO_PUBLIC_BUSABASE_CLOUD_URL ?? extra.cloudUrl ?? defaultCloudUrl,
  demoServerUrl: extra.demoServerUrl ?? null,
  oauthClientId: "busabase-mobile",
  oauthClientPlatform: "mobile",
  oauthRedirectUri:
    process.env.EXPO_PUBLIC_BUSABASE_OAUTH_REDIRECT_URI ??
    localWebOAuthRedirectUri ??
    "busabase://oauth/callback",
  userAgent: "BusabaseApp/0.1 Expo",
};
