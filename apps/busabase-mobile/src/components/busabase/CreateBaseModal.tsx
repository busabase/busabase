import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

interface CreateBaseModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (changeRequestId: string) => void;
}

export function CreateBaseModal({ visible, onClose, onCreated }: CreateBaseModalProps) {
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");

  const reset = () => {
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
      if (!buda || !trimmedName || !finalSlug) throw new Error("Name is required.");
      // Base creation goes through review: a node change request that
      // materializes the Base on merge.
      return buda.client.nodes.createChangeRequest({
        message: `Create Base ${trimmedName}`,
        operations: [
          {
            kind: "create",
            nodeType: "base",
            slug: finalSlug,
            name: trimmedName,
            description: description.trim(),
            // A base needs at least one field; start with a Title the user can build on.
            fields: [{ slug: "title", name: "Title", type: "text", required: true }],
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
            <Text style={[typography.h2, { color: tokens.foreground }]}>New Base</Text>
            <Pressable hitSlop={mobile.hitSlop} onPress={close}>
              <X size={22} color={tokens.foreground} />
            </Pressable>
          </View>
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            Creates a change request for review. The Base appears after it's merged, starting with a
            Title field.
          </Text>

          <TextInput
            label="Name"
            value={name}
            autoFocus
            placeholder="Blog Posts"
            onChangeText={(value) => {
              setName(value);
              if (!slugEdited) {
                setSlug(toSlug(value));
              }
            }}
          />
          <TextInput
            label="Slug"
            value={slug}
            placeholder="blog-posts"
            onChangeText={(value) => {
              setSlugEdited(true);
              setSlug(toSlug(value));
            }}
          />
          <TextInput
            label="Description (optional)"
            value={description}
            placeholder="What this Base collects"
            onChangeText={setDescription}
          />
          {createMutation.error ? (
            <Text style={[typography.small, { color: tokens.destructive }]}>
              {createMutation.error.message}
            </Text>
          ) : null}

          <Button
            label="Create Base"
            loading={createMutation.isPending}
            disabled={name.trim().length === 0}
            fullWidth
            onPress={() => createMutation.mutate()}
          />
          <Button label="Cancel" variant="ghost" fullWidth onPress={close} />
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
