import { Shield, Trash2, Users } from "lucide-react-native";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { NativeChipList, NativeRow, NativeSection } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { useI18n } from "~/i18n";
import { mobile, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { NodePermissionPrincipal, PermissionLevel } from "../types/node-permissions";

const permissionLevels = ["read", "changeRequest", "write", "manage"] as const;

interface Props {
  addPending: boolean;
  loading: boolean;
  newPrincipalId: string;
  newPrincipalIsSpace: boolean;
  newRole: PermissionLevel;
  principals: NodePermissionPrincipal[];
  removePending: boolean;
  onAdd: () => void;
  onPrincipalIdChange: (id: string) => void;
  onPrincipalIsSpaceChange: (isSpace: boolean) => void;
  onRemove: (principal: Pick<NodePermissionPrincipal, "principalId" | "principalType">) => void;
  onRoleChange: (role: PermissionLevel) => void;
}

export function NodePermissionPrincipalSections({
  addPending,
  loading,
  newPrincipalId,
  newPrincipalIsSpace,
  newRole,
  principals,
  removePending,
  onAdd,
  onPrincipalIdChange,
  onPrincipalIsSpaceChange,
  onRemove,
  onRoleChange,
}: Props) {
  const tokens = useTokens();
  const { t } = useI18n();
  const roleLabels: Record<PermissionLevel, string> = {
    read: t.permissions.roleRead,
    changeRequest: t.permissions.roleChangeRequest,
    write: t.permissions.roleWrite,
    manage: t.permissions.roleManage,
  };

  return (
    <>
      <NativeSection
        title={t.permissions.peopleHeading}
        caption={principals.length > 0 ? `${principals.length}` : undefined}
        style={styles.section}
      >
        {loading ? (
          <NativeRow title={t.permissions.loadingGrants} last />
        ) : principals.length === 0 ? (
          <NativeRow title={t.permissions.noGrants} last />
        ) : (
          principals.map((principal, index) => (
            <NativeRow
              key={principal.id}
              title={
                principal.principalType === "space" ? t.permissions.everyone : principal.principalId
              }
              subtitle={roleLabels[principal.role]}
              leading={
                principal.principalType === "space" ? (
                  <Users size={18} color={tokens.mutedForeground} />
                ) : (
                  <Shield size={18} color={tokens.mutedForeground} />
                )
              }
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.permissions.remove}
                  disabled={removePending}
                  hitSlop={mobile.hitSlop}
                  onPress={() => onRemove(principal)}
                >
                  <Trash2 size={18} color={tokens.destructive} />
                </Pressable>
              }
              last={index === principals.length - 1}
            />
          ))
        )}
      </NativeSection>

      <View style={styles.grantBlock}>
        <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
          {t.permissions.grantHeading}
        </Text>
        <View style={styles.toggleRow}>
          <Text style={[typography.small, styles.grantToggleLabel, { color: tokens.foreground }]}>
            {t.permissions.grantEveryone}
          </Text>
          <Switch
            accessibilityLabel={t.permissions.grantEveryone}
            value={newPrincipalIsSpace}
            trackColor={{ false: tokens.muted, true: tokens.primary }}
            thumbColor={tokens.surface}
            onValueChange={onPrincipalIsSpaceChange}
          />
        </View>
        {newPrincipalIsSpace ? null : (
          <TextInput
            label={t.permissions.userIdLabel}
            placeholder={t.permissions.userIdPlaceholder}
            value={newPrincipalId}
            onChangeText={onPrincipalIdChange}
          />
        )}
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          {t.permissions.roleLabel}
        </Text>
        <View style={styles.fullBleedChips}>
          <NativeChipList<PermissionLevel>
            value={newRole}
            options={permissionLevels.map((role) => ({
              value: role,
              label: roleLabels[role],
            }))}
            onChange={onRoleChange}
          />
        </View>
        <Button
          label={t.permissions.add}
          variant="secondary"
          loading={addPending}
          disabled={!newPrincipalIsSpace && newPrincipalId.trim().length === 0}
          fullWidth
          onPress={onAdd}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  section: { marginHorizontal: 0 },
  grantBlock: { gap: 10, paddingBottom: 8 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
  },
  grantToggleLabel: { flex: 1, minWidth: 0 },
  fullBleedChips: { marginHorizontal: -20 },
});
