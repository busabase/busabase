import { useMutation } from "@tanstack/react-query";
import { type CreatableNodeType, listNodeTypes } from "busabase-contract/domains";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeActionBar, NativeBottomSheet, NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { fmt, useI18n } from "~/i18n";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { nodeIconForType } from "./node-icons";

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Node types whose creation needs a platform capability this sheet does not
 * have. `file` is creatable over the API, but the node is meaningless without
 * an uploaded Asset behind it — web's dialog therefore ships a file input and
 * keeps its submit button disabled until one is picked. There is no document
 * picker here, so offering `file` could only ever produce an empty file node.
 * A single named exception, NOT a hardcoded allowlist: everything else still
 * comes straight from the registry.
 */
const UNSUPPORTED_TYPES = new Set<string>(["file"]);

/**
 * The creatable types, composed from the registry exactly like web's
 * `create-node-modal.tsx` — registering a creatable node type makes it appear
 * here automatically, so mobile stops silently lagging behind the registry.
 * `hidden` types are excluded so they have no visible entry point even though
 * they stay creatable over the API.
 */
const NODE_TYPES = listNodeTypes()
  .filter(
    (definition) =>
      definition.capabilities.creatable &&
      !definition.capabilities.hidden &&
      !UNSUPPORTED_TYPES.has(definition.type),
  )
  .map((definition) => ({
    type: definition.type as CreatableNodeType,
    /** Registry label — the fallback when a locale has no name for this type. */
    fallbackLabel: definition.label,
  }));

// Base stays the default: it is by far the most-created type on mobile, and
// unlike web (which just takes the registry's first entry) this sheet has
// always opened on it.
const DEFAULT_NODE_TYPE: CreatableNodeType = "base";

interface CreateNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (changeRequestId: string) => void;
  /**
   * When opened from a container node's "•••" sheet, the new node is created
   * inside it (web passes the same shape from its per-folder "+"). Omitted at
   * the space root — e.g. the drawer header's Create button and the
   * empty-workspace guide's CTA, where root is the right destination.
   */
  parent?: { id: string; name: string } | null;
}

export function CreateNodeModal({ visible, onClose, onCreated, parent }: CreateNodeModalProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const [nodeType, setNodeType] = useState<CreatableNodeType>(DEFAULT_NODE_TYPE);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");

  const typeNames: Record<string, string> = t.nodeTypeNames;
  const labelFor = (entry: (typeof NODE_TYPES)[number]) =>
    typeNames[entry.type] ?? entry.fallbackLabel;
  const activeEntry = NODE_TYPES.find((entry) => entry.type === nodeType);
  const activeLabel = activeEntry ? labelFor(activeEntry) : nodeType;

  const reset = () => {
    setNodeType(DEFAULT_NODE_TYPE);
    setName("");
    setSlug("");
    setSlugEdited(false);
    setDescription("");
  };

  const close = () => {
    reset();
    onClose();
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      const finalSlug = (slugEdited ? slug : toSlug(trimmedName)).trim();
      if (!buda || !trimmedName || !finalSlug) throw new Error(t.createNode.nameRequired);
      return buda.client.nodes.createChangeRequest({
        message: `Create ${activeLabel} ${trimmedName}`,
        operations: [
          {
            kind: "create",
            nodeType,
            // Omitted (not `undefined`-safe-but-present) at the root, so the
            // server keeps its "create at space root" path.
            ...(parent ? { parentNodeId: parent.id } : {}),
            slug: finalSlug,
            name: trimmedName,
            description: description.trim(),
            // A base needs at least one field; start with a Title the user can build on.
            ...(nodeType === "base"
              ? {
                  fields: [{ slug: "title", name: "Title", type: "text" as const, required: true }],
                }
              : {}),
          },
        ],
      });
    },
    onSuccess: (changeRequest) => {
      reset();
      onCreated(changeRequest.id);
    },
  });

  return (
    <NativeBottomSheet
      visible={visible}
      title={fmt(t.createNode.title, {
        suffix: parent ? fmt(t.createNode.parentSuffix, { name: parent.name }) : "",
      })}
      description={
        parent
          ? fmt(t.createNode.reviewNoteInParent, { name: parent.name })
          : t.createNode.reviewNote
      }
      showCloseButton
      maxHeight="90%"
      onClose={close}
      footer={
        <NativeActionBar>
          {createMutation.error ? (
            <NativeInlineError
              message={createMutation.error.message}
              onReset={() => createMutation.reset()}
            />
          ) : null}
          <Button
            label={fmt(t.createNode.submit, { type: activeLabel })}
            loading={createMutation.isPending}
            disabled={name.trim().length === 0}
            fullWidth
            onPress={() => createMutation.mutate()}
          />
          <Button label={t.common.cancel} variant="ghost" fullWidth onPress={close} />
        </NativeActionBar>
      }
    >
      <ScrollView
        style={styles.formScroll}
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          {t.createNode.typeLabel}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.typeScroll}
          contentContainerStyle={styles.typeRow}
        >
          {NODE_TYPES.map((entry) => {
            const selected = entry.type === nodeType;
            const Icon = nodeIconForType(entry.type);
            return (
              <Pressable
                key={entry.type}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.typeOption,
                  {
                    backgroundColor: selected ? tokens.primaryMuted : tokens.surface,
                    borderColor: selected ? tokens.primary : tokens.border,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
                onPress={() => setNodeType(entry.type)}
              >
                <Icon size={17} color={selected ? tokens.foreground : tokens.mutedForeground} />
                <Text
                  numberOfLines={1}
                  style={[
                    typography.small,
                    { color: selected ? tokens.foreground : tokens.mutedForeground },
                  ]}
                >
                  {labelFor(entry)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <TextInput
          label={t.createNode.name}
          value={name}
          onChangeText={(value) => {
            setName(value);
            if (!slugEdited) {
              setSlug(toSlug(value));
            }
          }}
        />
        <TextInput
          label={t.createNode.slug}
          value={slug}
          onChangeText={(value) => {
            setSlugEdited(true);
            setSlug(toSlug(value));
          }}
        />
        <TextInput
          label={t.createNode.description}
          value={description}
          onChangeText={setDescription}
        />
      </ScrollView>
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  formScroll: { flexGrow: 0 },
  form: { gap: 12, paddingBottom: 4 },
  typeScroll: { flexGrow: 0, marginHorizontal: -spacing[5] },
  typeRow: { paddingHorizontal: spacing[5], gap: 8 },
  typeOption: {
    minHeight: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
});
