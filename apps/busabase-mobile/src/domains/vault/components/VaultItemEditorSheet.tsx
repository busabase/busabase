import type { VaultItemKind } from "busabase-contract/domains/vault/types";
import { Trash2 } from "lucide-react-native";
import { StyleSheet, Switch, Text, View } from "react-native";
import { NativeActionBar, NativeBottomSheet, NativeChipList } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { useI18n } from "~/i18n";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { VaultDraft, VaultRow } from "../types/vault-form";
import { VAULT_KIND_OPTIONS } from "../utils/vault-form";

interface Props {
  draft: VaultDraft | null;
  showSecrets: boolean;
  onClose: () => void;
  onCommit: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<VaultRow>) => void;
}

export function VaultItemEditorSheet({
  draft,
  showSecrets,
  onClose,
  onCommit,
  onRemove,
  onUpdate,
}: Props) {
  const tokens = useTokens();
  const { t } = useI18n();

  return (
    <NativeBottomSheet
      visible={!!draft}
      title={
        draft
          ? draft.isNew
            ? draft.row.kind === "secret"
              ? "Add secret"
              : "Add variable"
            : "Edit item"
          : undefined
      }
      showCloseButton
      onClose={onClose}
      footer={
        draft ? (
          <NativeActionBar>
            <Button
              label={t.common.save}
              disabled={!draft.row.key.trim()}
              fullWidth
              onPress={onCommit}
            />
            {!draft.isNew ? (
              <Button
                label={t.common.delete}
                variant="destructive"
                fullWidth
                leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
                onPress={onRemove}
              />
            ) : null}
          </NativeActionBar>
        ) : undefined
      }
    >
      {draft ? (
        <View style={styles.formBody}>
          <View style={styles.fullBleedChips}>
            <NativeChipList<VaultItemKind>
              value={draft.row.kind}
              options={VAULT_KIND_OPTIONS}
              onChange={(kind) => onUpdate({ kind })}
            />
          </View>
          <TextInput
            label="Key"
            placeholder="API_KEY"
            autoCapitalize="characters"
            value={draft.row.key}
            onChangeText={(key) => onUpdate({ key })}
          />
          <TextInput
            label="Value"
            placeholder="Value"
            secureTextEntry={draft.row.kind === "secret" && !showSecrets}
            value={draft.row.value}
            onChangeText={(value) => onUpdate({ value })}
          />
          <TextInput
            label="Description (optional)"
            value={draft.row.description}
            onChangeText={(description) => onUpdate({ description })}
          />
          <View style={styles.switchRow}>
            <Text style={[typography.small, { color: tokens.foreground }]}>
              Available to running functions/skills
            </Text>
            <Switch
              accessibilityLabel="Runtime access"
              value={draft.row.runtimeAccess}
              trackColor={{ true: tokens.primary }}
              onValueChange={(runtimeAccess) => onUpdate({ runtimeAccess })}
            />
          </View>
        </View>
      ) : null}
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  fullBleedChips: { marginHorizontal: -20 },
  formBody: { gap: 12 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
});
