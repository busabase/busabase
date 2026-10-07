import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NodeVO } from "busabase-contract/types";
import {
  BUILT_IN_PROMPTS_EXPANDED_STORAGE_KEY,
  buildPromptSections,
  flattenPromptSections,
  resolveActivePrompt,
  splitBuiltInSections,
} from "busabase-core/dashboard/prompt-sections";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NativeActionBar, NativeBottomSheet } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useI18n } from "~/i18n";
import { copyToClipboard } from "~/lib/clipboard";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useNodeCustomPrompts } from "../hooks/use-node-custom-prompts";
import { buildNodeAgentPrompts } from "../utils/node-agent-prompts";

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
 * Mobile port of `node-agent-prompts-dialog.tsx` / `AgentPromptsView`: the
 * per-node copy-paste cheatsheet, driven by the shared node-type registry. Same
 * sectioned list as web — custom scenarios, then built-in scenarios, then each
 * capability group — built by the same `buildPromptSections`, and the same fold:
 * once the node has custom prompts, every built-in section collapses into one
 * "Built-in prompts · N" group (`splitBuiltInSections`), remembered across opens.
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
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  // Only while the sheet is open: these belong to one node, and a closed sheet
  // has no reason to hold a request for it.
  const customPrompts = useNodeCustomPrompts({ nodeId: node.id, enabled: visible });

  const { scenarios, capabilities } = useMemo(
    () =>
      buildNodeAgentPrompts(
        {
          nodeType: node.type,
          nodeName: node.name,
          nodeId: node.id,
          spaceId: spaceId ?? undefined,
          spaceName: spaceName ?? undefined,
          // Appended after the type's built-in scenarios by the shared builder,
          // so a product update never displaces what someone configured — and
          // an absent value renders exactly the built-ins, which is what this
          // sheet showed before.
          customPrompts,
        },
        locale,
      ),
    [node.type, node.name, node.id, spaceId, spaceName, locale, customPrompts],
  );

  const sections = useMemo(
    () =>
      buildPromptSections(scenarios, capabilities, {
        builtIn: t.agentPrompts.scenariosTab,
        custom: t.agentPrompts.customScenarios,
      }),
    [scenarios, capabilities, t],
  );
  const {
    custom: customSections,
    builtIn: builtInSections,
    collapsible,
  } = splitBuiltInSections(sections);
  const active = resolveActivePrompt(sections, selected);

  // Same remembered preference web keeps in localStorage, under the same key.
  const [builtInsExpanded, setBuiltInsExpanded] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(BUILT_IN_PROMPTS_EXPANDED_STORAGE_KEY)
      .then((value) => setBuiltInsExpanded(value === "1"))
      .catch(() => undefined);
  }, []);
  const builtInCount = flattenPromptSections(builtInSections).length;
  const activeIsBuiltIn =
    active !== undefined &&
    builtInSections.some((section) => section.items.some((prompt) => prompt.key === active.key));
  // A selected built-in is never hidden: the preview below must always have its
  // row in the list.
  const builtInsOpen = !collapsible || builtInsExpanded || activeIsBuiltIn;

  const toggleBuiltIns = () => {
    const next = !builtInsOpen;
    setBuiltInsExpanded(next);
    AsyncStorage.setItem(BUILT_IN_PROMPTS_EXPANDED_STORAGE_KEY, next ? "1" : "0").catch(
      () => undefined,
    );
    // Collapsing over the selected built-in would orphan the preview; hand the
    // selection back to the first custom prompt instead, as web does.
    if (!next && activeIsBuiltIn) {
      setSelected(flattenPromptSections(customSections)[0]?.key ?? null);
      setCopied(false);
      setCopyFailed(false);
    }
  };

  const renderSection = (section: (typeof sections)[number]) => (
    <View key={`${section.source}:${section.name}`}>
      <Text style={[styles.groupHeading, typography.caption, { color: tokens.mutedForeground }]}>
        {section.name}
      </Text>
      {section.items.map((prompt) => {
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
  );

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

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {(collapsible ? customSections : sections).map(renderSection)}
        {collapsible ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: builtInsOpen }}
              style={({ pressed }) => [styles.foldRow, { opacity: pressed ? 0.72 : 1 }]}
              onPress={toggleBuiltIns}
            >
              {builtInsOpen ? (
                <ChevronDown size={16} color={tokens.mutedForeground} />
              ) : (
                <ChevronRight size={16} color={tokens.mutedForeground} />
              )}
              <Text style={[typography.bodyEm, { color: tokens.mutedForeground }]}>
                {t.agentPrompts.builtInPrompts} · {builtInCount}
              </Text>
            </Pressable>
            {builtInsOpen ? builtInSections.map(renderSection) : null}
          </>
        ) : null}
      </ScrollView>

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
  list: { maxHeight: 240 },
  groupHeading: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4 },
  foldRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    marginTop: 6,
  },
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
