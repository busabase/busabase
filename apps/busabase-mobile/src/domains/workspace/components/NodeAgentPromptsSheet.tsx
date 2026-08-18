import type { NodeVO } from "busabase-contract/types";
import { Check, Copy } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeSegmentedControl,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useI18n } from "~/i18n";
import { copyToClipboard } from "~/lib/clipboard";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { buildNodeAgentPrompts, type NodePrompt } from "../utils/node-agent-prompts";

type Tab = "scenarios" | "capabilities";

interface NodeAgentPromptsSheetProps {
  visible: boolean;
  node: NodeVO;
  /** Resolved from `auth.verify` by the caller; the prompts name it as the target. */
  spaceId?: string | null;
  spaceName?: string | null;
  onClose: () => void;
  onBack: () => void;
}

/**
 * Mobile port of `node-agent-prompts-dialog.tsx`: the per-node copy-paste
 * cheatsheet, driven by the shared node-type registry. Same two tiers and same
 * selection semantics as web — selection is scoped to the visible tab, so the
 * preview always comes from the list you're looking at.
 *
 * Layout differs by necessity: web puts the list and the preview side by side in
 * a 3xl dialog. A phone has one column, so the list sits above the preview and
 * both scroll independently. The preview is `selectable` so the prompt is still
 * recoverable by hand on a build where the clipboard is unavailable — in which
 * case `copyToClipboard` returns false and the sheet says so instead of showing
 * a "Copied" state that never happened.
 */
export function NodeAgentPromptsSheet({
  visible,
  node,
  spaceId,
  spaceName,
  onClose,
  onBack,
}: NodeAgentPromptsSheetProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const { scenarios, capabilities } = useMemo(
    () =>
      buildNodeAgentPrompts(
        {
          nodeType: node.type,
          nodeName: node.name,
          nodeId: node.id,
          spaceId,
          spaceName,
        },
        t,
      ),
    [node.type, node.name, node.id, spaceId, spaceName, t],
  );

  // Open on Scenarios when the type has any, else straight to Capabilities.
  const [tab, setTab] = useState<Tab>(scenarios.length > 0 ? "scenarios" : "capabilities");

  const visiblePrompts = tab === "scenarios" ? scenarios : capabilities;
  const active = visiblePrompts.find((prompt) => prompt.key === selected) ?? visiblePrompts[0];

  // Capabilities bucket under group headings; scenarios are a flat list.
  const groups = useMemo(() => {
    if (tab === "scenarios") return [{ name: null as string | null, items: scenarios }];
    const byName = new Map<string, NodePrompt[]>();
    for (const prompt of capabilities) {
      const bucket = byName.get(prompt.group);
      if (bucket) bucket.push(prompt);
      else byName.set(prompt.group, [prompt]);
    }
    return [...byName.entries()].map(([name, items]) => ({ name, items }));
  }, [tab, scenarios, capabilities]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setSelected(null); // fall back to the new tab's own first entry
    setCopied(false);
    setCopyFailed(false);
  };

  const copy = async () => {
    if (!active) return;
    const ok = await copyToClipboard(active.body);
    setCopied(ok);
    setCopyFailed(!ok);
  };

  const close = () => {
    setSelected(null);
    setCopied(false);
    setCopyFailed(false);
    onBack();
  };

  return (
    <NativeBottomSheet
      visible={visible}
      title={t.agentPrompts.title}
      description={node.name}
      showCloseButton
      maxHeight="90%"
      onClose={close}
      footer={
        <NativeActionBar>
          {copyFailed ? (
            <Text style={[typography.small, { color: tokens.destructive }]}>
              {t.agentPrompts.copyUnavailable}
            </Text>
          ) : null}
          <Button
            label={copied ? t.agentPrompts.copied : t.agentPrompts.copy}
            leadingIcon={
              copied ? (
                <Check size={16} color={tokens.primaryForeground} />
              ) : (
                <Copy size={16} color={tokens.primaryForeground} />
              )
            }
            disabled={!active}
            fullWidth
            onPress={() => void copy()}
          />
          {/* Same split as NodePermissionsSheet: the header X steps BACK to the
              "•••" menu, this button dismisses the whole flow. */}
          <Button label={t.common.close} variant="ghost" fullWidth onPress={onClose} />
        </NativeActionBar>
      }
    >
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>
        {t.agentPrompts.intro}
      </Text>

      <NativeSegmentedControl<Tab>
        value={tab}
        options={[
          {
            value: "scenarios",
            label: t.agentPrompts.scenariosTab,
            meta: scenarios.length > 0 ? scenarios.length : undefined,
          },
          {
            value: "capabilities",
            label: t.agentPrompts.capabilitiesTab,
            meta: capabilities.length,
          },
        ]}
        onChange={switchTab}
      />

      {tab === "scenarios" && scenarios.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: tokens.muted }]}>
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            {t.agentPrompts.scenariosEmpty}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {groups.map((group) => (
            <View key={group.name ?? "_"}>
              {group.name ? (
                <Text
                  style={[
                    styles.groupHeading,
                    typography.caption,
                    { color: tokens.mutedForeground },
                  ]}
                >
                  {group.name}
                </Text>
              ) : null}
              {group.items.map((prompt) => {
                const isActive = active?.key === prompt.key;
                return (
                  <Pressable
                    key={prompt.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    style={({ pressed }) => [
                      styles.promptRow,
                      {
                        backgroundColor: isActive ? tokens.primaryMuted : "transparent",
                        opacity: pressed ? 0.72 : 1,
                      },
                    ]}
                    onPress={() => {
                      setSelected(prompt.key);
                      setCopied(false);
                      setCopyFailed(false);
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        isActive ? typography.bodyEm : typography.body,
                        { color: isActive ? tokens.foreground : tokens.mutedForeground },
                      ]}
                    >
                      {prompt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}

      {active ? (
        <ScrollView
          style={[styles.preview, { backgroundColor: tokens.muted, borderColor: tokens.border }]}
        >
          <Text selectable style={[typography.small, { color: tokens.foreground }]}>
            {active.body}
          </Text>
        </ScrollView>
      ) : null}
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  empty: { borderRadius: radius.md, padding: 14 },
  list: { maxHeight: 190 },
  groupHeading: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4 },
  promptRow: {
    minHeight: 40,
    justifyContent: "center",
    borderRadius: radius.md,
    paddingHorizontal: 10,
  },
  preview: {
    maxHeight: 200,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
  },
});
