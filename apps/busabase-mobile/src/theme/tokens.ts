import { Platform } from "react-native";

// Mirrors the Busabase web dashboard's cool micro-cement workbench theme.
// Brand assets intentionally keep their Graphite/Paper colors; these tokens
// describe product UI. Color is reserved for semantic review status.
// Canonical source: apps/busabase/src/app/global.css + content/spec/design-system.md.
export const lightTokens = {
  background: "#F1F3F3",
  surface: "#F9FAFA",
  card: "#F9FAFA",
  sidebar: "#EDEFEF",
  foreground: "#161818",
  mutedForeground: "#6F7373",
  muted: "#E6E9E9",
  border: "#D6DADA",
  primary: "#161818",
  primaryForeground: "#F1F3F3",
  primaryMuted: "#E6E9E9",
  destructive: "#EF4444",
  destructiveForeground: "#FAFAFA",
  // 茶 (Cha) semantic status palette — the only chromatic colors in the
  // product. "text" is the on-light emphasis variant (-strong).
  merged: { base: "#5E8C6A", text: "#406C4C" },
  review: { base: "#C79A3E", text: "#7F6221" },
  rejected: { base: "#B95B3F", text: "#9A4531" },
  // Kept for non-CR contexts (network/misc warnings) — not part of Cha.
  success: "#16A34A",
  warning: "#D97706",
  overlay: "rgba(0, 0, 0, 0.32)",
  scrim: "rgba(0, 0, 0, 0.22)",
  handle: "rgba(120, 120, 120, 0.34)",
};

export type Tokens = typeof lightTokens;

export const darkTokens: Tokens = {
  background: "#0A0A0A",
  surface: "#171717",
  card: "#171717",
  sidebar: "#171717",
  foreground: "#FAFAFA",
  mutedForeground: "#A3A3A3",
  muted: "#262626",
  border: "#262626",
  primary: "#FAFAFA",
  primaryForeground: "#171717",
  primaryMuted: "#262626",
  destructive: "#EF4444",
  destructiveForeground: "#FAFAFA",
  // "text" is the on-dark emphasis variant (-soft).
  merged: { base: "#5E8C6A", text: "#93C3A2" },
  review: { base: "#C79A3E", text: "#DCBD7C" },
  rejected: { base: "#B95B3F", text: "#DB9678" },
  success: "#4ADE80",
  warning: "#FBBF24",
  overlay: "rgba(0, 0, 0, 0.5)",
  scrim: "rgba(0, 0, 0, 0.4)",
  handle: "rgba(160, 160, 160, 0.34)",
};

// Serif family names come from @expo-google-fonts/fraunces (loaded via
// useFonts in app/_layout.tsx). Display/h1/h2 are the one deliberate
// divergence from Linear's all-sans look, matching the web dashboard's
// Fraunces headings; h3 and below stay on the system sans body font so
// dense list/table UI still reads as Linear-quiet.
export const serifFontFamily = {
  medium: "Fraunces_500Medium",
  semiBold: "Fraunces_600SemiBold",
} as const;

export const typography = {
  display: {
    fontSize: 29,
    lineHeight: 35,
    fontWeight: "700" as const,
    letterSpacing: 0,
    fontFamily: serifFontFamily.semiBold,
  },
  h1: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600" as const,
    letterSpacing: 0,
    fontFamily: serifFontFamily.semiBold,
  },
  h2: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600" as const,
    letterSpacing: 0,
    fontFamily: serifFontFamily.medium,
  },
  h3: { fontSize: 16, lineHeight: 23, fontWeight: "600" as const, letterSpacing: 0 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "400" as const },
  bodyEm: { fontSize: 15, lineHeight: 22, fontWeight: "500" as const },
  small: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: "600" as const, letterSpacing: 0.6 },
} as const;

export const radius = {
  sm: 0,
  md: 2,
  lg: 4,
  xl: 8,
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
