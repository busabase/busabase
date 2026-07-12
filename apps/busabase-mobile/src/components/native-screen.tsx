import { ChevronRight, X } from "lucide-react-native";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { Button } from "./ui/Button";

interface NativeScreenProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  headerLeading?: ReactNode;
  headerAction?: ReactNode;
  footer?: ReactNode;
}

export function NativeScreen({
  title,
  subtitle,
  children,
  refreshing,
  onRefresh,
  headerLeading,
  headerAction,
  footer,
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
          contentContainerStyle={[styles.content, footer ? styles.contentWithFooter : null]}
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
              <Text numberOfLines={1} style={[typography.h1, { color: tokens.foreground }]}>
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
          {children}
        </ScrollView>
        {footer ? (
          <SafeAreaView
            edges={["bottom"]}
            style={[styles.footer, { backgroundColor: tokens.surface, borderColor: tokens.border }]}
          >
            {footer}
          </SafeAreaView>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function NativeLoadingState({ label = "Loading" }: { label?: string }) {
  const tokens = useTokens();
  return (
    <View style={styles.state}>
      <ActivityIndicator color={tokens.primary} />
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>{label}</Text>
    </View>
  );
}

export function NativeEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const tokens = useTokens();
  return (
    <View style={styles.statePanel}>
      <Text style={[typography.h2, styles.stateTitle, { color: tokens.foreground }]}>{title}</Text>
      <Text style={[typography.body, styles.stateBody, { color: tokens.mutedForeground }]}>
        {description}
      </Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} variant="secondary" onPress={onAction} />
      ) : null}
    </View>
  );
}

export function NativeErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const tokens = useTokens();
  return (
    <View style={styles.statePanel}>
      <Text style={[typography.h2, styles.stateTitle, { color: tokens.foreground }]}>
        Could not load
      </Text>
      <Text style={[typography.body, styles.stateBody, { color: tokens.mutedForeground }]}>
        {message}
      </Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function NativeActionBar({ children }: { children: ReactNode }) {
  return <View style={styles.actionBar}>{children}</View>;
}

export function NativeActionRow({ children }: { children: ReactNode }) {
  return <View style={styles.actionRow}>{children}</View>;
}

export function NativeActionItem({ children }: { children: ReactNode }) {
  return <View style={styles.actionItem}>{children}</View>;
}

export function NativeInlineError({ message, onReset }: { message: string; onReset?: () => void }) {
  const tokens = useTokens();
  return (
    <View style={[styles.inlineError, { borderColor: tokens.destructive }]}>
      <Text
        numberOfLines={2}
        style={[typography.small, styles.inlineErrorText, { color: tokens.destructive }]}
      >
        {message}
      </Text>
      {onReset ? (
        <Pressable accessibilityRole="button" hitSlop={mobile.hitSlop} onPress={onReset}>
          <Text style={[typography.small, { color: tokens.foreground }]}>Reset</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

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

interface NativeChipOption<T extends string | null> {
  value: T;
  label: string;
  meta?: string | number;
}

interface NativeChipListProps<T extends string | null> {
  options: NativeChipOption<T>[];
  value: T;
  selectedValues?: T[];
  onChange: (value: T) => void;
}

export function NativeChipList<T extends string | null>({
  options,
  value,
  selectedValues,
  onChange,
}: NativeChipListProps<T>) {
  const tokens = useTokens();
  const selectedSet = new Set(selectedValues ?? []);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipsScroll}
      contentContainerStyle={styles.chipsContent}
    >
      {options.map((option) => {
        const active = option.value === value || selectedSet.has(option.value);
        return (
          <Pressable
            key={option.value ?? "null"}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.chip,
              {
                backgroundColor: active ? tokens.primaryMuted : tokens.card,
                borderColor: active ? tokens.primary : tokens.border,
              },
            ]}
            onPress={() => onChange(option.value)}
          >
            <Text
              style={[
                typography.small,
                { color: active ? tokens.foreground : tokens.mutedForeground },
              ]}
            >
              {option.label}
            </Text>
            {option.meta !== undefined ? (
              <View
                style={[
                  styles.chipBadge,
                  { backgroundColor: active ? tokens.primary : tokens.muted },
                ]}
              >
                <Text
                  style={[
                    typography.caption,
                    { color: active ? tokens.primaryForeground : tokens.mutedForeground },
                  ]}
                >
                  {option.meta}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

interface NativeSegmentOption<T extends string> {
  value: T;
  label: string;
  meta?: string | number;
  icon?: ReactNode;
  Icon?: React.ComponentType<{ size?: number; color?: string }>;
}

interface NativeSegmentedControlProps<T extends string> {
  options: NativeSegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function NativeSegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: NativeSegmentedControlProps<T>) {
  const tokens = useTokens();

  return (
    <View style={[styles.segmented, { backgroundColor: tokens.muted, borderColor: tokens.border }]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segment, { backgroundColor: active ? tokens.surface : "transparent" }]}
            onPress={() => onChange(option.value)}
          >
            {option.Icon ? (
              <option.Icon size={15} color={active ? tokens.foreground : tokens.mutedForeground} />
            ) : (
              option.icon
            )}
            <Text
              style={[
                typography.small,
                { color: active ? tokens.foreground : tokens.mutedForeground },
              ]}
            >
              {option.label}
            </Text>
            {option.meta !== undefined ? (
              <View
                style={[
                  styles.segmentBadge,
                  { backgroundColor: active ? tokens.primary : tokens.surface },
                ]}
              >
                <Text
                  style={[
                    typography.caption,
                    { color: active ? tokens.primaryForeground : tokens.mutedForeground },
                  ]}
                >
                  {option.meta}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
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

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.sheetScrim, { backgroundColor: tokens.overlay }]}
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
            { backgroundColor: tokens.surface },
            maxHeight ? { maxHeight } : null,
          ]}
        >
          <View style={[styles.sheetHandle, { backgroundColor: tokens.handle }]} />
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

interface NativeSectionProps {
  title?: string;
  caption?: string;
  children: ReactNode;
  style?: ViewStyle;
}

// Mirrors the web dashboard's list group (inbox.tsx BusaBaseList): a
// muted-pill label above a plain divider-separated row list — deliberately
// NOT a bordered/backgrounded card. Boxing every group in its own card was
// making the screen read as a stack of separate boxed widgets instead of one
// continuous Linear-style list; rows now sit directly on the screen
// background and are separated only by NativeRow's own hairline dividers.
export function NativeSection({ title, caption, children, style }: NativeSectionProps) {
  const tokens = useTokens();

  return (
    <View style={[styles.sectionWrap, style]}>
      {title ? (
        <View style={[styles.sectionHeader, { backgroundColor: tokens.muted }]}>
          <Text
            style={[typography.caption, styles.sectionTitle, { color: tokens.mutedForeground }]}
          >
            {title}
          </Text>
          {caption ? (
            <Text style={[typography.caption, { color: tokens.mutedForeground }]}>{caption}</Text>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

interface NativeRowProps {
  title: string;
  subtitle?: string;
  meta?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children?: ReactNode;
  last?: boolean;
}

export function NativeRow({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  onPress,
  disabled,
  destructive,
  children,
  last,
}: NativeRowProps) {
  const tokens = useTokens();
  const textColor = destructive ? tokens.destructive : tokens.foreground;
  const content = (
    <>
      {leading ? <View style={styles.rowLeading}>{leading}</View> : null}
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          <Text
            numberOfLines={1}
            style={[typography.bodyEm, styles.rowTitle, { color: textColor }]}
          >
            {title}
          </Text>
          {meta ? (
            <Text
              numberOfLines={1}
              style={[typography.small, styles.rowMeta, { color: tokens.mutedForeground }]}
            >
              {meta}
            </Text>
          ) : null}
        </View>
        {subtitle ? (
          <Text numberOfLines={2} style={[typography.small, { color: tokens.mutedForeground }]}>
            {subtitle}
          </Text>
        ) : null}
        {children}
      </View>
      {trailing ? <View style={styles.rowTrailing}>{trailing}</View> : null}
      {onPress && !trailing ? <ChevronRight size={18} color={tokens.mutedForeground} /> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        hitSlop={mobile.hitSlop}
        style={({ pressed }) => [
          styles.nativeRow,
          !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border },
          { opacity: disabled ? 0.52 : pressed ? 0.72 : 1 },
        ]}
        onPress={onPress}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.nativeRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border },
      ]}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingBottom: 36 },
  contentWithFooter: { paddingBottom: 132 },
  header: {
    paddingHorizontal: spacing[5],
    paddingTop: Platform.select({ ios: 8, android: 12, default: 10 }),
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeading: { width: 44 },
  headerAction: { minWidth: 44, alignItems: "flex-end" },
  titleBlock: { flex: 1, gap: 2, minWidth: 0 },
  state: { alignItems: "center", justifyContent: "center", gap: spacing[3], paddingVertical: 48 },
  statePanel: {
    marginHorizontal: spacing[5],
    marginTop: spacing[6],
    paddingHorizontal: 18,
    paddingVertical: 30,
    alignItems: "center",
    gap: spacing[3],
  },
  stateTitle: { textAlign: "center" },
  stateBody: { maxWidth: 320, textAlign: "center" },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: 8,
  },
  actionBar: { gap: 10 },
  actionRow: { flexDirection: "row", gap: 10 },
  actionItem: { flex: 1, minWidth: 0 },
  inlineError: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inlineErrorText: { flex: 1, minWidth: 0 },
  sheetScrim: { flex: 1, justifyContent: "flex-end" },
  sheetDismiss: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingTop: 10,
    paddingBottom: spacing[6],
    gap: spacing[3],
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
  chipsScroll: { flexGrow: 0 },
  chipsContent: { paddingHorizontal: spacing[5], gap: 8 },
  chip: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 12,
  },
  chipBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  segmented: {
    marginHorizontal: spacing[5],
    minHeight: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 3,
    flexDirection: "row",
    gap: 3,
  },
  segment: {
    flex: 1,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  segmentBadge: {
    minWidth: 19,
    height: 19,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  sectionWrap: { marginHorizontal: spacing[5], marginTop: 12, gap: 6 },
  sectionHeader: {
    alignSelf: "flex-start",
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionTitle: { textTransform: "uppercase" },
  nativeRow: {
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowLeading: { width: 32, alignItems: "center" },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  rowTitle: { flex: 1, minWidth: 0 },
  rowMeta: { flexShrink: 1, minWidth: 0, textAlign: "right" },
  rowTrailing: { alignItems: "flex-end", flexShrink: 0, maxWidth: "46%" },
});
