import { Globe, Lock } from "lucide-react-native";
import { StyleSheet, Switch, Text, View } from "react-native";
import { fmt, useI18n } from "~/i18n";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { NodePermissionAccess } from "../types/node-permissions";

interface Props {
  access: NodePermissionAccess;
  pending: boolean;
  onPrivateChange: (makePrivate: boolean) => void;
}

export function NodePermissionAccessControls({ access, pending, onPrivateChange }: Props) {
  const tokens = useTokens();
  const { t } = useI18n();
  const accessText = access.isPrivate
    ? t.permissions.accessPrivate
    : access.isInherited
      ? fmt(t.permissions.accessInherited, { name: access.inheritedPrivateFrom ?? "" })
      : access.isRestrictedSpace
        ? t.permissions.accessRestrictedDefault
        : t.permissions.accessVisibleToAll;

  return (
    <>
      <View style={[styles.banner, { backgroundColor: tokens.muted }]}>
        {access.isLimited ? (
          <Lock size={16} color={tokens.mutedForeground} />
        ) : (
          <Globe size={16} color={tokens.mutedForeground} />
        )}
        <Text style={[typography.small, styles.bannerText, { color: tokens.foreground }]}>
          {accessText}
        </Text>
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.toggleText}>
          <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
            {t.permissions.makePrivate}
          </Text>
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            {access.isInherited
              ? fmt(t.permissions.inheritedLockHint, { name: access.inheritedPrivateFrom ?? "" })
              : t.permissions.makePrivateHint}
          </Text>
        </View>
        <Switch
          accessibilityLabel={t.permissions.makePrivate}
          value={access.isPrivate}
          disabled={access.isInherited || pending}
          trackColor={{ false: tokens.muted, true: tokens.primary }}
          thumbColor={tokens.surface}
          onValueChange={onPrivateChange}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bannerText: { flex: 1, minWidth: 0 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
  },
  toggleText: { flex: 1, minWidth: 0, gap: 2 },
});
