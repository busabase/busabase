import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NodeVO } from "busabase-contract/types";
import { Check, Copy } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeActionItem,
  NativeActionRow,
  NativeBottomSheet,
  NativeInlineError,
  NativeSegmentedControl,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { fmt, useI18n } from "~/i18n";
import { copyToClipboard } from "~/lib/clipboard";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

type ShareCapability = "read" | "submit";
type ExpiryPreset = "never" | "day" | "week" | "month";

const EXPIRY_MS: Record<Exclude<ExpiryPreset, "never">, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

interface NodeShareSheetProps {
  visible: boolean;
  node: NodeVO;
  /**
   * Resolved from `auth.verify` by the caller. The canonical public URL is
   * `/dashboard/<spaceId>/<type>/<slug>` on both the self-hosted app and Cloud,
   * so without it there is a share setting but no link to hand out.
   */
  spaceId?: string | null;
  onClose: () => void;
  onBack: () => void;
}

/**
 * Mobile port of `NodeShareDialog` (node-share-button.tsx). The orthogonal axis
 * to NodePermissionsSheet: that one governs which space members may see a node,
 * this one governs whether an ANONYMOUS visitor may reach it over its own
 * canonical URL, and what they may do there — optionally behind a password
 * and/or an expiry.
 *
 * Two deliberate departures from web, both forced by the platform:
 *  - **Expiry** is a set of presets (24 hours / 7 days / 30 days / Never) rather
 *    than web's free `datetime-local` input, which has no touch equivalent
 *    without pulling in a date-picker dependency. The stored expiry is always
 *    shown as an exact date underneath, so nothing is hidden.
 *  - **Copying** goes through `copyToClipboard`, which can legitimately fail (see
 *    that helper). The link is rendered as selectable text either way, and the
 *    button only claims "Copied" when the write actually succeeded.
 */
export function NodeShareSheet({ visible, node, spaceId, onClose, onBack }: NodeShareSheetProps) {
  const tokens = useTokens();
  const { t, locale } = useI18n();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const [passwordDraft, setPasswordDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const shareQuery = useQuery({
    ...(buda
      ? buda.orpc.nodes.share.get.queryOptions({ input: { nodeId: node.id } })
      : { queryKey: ["no-connection", "node-share", node.id], queryFn: skipToken }),
    enabled: visible && !!buda,
  });
  const share = shareQuery.data ?? null;
  const isPublic = share?.scope === "public";

  const publicUrl =
    buda?.serverUrl && spaceId
      ? `${buda.serverUrl.replace(/\/+$/, "")}/dashboard/${spaceId}/${node.type}/${node.slug}`
      : null;

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: buda?.orpc.nodes.share.get.key({ input: { nodeId: node.id } }),
    });

  // One mutation for every write: `nodes.share.set` is the single endpoint web
  // drives the toggle, capability, password and expiry through, and each call
  // carries only the field it changes (the server leaves the rest alone).
  const setShare = useMutation({
    mutationFn: async (input: {
      scope: "none" | "public";
      capability?: ShareCapability;
      password?: string | null;
      expiresAt?: string | null;
    }) => {
      if (!buda) throw new Error(t.common.notConnected);
      return buda.client.nodes.share.set({ nodeId: node.id, ...input });
    },
    onSuccess: async () => {
      setPasswordDraft("");
      await invalidate();
    },
  });

  const copyLink = async () => {
    if (!publicUrl) return;
    const ok = await copyToClipboard(publicUrl);
    setCopied(ok);
    setCopyFailed(!ok);
  };

  const applyExpiry = (preset: ExpiryPreset) => {
    const expiresAt =
      preset === "never" ? null : new Date(Date.now() + EXPIRY_MS[preset]).toISOString();
    setShare.mutate({ scope: "public", expiresAt });
  };

  const expiryDate = share?.expiresAt ? new Date(share.expiresAt) : null;
  const expiryText =
    expiryDate && !Number.isNaN(expiryDate.getTime())
      ? fmt(t.share.expiresOn, { date: expiryDate.toLocaleString(locale) })
      : t.share.expiryHint;

  const busy = setShare.isPending;

  const close = () => {
    if (busy) return;
    setShare.reset();
    setPasswordDraft("");
    setCopied(false);
    setCopyFailed(false);
    onBack();
  };

  const error = setShare.error?.message ?? shareQuery.error?.message ?? null;

  return (
    <NativeBottomSheet
      visible={visible}
      title={t.share.title}
      description={node.name}
      showCloseButton
      maxHeight="90%"
      onClose={close}
      footer={
        <NativeActionBar>
          {error ? (
            <NativeInlineError message={error || t.share.failed} onReset={() => setShare.reset()} />
          ) : null}
          {/* Same split as NodePermissionsSheet: the header X steps BACK to the
              "•••" menu, this button dismisses the whole flow. */}
          <Button label={t.common.close} variant="ghost" fullWidth onPress={onClose} />
        </NativeActionBar>
      }
    >
      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
              {t.share.shareToWeb}
            </Text>
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>
              {isPublic ? t.share.enabled : t.share.shareToWebHint}
            </Text>
          </View>
          <Switch
            accessibilityLabel={t.share.shareToWeb}
            value={isPublic}
            disabled={busy || shareQuery.isLoading}
            trackColor={{ false: tokens.muted, true: tokens.primary }}
            thumbColor={tokens.surface}
            onValueChange={(next) => setShare.mutate({ scope: next ? "public" : "none" })}
          />
        </View>

        {isPublic ? (
          <View style={[styles.details, { borderColor: tokens.border }]}>
            <View style={styles.block}>
              <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                {t.share.capabilityLabel}
              </Text>
              <NativeSegmentedControl<ShareCapability>
                value={share?.capability ?? "read"}
                options={[
                  { value: "read", label: t.share.capabilityRead },
                  { value: "submit", label: t.share.capabilitySubmit },
                ]}
                onChange={(capability) => setShare.mutate({ scope: "public", capability })}
              />
            </View>

            <View style={styles.block}>
              <TextInput
                label={t.share.passwordLabel}
                placeholder={t.share.passwordPlaceholder}
                secureTextEntry
                value={passwordDraft}
                onChangeText={setPasswordDraft}
              />
              <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                {share?.hasPassword ? t.share.passwordSet : t.share.passwordHint}
              </Text>
              <Button
                label={t.share.passwordSave}
                variant="secondary"
                disabled={busy || passwordDraft.trim().length === 0}
                fullWidth
                onPress={() => setShare.mutate({ scope: "public", password: passwordDraft })}
              />
              {share?.hasPassword ? (
                <Button
                  label={t.share.passwordClear}
                  variant="ghost"
                  disabled={busy}
                  fullWidth
                  onPress={() => setShare.mutate({ scope: "public", password: null })}
                />
              ) : null}
            </View>

            <View style={styles.block}>
              <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                {t.share.expiryLabel}
              </Text>
              {/* Actions, not a selection: a stored expiry is an exact instant,
                  never one of three presets, so rendering these as a segmented
                  control would have to lie about which one is "current". The
                  server's real value is spelled out underneath instead. */}
              <NativeActionRow>
                {(["day", "week", "month"] as const).map((preset) => (
                  <NativeActionItem key={preset}>
                    <Button
                      label={
                        preset === "day"
                          ? t.share.expiryDay
                          : preset === "week"
                            ? t.share.expiryWeek
                            : t.share.expiryMonth
                      }
                      variant="secondary"
                      disabled={busy}
                      fullWidth
                      onPress={() => applyExpiry(preset)}
                    />
                  </NativeActionItem>
                ))}
              </NativeActionRow>
              <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                {expiryText}
              </Text>
              {share?.expiresAt ? (
                <Button
                  label={t.share.expiryNever}
                  variant="ghost"
                  disabled={busy}
                  fullWidth
                  onPress={() => applyExpiry("never")}
                />
              ) : null}
            </View>

            <View style={styles.block}>
              <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                {t.share.linkLabel}
              </Text>
              {publicUrl ? (
                <>
                  <Text
                    selectable
                    style={[
                      typography.small,
                      styles.link,
                      { backgroundColor: tokens.muted, color: tokens.foreground },
                    ]}
                  >
                    {publicUrl}
                  </Text>
                  <Button
                    label={copied ? t.share.linkCopied : t.share.copyLink}
                    variant="secondary"
                    leadingIcon={
                      copied ? (
                        <Check size={16} color={tokens.foreground} />
                      ) : (
                        <Copy size={16} color={tokens.foreground} />
                      )
                    }
                    fullWidth
                    onPress={() => void copyLink()}
                  />
                  {copyFailed ? (
                    <Text style={[typography.small, { color: tokens.destructive }]}>
                      {t.share.copyUnavailable}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                  {t.share.linkUnavailable}
                </Text>
              )}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { maxHeight: 460 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
  },
  toggleText: { flex: 1, minWidth: 0, gap: 2 },
  details: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, gap: 18 },
  block: { gap: 8 },
  link: { borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
});
