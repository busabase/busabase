import { Platform, StyleSheet } from "react-native";
import { radius, spacing } from "~/theme/tokens";

const READABLE_CONTENT_MAX_WIDTH = 768;

export const drawerScaffoldStyles = StyleSheet.create({
  scaffold: { flex: 1, flexDirection: "row" },
  contentPane: { flex: 1, minWidth: 0 },
  readableContent: {
    width: "100%",
    maxWidth: READABLE_CONTENT_MAX_WIDTH,
    alignSelf: "center",
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  modal: { flex: 1, flexDirection: "row" },
  edgeDismiss: { flex: 1 },
  drawer: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  compactDrawer: { maxWidth: "82%" },
  spaceWrap: {
    zIndex: 20,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  drawerScroll: { flex: 1 },
  drawerBody: { gap: 18, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 20 },
  drawerFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: Platform.select({ web: spacing[4], default: spacing[2] }),
  },
  navGroup: { gap: 2 },
  section: { gap: 7 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  workspaceCreateButton: {
    width: 28,
    height: 28,
    marginVertical: -6,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLabel: { textTransform: "uppercase" },
  sectionHint: { paddingHorizontal: 12, paddingVertical: 8 },
  navItem: {
    minHeight: 44,
    borderRadius: radius.md,
    paddingRight: 12,
    paddingLeft: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  activeMark: {
    width: 3,
    height: 22,
    borderRadius: radius.full,
  },
  navLabel: { flex: 1, minWidth: 0 },
  navBadge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  baseItem: { alignItems: "center", paddingVertical: 8 },
  nodeMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  baseText: { flex: 1, minWidth: 0 },
  nodeChevron: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  nodeActionsButton: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
