import type { VaultItemKind } from "busabase-contract/domains/vault/types";
import { Eye, EyeOff, KeyRound, Plus, Trash2, Variable } from "lucide-react-native";
import { Switch } from "react-native";
import { NativeRow, NativeSection } from "~/components/native-screen";
import type { VaultRow } from "../types/vault-form";
import { SECRET_MASK } from "../utils/vault-form";

interface Props {
  destructiveColor: string;
  mutedColor: string;
  primaryColor: string;
  rows: VaultRow[];
  secrets: VaultRow[];
  showSecrets: boolean;
  variables: VaultRow[];
  onClear: () => void;
  onCreate: (kind: VaultItemKind) => void;
  onEdit: (row: VaultRow) => void;
  onShowSecretsChange: (visible: boolean) => void;
}

export function VaultItemSections({
  destructiveColor,
  mutedColor,
  primaryColor,
  rows,
  secrets,
  showSecrets,
  variables,
  onClear,
  onCreate,
  onEdit,
  onShowSecretsChange,
}: Props) {
  return (
    <>
      <NativeSection title="Secrets" caption={`${secrets.length}`}>
        {secrets.length > 0 ? (
          <NativeRow
            title="Reveal values"
            leading={
              showSecrets ? (
                <Eye size={18} color={mutedColor} />
              ) : (
                <EyeOff size={18} color={mutedColor} />
              )
            }
            trailing={
              <Switch
                accessibilityLabel="Reveal secret values"
                value={showSecrets}
                trackColor={{ true: primaryColor }}
                onValueChange={onShowSecretsChange}
              />
            }
          />
        ) : null}
        {secrets.length === 0 ? <NativeRow title="No secrets" /> : null}
        {secrets.map((row) => (
          <NativeRow
            key={row.id}
            title={row.key || "Untitled secret"}
            subtitle={row.value ? (showSecrets ? row.value : SECRET_MASK) : "(empty)"}
            meta={row.runtimeAccess ? undefined : "No runtime"}
            leading={<KeyRound size={18} color={mutedColor} />}
            onPress={() => onEdit(row)}
          />
        ))}
        <NativeRow
          title="Add secret"
          leading={<Plus size={18} color={mutedColor} />}
          onPress={() => onCreate("secret")}
          last
        />
      </NativeSection>

      <NativeSection title="Variables" caption={`${variables.length}`}>
        {variables.length === 0 ? <NativeRow title="No variables" /> : null}
        {variables.map((row) => (
          <NativeRow
            key={row.id}
            title={row.key || "Untitled variable"}
            subtitle={row.value || "(empty)"}
            meta={row.runtimeAccess ? undefined : "No runtime"}
            leading={<Variable size={18} color={mutedColor} />}
            onPress={() => onEdit(row)}
          />
        ))}
        <NativeRow
          title="Add variable"
          leading={<Plus size={18} color={mutedColor} />}
          onPress={() => onCreate("variable")}
          last
        />
      </NativeSection>

      {rows.length > 0 ? (
        <NativeSection title="Danger zone">
          <NativeRow
            title="Clear vault"
            destructive
            leading={<Trash2 size={18} color={destructiveColor} />}
            onPress={onClear}
            last
          />
        </NativeSection>
      ) : null}
    </>
  );
}
