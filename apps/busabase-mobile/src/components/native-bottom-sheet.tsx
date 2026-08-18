import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getAppNavigationLayout } from "~/domains/workspace/utils/responsive-layout";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface NativeBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  footer?: ReactNode;
  maxHeight?: ViewStyle["maxHeight"];
  showCloseButton?: boolean;
  children?: ReactNode;
}

export function NativeBottomSheet({
  visible,
  onClose,
  title,
  description,
  footer,
  maxHeight,
  showCloseButton,
  children,
}: NativeBottomSheetProps) {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const regularPresentation = getAppNavigationLayout(width, height).persistentSidebar;

  return (
    <Modal
      animationType={regularPresentation ? "fade" : "slide"}
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[
          styles.sheetScrim,
          regularPresentation ? styles.sheetScrimRegular : null,
          { backgroundColor: tokens.overlay },
        ]}
        behavior={Platform.select({ ios: "padding", default: undefined })}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.sheetDismiss}
          onPress={onClose}
        />
        <View
          style={[
            styles.sheet,
            regularPresentation ? styles.sheetRegular : null,
            { backgroundColor: tokens.surface },
            {
              paddingBottom: Platform.select({
                web: spacing[6],
                default: spacing[4] + insets.bottom,
              }),
            },
            maxHeight ? { maxHeight } : null,
          ]}
        >
          {regularPresentation ? null : (
            <View style={[styles.sheetHandle, { backgroundColor: tokens.handle }]} />
          )}
          {showCloseButton ? (
            <View style={styles.sheetTitleRow}>
              {title ? (
                <Text
                  numberOfLines={1}
                  style={[typography.h2, styles.sheetTitle, { color: tokens.foreground }]}
                >
                  {title}
                </Text>
              ) : (
                <View style={styles.sheetTitle} />
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={mobile.hitSlop}
                onPress={onClose}
              >
                <X size={22} color={tokens.foreground} />
              </Pressable>
            </View>
          ) : title ? (
            <Text style={[typography.h2, { color: tokens.foreground }]}>{title}</Text>
          ) : null}
          {description ? (
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>{description}</Text>
          ) : null}
          {children}
          {footer ? (
            <View style={[styles.sheetFooter, { borderColor: tokens.border }]}>{footer}</View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetScrim: { flex: 1, justifyContent: "flex-end" },
  sheetScrimRegular: {
    justifyContent: "center",
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[6],
  },
  sheetDismiss: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingTop: 10,
    paddingBottom: spacing[6],
    gap: spacing[3],
  },
  sheetRegular: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: radius.full,
    marginBottom: 4,
  },
  sheetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sheetTitle: { flex: 1, minWidth: 0 },
  sheetFooter: {
    marginHorizontal: -spacing[5],
    marginBottom: -4,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
  },
});
