import { Platform } from "react-native";

// Mirrors the busabase web dashboard, which inherits KUI's neutral (shadcn/Linear)
// theme: a monochrome grayscale scale with a near-black primary, subtle gray
// borders, and white cards on a faintly tinted background. Color is reserved
// for semantic status (destructive/success/warning) — there is no brand accent.
export const lightTokens = {
  background: "#FAFAFA",
  surface: "#FFFFFF",
  card: "#FFFFFF",
  foreground: "#0A0A0A",
  mutedForeground: "#737373",
  muted: "#F5F5F5",
  border: "#E5E5E5",
  primary: "#171717",
  primaryForeground: "#FAFAFA",
  primaryMuted: "#F5F5F5",
  destructive: "#EF4444",
  destructiveForeground: "#FAFAFA",
  success: "#16A34A",
  warning: "#D97706",
};

export type Tokens = typeof lightTokens;

export const darkTokens: Tokens = {
  background: "#0A0A0A",
  surface: "#171717",
  card: "#171717",
  foreground: "#FAFAFA",
  mutedForeground: "#A3A3A3",
  muted: "#262626",
  border: "#262626",
  primary: "#FAFAFA",
  primaryForeground: "#171717",
  primaryMuted: "#262626",
  destructive: "#EF4444",
  destructiveForeground: "#FAFAFA",
  success: "#4ADE80",
  warning: "#FBBF24",
};

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: "700" as const, letterSpacing: -0.4 },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: "600" as const, letterSpacing: -0.3 },
  h2: { fontSize: 19, lineHeight: 25, fontWeight: "600" as const, letterSpacing: -0.2 },
  h3: { fontSize: 16, lineHeight: 23, fontWeight: "600" as const, letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "400" as const },
  bodyEm: { fontSize: 15, lineHeight: 22, fontWeight: "500" as const },
  small: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: "600" as const, letterSpacing: 0.6 },
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 999,
} as const;

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
} as const;

export const mobile = {
  minTouchTarget: 48,
  headerHeight: Platform.select({ ios: 52, android: 56, default: 52 }),
  drawerWidth: 292,
  hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
} as const;
