import { useMutation } from "@tanstack/react-query";
import type { CreatableNodeType } from "busabase-contract/domains";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { fmt, useI18n } from "~/i18n";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeChipList,
  NativeInlineError,
} from "../native-screen";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const NODE_TYPES: CreatableNodeType[] = ["base", "folder", "doc", "skill", "drive"];

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
    drive: t.createNode.drive,
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
    <NativeBottomSheet
      visible={visible}
      title={t.createNode.title}
      description={t.createNode.reviewNote}
      showCloseButton
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
            label={fmt(t.createNode.submit, { type: typeLabel[nodeType] })}
            loading={createMutation.isPending}
            disabled={name.trim().length === 0}
            fullWidth
            onPress={() => createMutation.mutate()}
          />
          <Button label={t.common.cancel} variant="ghost" fullWidth onPress={close} />
        </NativeActionBar>
      }
    >
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>
        {t.createNode.typeLabel}
      </Text>
      <View style={styles.fullBleedChips}>
        <NativeChipList<CreatableNodeType>
          value={nodeType}
          options={NODE_TYPES.map((type) => ({ value: type, label: typeLabel[type] }))}
          onChange={setNodeType}
        />
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
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  fullBleedChips: { marginHorizontal: -20 },
});
