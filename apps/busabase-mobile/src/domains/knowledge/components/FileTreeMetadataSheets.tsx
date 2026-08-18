import { Settings2 } from "lucide-react-native";
import { ScrollView, StyleSheet, Text } from "react-native";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeChipList,
  NativeInlineError,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { FileTreeVisibility, MetadataDraft } from "../types/file-tree";
import { visibilityOptions } from "../utils/file-tree";

interface FileTreeMetadataSheetsProps {
  entityLabel: "Drive" | "Skill";
  draft: MetadataDraft | null;
  saving: boolean;
  canSubmit: boolean;
  actionError: string | null;
  message: string;
  messagePlaceholder: string;
  discardVisible: boolean;
  onClose: () => void;
  onClearError: () => void;
  onMessageChange: (message: string) => void;
  onVisibilityChange: (visibility: FileTreeVisibility) => void;
  onVersionChange: (version: string) => void;
  onEntryFileChange: (entryFile: string) => void;
  onSubmit: () => void;
  onCloseDiscard: () => void;
  onDiscard: () => void;
}

export function FileTreeMetadataSheets({
  entityLabel,
  draft,
  saving,
  canSubmit,
  actionError,
  message,
  messagePlaceholder,
  discardVisible,
  onClose,
  onClearError,
  onMessageChange,
  onVisibilityChange,
  onVersionChange,
  onEntryFileChange,
  onSubmit,
  onCloseDiscard,
  onDiscard,
}: FileTreeMetadataSheetsProps) {
  const tokens = useTokens();

  return (
    <>
      <NativeBottomSheet
        visible={!!draft && !discardVisible}
        title={`${entityLabel} settings`}
        description="Create a change request for file tree metadata. Changes apply after review and merge."
        maxHeight="78%"
        showCloseButton
        onClose={onClose}
        footer={
          <NativeActionBar>
            {actionError ? (
              <NativeInlineError message={actionError} onReset={onClearError} />
            ) : null}
            <Button
              label="Create settings change request"
              loading={saving}
              disabled={saving || !canSubmit}
              fullWidth
              leadingIcon={<Settings2 size={18} color={tokens.primaryForeground} />}
              onPress={onSubmit}
            />
            <Button label="Cancel" variant="ghost" disabled={saving} fullWidth onPress={onClose} />
          </NativeActionBar>
        }
      >
        {draft ? (
          <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
            <TextInput
              label="Change request message"
              value={message}
              placeholder={messagePlaceholder}
              onChangeText={onMessageChange}
            />
            <Text style={[typography.caption, { color: tokens.mutedForeground }]}>Visibility</Text>
            <NativeChipList<FileTreeVisibility>
              value={draft.visibility}
              options={visibilityOptions}
              onChange={onVisibilityChange}
            />
            <TextInput
              label="Version"
              value={draft.version}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="0.1.0"
              onChangeText={onVersionChange}
            />
            <TextInput
              label="Entry file"
              value={draft.entryFile}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="README.md"
              onChangeText={onEntryFileChange}
            />
          </ScrollView>
        ) : null}
      </NativeBottomSheet>

      <NativeBottomSheet
        visible={discardVisible}
        title="Discard settings changes?"
        description={`This closes the ${entityLabel.toLowerCase()} settings editor and removes the unsaved metadata and message.`}
        showCloseButton
        onClose={onCloseDiscard}
        footer={
          <NativeActionBar>
            <Button label="Discard changes" variant="destructive" fullWidth onPress={onDiscard} />
            <Button label="Keep editing" variant="ghost" fullWidth onPress={onCloseDiscard} />
          </NativeActionBar>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  modalBody: { marginHorizontal: -2 },
  modalBodyContent: { paddingBottom: 12, gap: 12 },
});
