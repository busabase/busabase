import { useMutation } from "@tanstack/react-query";
import type { NodeType } from "busabase-contract/types";
import { Bot, FileText, Folder, Table2, X } from "lucide-react-native";
import { type ComponentType, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { fmt, useI18n } from "~/i18n";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

type CreatableNodeType = Extract<NodeType, "base" | "folder" | "doc" | "skill">;

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const NODE_TYPES: Array<{
  type: CreatableNodeType;
  icon: ComponentType<{ size?: number; color?: string }>;
}> = [
  { type: "base", icon: Table2 },
  { type: "folder", icon: Folder },
  { type: "doc", icon: FileText },
  { type: "skill", icon: Bot },
];

interface CreateNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (changeRequestId: string) => void;
}

export function CreateNodeModal({ visible, onClose, onCreated }: CreateNodeModalProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const [nodeType, setNodeType] = useState<CreatableNodeType>("base");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");

  const typeLabel: Record<CreatableNodeType, string> = {
    base: t.createNode.base,
    folder: t.createNode.folder,
    doc: t.createNode.doc,
    skill: t.createNode.skill,
  };

  const reset = () => {
    setNodeType("base");
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
        message: `Create ${typeLabel[nodeType]} ${trimmedName}`,
        operations: [
          {
            kind: "create",
            nodeType,
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
    <Modal animationType="fade" transparent visible={visible} onRequestClose={close}>
      <View style={styles.backdrop}>
        <View
          style={[styles.sheet, { backgroundColor: tokens.surface, borderColor: tokens.border }]}
        >
          <View style={styles.header}>
            <Text style={[typography.h2, { color: tokens.foreground }]}>{t.createNode.title}</Text>
            <Pressable hitSlop={mobile.hitSlop} onPress={close}>
              <X size={22} color={tokens.foreground} />
            </Pressable>
          </View>
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            {t.createNode.reviewNote}
          </Text>

          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            {t.createNode.typeLabel}
          </Text>
          <View style={styles.types}>
            {NODE_TYPES.map(({ type, icon: Icon }) => {
              const active = type === nodeType;
              return (
                <Pressable
                  key={type}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor: active ? tokens.primaryMuted : tokens.surface,
                      borderColor: active ? tokens.primary : tokens.border,
                    },
                  ]}
                  onPress={() => setNodeType(type)}
                >
                  <Icon size={16} color={active ? tokens.primary : tokens.mutedForeground} />
                  <Text
                    style={[
                      typography.small,
                      { color: active ? tokens.foreground : tokens.mutedForeground },
                    ]}
                  >
                    {typeLabel[type]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            label={t.createNode.name}
            value={name}
            autoFocus
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
          {createMutation.error ? (
            <Text style={[typography.small, { color: tokens.destructive }]}>
              {createMutation.error.message}
            </Text>
          ) : null}

          <Button
            label={fmt(t.createNode.submit, { type: typeLabel[nodeType] })}
            loading={createMutation.isPending}
            disabled={name.trim().length === 0}
            fullWidth
            onPress={() => createMutation.mutate()}
          />
          <Button label={t.common.cancel} variant="ghost" fullWidth onPress={close} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.38)",
    justifyContent: "center",
    padding: 20,
  },
  sheet: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 20,
    gap: 12,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  types: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
