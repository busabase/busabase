import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NodeVO } from "busabase-contract/types";
import { Globe, Lock, Shield, Trash2, Users } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeChipList,
  NativeInlineError,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { fmt, useI18n } from "~/i18n";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

type PermissionLevel = "read" | "changeRequest" | "write" | "manage";

// A minimal flattened view of the cached nodes.list tree, enough to read a
// node's own explicit visibility and walk its ancestors for inheritance.
interface FlatNode {
  id: string;
  parentId: string | null;
  name: string;
  visibility?: "private" | "workspace" | "public";
}

const buildFlatIndex = (
  nodes: NodeVO[] | undefined,
  map: Map<string, FlatNode> = new Map(),
): Map<string, FlatNode> => {
  if (!nodes) return map;
  for (const node of nodes) {
    map.set(node.id, {
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      visibility: node.metadata.visibility,
    });
    buildFlatIndex(node.children, map);
  }
  return map;
};

interface NodePermissionsSheetProps {
  visible: boolean;
  node: NodeVO;
  /** The RAW `nodes.list` tree — used to resolve inherited privacy. */
  nodes: NodeVO[];
  /**
   * The space's DEFAULT content visibility, resolved from `auth.verify` by the
   * caller (the same query that already supplies `spaceId`/`spaceName`). Absent
   * or unknown — an older server that predates the field — means `open`, the
   * historical default.
   */
  spaceVisibilityMode?: "open" | "restricted" | null;
  onClose: () => void;
  onBack: () => void;
}

/**
 * Mobile port of `node-permissions-button.tsx`'s dialog. Access is modeled the
 * way Google Drive / Notion do it: a node inherits its space's default
 * visibility until you explicitly **Restrict access** (make it private), after
 * which only the granted principals (+ space admins) can see it. Inheritance
 * cascades down folders.
 *
 * Deliberately NOT ported from the web dialog, because the seams they hang off
 * are host-injected and the mobile app is not one of those hosts:
 *  - the space-member `<Select>` (cloud injects `members.list`; the core oRPC
 *    contract this app talks to has no such procedure), so granting falls back
 *    to the free-text principal-id input exactly like the open-source host, and
 *    an existing grant lists the raw user id rather than a display name;
 *  - the pending access-requests review section (a cloud-only render slot).
 *
 * The space's Open/Restricted default IS honoured: web reads it from a
 * cloud-only route and injects it through `SpaceVisibilityModeProvider`, which
 * mobile can't reach, so it arrives instead on `auth.verify`'s space VO
 * (`nodeVisibilityMode`) and is passed down as `spaceVisibilityMode`. The
 * banner variant and the grants-section condition then match web exactly —
 * without it a restricted space wrongly read "everyone in this space can see
 * this" and hid the grants list even when grants existed.
 */
export function NodePermissionsSheet({
  visible,
  node,
  nodes,
  spaceVisibilityMode,
  onClose,
  onBack,
}: NodePermissionsSheetProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();

  const principalsQuery = useQuery({
    ...(buda
      ? buda.orpc.nodes.principals.list.queryOptions({ input: { nodeId: node.id } })
      : { queryKey: ["no-connection", "node-principals", node.id], queryFn: skipToken }),
    enabled: visible && !!buda,
  });
  const principals = principalsQuery.data ?? [];

  const flatIndex = useMemo(() => buildFlatIndex(nodes), [nodes]);
  const storedVisibility = flatIndex.get(node.id)?.visibility ?? node.metadata.visibility;
  // Nearest ancestor (excluding self) explicitly set to private — that node
  // structurally hides this one no matter what this node is set to.
  const inheritedPrivateFrom = useMemo(() => {
    const self = flatIndex.get(node.id);
    let cursor = self?.parentId ? flatIndex.get(self.parentId) : undefined;
    while (cursor) {
      if (cursor.visibility === "private") return cursor.name;
      cursor = cursor.parentId ? flatIndex.get(cursor.parentId) : undefined;
    }
    return undefined;
  }, [flatIndex, node.id]);

  // `undefined` = no local override (use the stored value); `null` = an
  // in-flight "inherit" override; a string = an in-flight explicit override.
  const [visibilityOverride, setVisibilityOverride] = useState<
    "private" | "workspace" | "public" | null | undefined
  >(undefined);
  const explicitVisibility =
    visibilityOverride === undefined ? storedVisibility : visibilityOverride;
  const isPrivate = explicitVisibility === "private";
  const isInherited = !isPrivate && !!inheritedPrivateFrom;
  const isRestrictedSpace = spaceVisibilityMode === "restricted";
  // Whether access is actually limited (so granting people is meaningful).
  // Same three-way condition as web's `isLimited`.
  const isLimited = isPrivate || isInherited || isRestrictedSpace;

  const [newPrincipalId, setNewPrincipalId] = useState("");
  const [newPrincipalIsSpace, setNewPrincipalIsSpace] = useState(false);
  const [newRole, setNewRole] = useState<PermissionLevel>("read");

  const invalidatePrincipals = () =>
    queryClient.invalidateQueries({
      queryKey: buda?.orpc.nodes.principals.list.key({ input: { nodeId: node.id } }),
    });

  const visibilityMutation = useMutation({
    mutationFn: async (makePrivate: boolean) => {
      if (!buda) throw new Error(t.common.notConnected);
      const next = makePrivate ? ("private" as const) : null;
      setVisibilityOverride(next);
      await buda.client.nodes.updateVisibility({ nodeId: node.id, visibility: next });
      return next;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: buda?.orpc.nodes.list.key() });
    },
    onError: () => {
      // Revert to the stored value so the switch can't lie about the server.
      setVisibilityOverride(undefined);
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!buda) throw new Error(t.common.notConnected);
      const principalId = newPrincipalIsSpace ? "space" : newPrincipalId.trim();
      if (!principalId) throw new Error(t.permissions.userIdPlaceholder);
      return buda.client.nodes.principals.add({
        nodeId: node.id,
        principalType: newPrincipalIsSpace ? "space" : "user",
        principalId,
        role: newRole,
      });
    },
    onSuccess: async () => {
      setNewPrincipalId("");
      setNewPrincipalIsSpace(false);
      setNewRole("read");
      await invalidatePrincipals();
    },
  });

  const removeMutation = useMutation({
    mutationFn: async ({
      principalType,
      principalId,
    }: {
      principalType: "user" | "team" | "space";
      principalId: string;
    }) => {
      if (!buda) throw new Error(t.common.notConnected);
      return buda.client.nodes.principals.remove({
        nodeId: node.id,
        // The VO can carry `team`, but the endpoint only accepts user/space —
        // same narrowing the web dialog applies.
        principalType: principalType === "team" ? "user" : principalType,
        principalId,
      });
    },
    onSuccess: () => void invalidatePrincipals(),
  });

  const roleLabels: Record<PermissionLevel, string> = {
    read: t.permissions.roleRead,
    changeRequest: t.permissions.roleChangeRequest,
    write: t.permissions.roleWrite,
    manage: t.permissions.roleManage,
  };

  // The effective-access banner text (the resolved reality for a member).
  const accessText = isPrivate
    ? t.permissions.accessPrivate
    : isInherited
      ? fmt(t.permissions.accessInherited, { name: inheritedPrivateFrom ?? "" })
      : isRestrictedSpace
        ? t.permissions.accessRestrictedDefault
        : t.permissions.accessVisibleToAll;

  const actionError =
    visibilityMutation.error?.message ??
    addMutation.error?.message ??
    removeMutation.error?.message ??
    (principalsQuery.error ? principalsQuery.error.message : null);

  const resetErrors = () => {
    visibilityMutation.reset();
    addMutation.reset();
    removeMutation.reset();
  };

  const close = () => {
    resetErrors();
    setNewPrincipalId("");
    setNewPrincipalIsSpace(false);
    setNewRole("read");
    onBack();
  };

  return (
    <NativeBottomSheet
      visible={visible}
      title={t.permissions.title}
      description={node.name}
      showCloseButton
      maxHeight="90%"
      onClose={close}
      footer={
        <NativeActionBar>
          {actionError ? (
            <NativeInlineError
              message={actionError || t.permissions.failed}
              onReset={resetErrors}
            />
          ) : null}
          <Button label={t.common.close} variant="ghost" fullWidth onPress={onClose} />
        </NativeActionBar>
      }
    >
      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
        <View style={[styles.banner, { backgroundColor: tokens.muted }]}>
          {isLimited ? (
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
              {isInherited
                ? fmt(t.permissions.inheritedLockHint, { name: inheritedPrivateFrom ?? "" })
                : t.permissions.makePrivateHint}
            </Text>
          </View>
          <Switch
            value={isPrivate}
            disabled={isInherited || visibilityMutation.isPending}
            trackColor={{ false: tokens.muted, true: tokens.primary }}
            thumbColor={tokens.surface}
            onValueChange={(next) => visibilityMutation.mutate(next)}
          />
        </View>

        {isLimited ? (
          <>
            <NativeSection
              title={t.permissions.peopleHeading}
              caption={principals.length > 0 ? `${principals.length}` : undefined}
              style={styles.section}
            >
              {principalsQuery.isLoading ? (
                <NativeRow title={t.permissions.loadingGrants} last />
              ) : principals.length === 0 ? (
                <NativeRow title={t.permissions.noGrants} last />
              ) : (
                principals.map((principal, index) => (
                  <NativeRow
                    key={principal.id}
                    title={
                      principal.principalType === "space"
                        ? t.permissions.everyone
                        : principal.principalId
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
                        disabled={removeMutation.isPending}
                        hitSlop={mobile.hitSlop}
                        onPress={() =>
                          removeMutation.mutate({
                            principalType: principal.principalType,
                            principalId: principal.principalId,
                          })
                        }
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
                <Text
                  style={[typography.small, styles.grantToggleLabel, { color: tokens.foreground }]}
                >
                  {t.permissions.grantEveryone}
                </Text>
                <Switch
                  value={newPrincipalIsSpace}
                  trackColor={{ false: tokens.muted, true: tokens.primary }}
                  thumbColor={tokens.surface}
                  onValueChange={setNewPrincipalIsSpace}
                />
              </View>
              {newPrincipalIsSpace ? null : (
                <TextInput
                  label={t.permissions.userIdLabel}
                  placeholder={t.permissions.userIdPlaceholder}
                  value={newPrincipalId}
                  onChangeText={setNewPrincipalId}
                />
              )}
              <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                {t.permissions.roleLabel}
              </Text>
              <View style={styles.fullBleedChips}>
                <NativeChipList<PermissionLevel>
                  value={newRole}
                  options={(["read", "changeRequest", "write", "manage"] as const).map((role) => ({
                    value: role,
                    label: roleLabels[role],
                  }))}
                  onChange={setNewRole}
                />
              </View>
              <Button
                label={t.permissions.add}
                variant="secondary"
                loading={addMutation.isPending}
                disabled={!newPrincipalIsSpace && newPrincipalId.trim().length === 0}
                fullWidth
                onPress={() => addMutation.mutate()}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { maxHeight: 420 },
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
  grantToggleLabel: { flex: 1, minWidth: 0 },
  section: { marginHorizontal: 0 },
  grantBlock: { gap: 10, paddingBottom: 8 },
  fullBleedChips: { marginHorizontal: -20 },
});
