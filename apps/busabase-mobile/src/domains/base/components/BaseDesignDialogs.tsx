import { Trash2 } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { NativeActionBar, NativeBottomSheet, NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { useTokens } from "~/theme/use-tokens";
import type { BaseDesignController } from "../hooks/use-base-design-controller";

export function BaseDesignDialogs({ controller }: { controller: BaseDesignController }) {
  const tokens = useTokens();
  const createMutation = controller.createViewMutation;
  const deleteMutation = controller.deleteViewMutation;
  return (
    <>
      <NativeBottomSheet
        visible={controller.viewSheetOpen}
        title="New view"
        showCloseButton
        onClose={() => controller.setViewSheetOpen(false)}
        footer={
          <NativeActionBar>
            {createMutation.error ? (
              <NativeInlineError
                message={createMutation.error.message}
                onReset={createMutation.reset}
              />
            ) : null}
            <Button
              label="Create view change request"
              loading={createMutation.isPending}
              disabled={controller.viewName.trim().length === 0}
              fullWidth
              onPress={() => createMutation.mutate()}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={createMutation.isPending}
              fullWidth
              onPress={() => controller.setViewSheetOpen(false)}
            />
          </NativeActionBar>
        }
      >
        <View style={styles.form}>
          <TextInput
            label="View name"
            value={controller.viewName}
            onChangeText={controller.setViewName}
          />
        </View>
      </NativeBottomSheet>

      <NativeBottomSheet
        visible={!!controller.viewPendingDelete}
        title="View actions"
        description={
          controller.viewPendingDelete
            ? `${controller.viewPendingDelete.name} · Create a change request before deleting.`
            : undefined
        }
        showCloseButton
        onClose={() => controller.setViewPendingDelete(null)}
        footer={
          <NativeActionBar>
            {deleteMutation.error ? (
              <NativeInlineError
                message={deleteMutation.error.message}
                onReset={deleteMutation.reset}
              />
            ) : null}
            <Button
              label="Create delete change request"
              variant="destructive"
              loading={deleteMutation.isPending}
              disabled={!controller.viewPendingDelete}
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={() => {
                if (controller.viewPendingDelete) {
                  deleteMutation.mutate(controller.viewPendingDelete);
                }
              }}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={deleteMutation.isPending}
              fullWidth
              onPress={() => controller.setViewPendingDelete(null)}
            />
          </NativeActionBar>
        }
      />

      <NativeBottomSheet
        visible={!!controller.choicePendingRemove}
        title="Remove choice?"
        description={
          controller.choicePendingRemove
            ? `Remove "${controller.choicePendingRemove}" from this new field draft.`
            : undefined
        }
        showCloseButton
        onClose={() => controller.setChoicePendingRemove(null)}
        footer={
          <NativeActionBar>
            <Button
              label="Remove choice"
              variant="destructive"
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={controller.removePendingChoice}
            />
            <Button
              label="Cancel"
              variant="ghost"
              fullWidth
              onPress={() => controller.setChoicePendingRemove(null)}
            />
          </NativeActionBar>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12, paddingBottom: 8 },
});
