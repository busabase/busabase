import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { mobile, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface NativeScreenProps {
  title: string;
  titleNumberOfLines?: 1 | 2;
  subtitle?: string;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  headerLeading?: ReactNode;
  headerAction?: ReactNode;
  footer?: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  bodyContainerStyle?: StyleProp<ViewStyle>;
  footerContentContainerStyle?: StyleProp<ViewStyle>;
}

export function NativeScreen({
  title,
  titleNumberOfLines = 1,
  subtitle,
  children,
  refreshing,
  onRefresh,
  headerLeading,
  headerAction,
  footer,
  contentContainerStyle,
  bodyContainerStyle,
  footerContentContainerStyle,
}: NativeScreenProps) {
  const tokens = useTokens();

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: tokens.background }]}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.select({ ios: "padding", default: undefined })}
        keyboardVerticalOffset={Platform.select({ ios: mobile.headerHeight, default: 0 })}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            footer ? styles.contentWithFooter : null,
            contentContainerStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={!!refreshing}
                onRefresh={onRefresh}
                tintColor={tokens.primary}
              />
            ) : undefined
          }
        >
          <View style={[styles.header, { borderColor: tokens.border }]}>
            {headerLeading ? <View style={styles.headerLeading}>{headerLeading}</View> : null}
            <View style={styles.titleBlock}>
              <Text
                numberOfLines={titleNumberOfLines}
                style={[typography.h1, { color: tokens.foreground }]}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text
                  numberOfLines={1}
                  style={[typography.small, { color: tokens.mutedForeground }]}
                >
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {headerAction ? <View style={styles.headerAction}>{headerAction}</View> : null}
          </View>
          {bodyContainerStyle ? <View style={bodyContainerStyle}>{children}</View> : children}
        </ScrollView>
        {footer ? (
          <SafeAreaView
            edges={["bottom"]}
            style={[styles.footer, { backgroundColor: tokens.surface, borderColor: tokens.border }]}
          >
            {footerContentContainerStyle ? (
              <View style={footerContentContainerStyle}>{footer}</View>
            ) : (
              footer
            )}
          </SafeAreaView>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingBottom: 36 },
  contentWithFooter: { paddingBottom: spacing[4] },
  header: {
    paddingHorizontal: spacing[5],
    paddingTop: Platform.select({ ios: 8, android: 12, default: 10 }),
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeading: { width: 44 },
  headerAction: { minWidth: 44, alignItems: "flex-end" },
  titleBlock: { flex: 1, gap: 2, minWidth: 0 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: 8,
  },
});
