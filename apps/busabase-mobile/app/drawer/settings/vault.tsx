import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import type {
  VaultItemInput,
  VaultItemKind,
  VaultItemVO,
  VaultSettingsVO,
} from "busabase-contract/domains/vault/types";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  Save,
  Trash2,
  Variable,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeChipList,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
  NativeRow,
  NativeScreen,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { useI18n } from "~/i18n";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

// Local ids for rows the user has added on-device but not yet saved — real
// vault item ids come back from the server as `vault_<uuid>` (see
// createVaultItemId in busabase-core's vault-logic). Anything not saved yet
// gets this prefix so rowToItemInput knows to omit `id` (create) vs pass it
// through (update).
const DRAFT_PREFIX = "draft-";
let draftSeq = 0;

// Mirrors the web dashboard's heuristic (vault-settings-tab.tsx): a variable
// whose key looks secret-shaped gets auto-promoted to a secret on save, so a
// user who mistakenly adds `API_TOKEN` as a "variable" still gets it masked.
const isSecretName = (key: string) =>
  /(SECRET|TOKEN|KEY|PASSWORD|PASS|PRIVATE|CREDENTIAL|WEBHOOK|SIGNING)/i.test(key);

interface VaultRow {
  id: string;
  kind: VaultItemKind;
  key: string;
  value: string;
  description: string;
  runtimeAccess: boolean;
}

function makeRow(kind: VaultItemKind): VaultRow {
  draftSeq += 1;
  return {
    id: `${DRAFT_PREFIX}${Date.now()}-${draftSeq}`,
    kind,
    key: "",
    value: "",
    description: "",
    runtimeAccess: true,
  };
}

function itemToRow(item: VaultItemVO): VaultRow {
  return {
    id: item.id,
    kind: item.kind,
    key: item.key,
    value: item.value,
    description: item.description,
    runtimeAccess: item.access.runtime,
  };
}

function settingsToRows(settings: VaultSettingsVO): VaultRow[] {
  return settings.items.map(itemToRow);
}

function rowToItemInput(row: VaultRow): VaultItemInput {
  return {
    id: row.id.startsWith(DRAFT_PREFIX) ? undefined : row.id,
    kind: row.kind,
    key: row.key.trim().toUpperCase(),
    value: row.value,
    scopeType: "personal",
    scopeId: null,
    environment: "local",
    description: row.description.trim(),
    access: { runtime: row.runtimeAccess, reveal: true, edit: true, share: false },
  };
}

function rowsToItems(rows: VaultRow[]): VaultItemInput[] {
  return rows
    .map(rowToItemInput)
    .filter((item) => item.key.length > 0)
    .map((item) => ({
      ...item,
      kind: item.kind === "variable" && isSecretName(item.key) ? "secret" : item.kind,
    }));
}

const KIND_OPTIONS: Array<{ value: VaultItemKind; label: string }> = [
  { value: "secret", label: "Secret" },
  { value: "variable", label: "Variable" },
];

const SECRET_MASK = "••••••••";

function VaultSettingsContent() {
  const router = useRouter();
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const [rows, setRows] = useState<VaultRow[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [draft, setDraft] = useState<{ row: VaultRow; isNew: boolean } | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const vaultQuery = useQuery(
    buda
      ? buda.orpc.vault.get.queryOptions()
      : { queryKey: ["no-connection", "vault"], queryFn: skipToken },
  );

  useEffect(() => {
    if (vaultQuery.data && !hydrated) {
      setRows(settingsToRows(vaultQuery.data));
      setHydrated(true);
    }
  }, [vaultQuery.data, hydrated]);

  const updateMutation = useMutation({
    mutationFn: async (items: VaultItemInput[]) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.vault.update({ items });
    },
    onSuccess: (data) => setRows(settingsToRows(data)),
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error("Not connected");
      return buda.client.vault.clear();
    },
    onSuccess: () => {
      setRows([]);
      setClearConfirmOpen(false);
    },
  });

  const secrets = rows.filter((row) => row.kind === "secret");
  const variables = rows.filter((row) => row.kind === "variable");

  const openCreate = (kind: VaultItemKind) => setDraft({ row: makeRow(kind), isNew: true });
  const openEdit = (row: VaultRow) => setDraft({ row, isNew: false });
  const closeDraft = () => setDraft(null);

  const updateDraftRow = (patch: Partial<VaultRow>) =>
    setDraft((current) => (current ? { ...current, row: { ...current.row, ...patch } } : current));

  const commitDraft = () => {
    if (!draft || !draft.row.key.trim()) {
      return;
    }
    setRows((current) => {
      const exists = current.some((row) => row.id === draft.row.id);
      return exists
        ? current.map((row) => (row.id === draft.row.id ? draft.row : row))
        : [...current, draft.row];
    });
    closeDraft();
  };

  const removeDraft = () => {
    if (!draft) {
      return;
    }
    setRows((current) => current.filter((row) => row.id !== draft.row.id));
    closeDraft();
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/drawer/settings"));

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={goBack}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  return (
    <NativeScreen
      title="Vault"
      subtitle="Secrets & variables"
      headerLeading={headerLeading}
      refreshing={vaultQuery.isRefetching}
      onRefresh={() => void vaultQuery.refetch()}
      footer={
        !vaultQuery.isLoading && !vaultQuery.error ? (
          <NativeActionBar>
            {updateMutation.error ? (
              <NativeInlineError
                message={updateMutation.error.message}
                onReset={() => updateMutation.reset()}
              />
            ) : null}
            <Button
              label={updateMutation.isPending ? "Saving..." : "Save changes"}
              loading={updateMutation.isPending}
              fullWidth
              leadingIcon={<Save size={18} color={tokens.primaryForeground} />}
              onPress={() => updateMutation.mutate(rowsToItems(rows))}
            />
          </NativeActionBar>
        ) : undefined
      }
    >
      {vaultQuery.isLoading ? <NativeLoadingState label="Loading vault" /> : null}
      {vaultQuery.error ? (
        <NativeErrorState
          message={vaultQuery.error.message}
          onRetry={() => void vaultQuery.refetch()}
        />
      ) : null}

      {!vaultQuery.isLoading && !vaultQuery.error ? (
        <>
          <NativeSection title="Secrets" caption={`${secrets.length}`}>
            <NativeRow
              title="Reveal values"
              subtitle="Show plaintext secret values on this device."
              leading={
                showSecrets ? (
                  <Eye size={18} color={tokens.mutedForeground} />
                ) : (
                  <EyeOff size={18} color={tokens.mutedForeground} />
                )
              }
              trailing={
                <Switch
                  accessibilityLabel="Reveal secret values"
                  value={showSecrets}
                  trackColor={{ true: tokens.primary }}
                  onValueChange={setShowSecrets}
                />
              }
            />
            {secrets.length === 0 ? (
              <NativeRow
                title="No secrets yet"
                subtitle="API keys, tokens, and passwords used by skills and functions."
              />
            ) : null}
            {secrets.map((row) => (
              <NativeRow
                key={row.id}
                title={row.key || "Untitled secret"}
                subtitle={row.value ? (showSecrets ? row.value : SECRET_MASK) : "(empty)"}
                meta={row.runtimeAccess ? undefined : "No runtime"}
                leading={<KeyRound size={18} color={tokens.mutedForeground} />}
                onPress={() => openEdit(row)}
              />
            ))}
            <NativeRow
              title="Add secret"
              leading={<Plus size={18} color={tokens.mutedForeground} />}
              onPress={() => openCreate("secret")}
              last
            />
          </NativeSection>

          <NativeSection title="Variables" caption={`${variables.length}`}>
            {variables.length === 0 ? (
              <NativeRow
                title="No variables yet"
                subtitle="Non-secret config values used by skills and functions."
              />
            ) : null}
            {variables.map((row) => (
              <NativeRow
                key={row.id}
                title={row.key || "Untitled variable"}
                subtitle={row.value || "(empty)"}
                meta={row.runtimeAccess ? undefined : "No runtime"}
                leading={<Variable size={18} color={tokens.mutedForeground} />}
                onPress={() => openEdit(row)}
              />
            ))}
            <NativeRow
              title="Add variable"
              leading={<Plus size={18} color={tokens.mutedForeground} />}
              onPress={() => openCreate("variable")}
              last
            />
          </NativeSection>

          <NativeSection title="Danger zone">
            <NativeRow
              title="Clear vault"
              subtitle="Remove all secrets and variables stored on this server."
              destructive
              leading={<Trash2 size={18} color={tokens.destructive} />}
              onPress={() => setClearConfirmOpen(true)}
              last
            />
          </NativeSection>
        </>
      ) : null}

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
        onClose={closeDraft}
        footer={
          draft ? (
            <NativeActionBar>
              <Button
                label={t.common.save}
                disabled={!draft.row.key.trim()}
                fullWidth
                onPress={commitDraft}
              />
              {!draft.isNew ? (
                <Button
                  label={t.common.delete}
                  variant="destructive"
                  fullWidth
                  leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
                  onPress={removeDraft}
                />
              ) : null}
              <Button label={t.common.cancel} variant="ghost" fullWidth onPress={closeDraft} />
            </NativeActionBar>
          ) : undefined
        }
      >
        {draft ? (
          <View style={styles.formBody}>
            <View style={styles.fullBleedChips}>
              <NativeChipList<VaultItemKind>
                value={draft.row.kind}
                options={KIND_OPTIONS}
                onChange={(kind) => updateDraftRow({ kind })}
              />
            </View>
            <TextInput
              label="Key"
              placeholder="API_KEY"
              autoCapitalize="characters"
              value={draft.row.key}
              onChangeText={(value) => updateDraftRow({ key: value })}
            />
            <TextInput
              label="Value"
              placeholder="Value"
              secureTextEntry={draft.row.kind === "secret" && !showSecrets}
              value={draft.row.value}
              onChangeText={(value) => updateDraftRow({ value })}
            />
            <TextInput
              label="Description (optional)"
              value={draft.row.description}
              onChangeText={(value) => updateDraftRow({ description: value })}
            />
            <View style={styles.switchRow}>
              <Text style={[typography.small, { color: tokens.foreground }]}>
                Available to running functions/skills
              </Text>
              <Switch
                accessibilityLabel="Runtime access"
                value={draft.row.runtimeAccess}
                trackColor={{ true: tokens.primary }}
                onValueChange={(value) => updateDraftRow({ runtimeAccess: value })}
              />
            </View>
          </View>
        ) : null}
      </NativeBottomSheet>

      <NativeBottomSheet
        visible={clearConfirmOpen}
        title="Clear vault?"
        description="This removes every secret and variable stored on this server. This cannot be undone."
        showCloseButton
        onClose={() => setClearConfirmOpen(false)}
        footer={
          <NativeActionBar>
            {clearMutation.error ? (
              <NativeInlineError
                message={clearMutation.error.message}
                onReset={() => clearMutation.reset()}
              />
            ) : null}
            <Button
              label="Clear vault"
              variant="destructive"
              loading={clearMutation.isPending}
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={() => clearMutation.mutate()}
            />
            <Button
              label={t.common.cancel}
              variant="ghost"
              disabled={clearMutation.isPending}
              fullWidth
              onPress={() => setClearConfirmOpen(false)}
            />
          </NativeActionBar>
        }
      />
    </NativeScreen>
  );
}

export default function VaultSettingsScreen() {
  return (
    <ConnectionGuard>
      <VaultSettingsContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  fullBleedChips: { marginHorizontal: -20 },
  formBody: { gap: 12 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
});
