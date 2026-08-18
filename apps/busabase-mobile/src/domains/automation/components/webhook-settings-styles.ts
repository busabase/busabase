import { StyleSheet } from "react-native";
import { radius } from "~/theme/tokens";

export const webhookSettingsStyles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  fullBleedChips: { marginHorizontal: -20 },
  formScroll: { flexGrow: 0 },
  formBody: { gap: 12 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  codeInput: {
    minHeight: 140,
    paddingTop: 12,
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 19,
  },
});
