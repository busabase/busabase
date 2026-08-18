import type { NodeVO } from "busabase-contract/types";
import { ScrollView, StyleSheet } from "react-native";
import { NativeActionBar, NativeBottomSheet, NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useI18n } from "~/i18n";
import { useNodePermissionsController } from "../hooks/use-node-permissions-controller";
import { NodePermissionAccessControls } from "./NodePermissionAccessControls";
import { NodePermissionPrincipalSections } from "./NodePermissionPrincipalSections";

interface NodePermissionsSheetProps {
  visible: boolean;
  node: NodeVO;
  /** The raw nodes.list tree is required to resolve inherited privacy. */
  nodes: NodeVO[];
  /** Missing means the historical open-space default. */
  spaceVisibilityMode?: "open" | "restricted" | null;
  onClose: () => void;
  onBack: () => void;
}

/**
 * Mobile keeps the core node-principal contract: free-text user ids replace
 * the cloud-only member picker, and cloud-only access-request review is absent.
 */
export function NodePermissionsSheet({
  visible,
  node,
  nodes,
  spaceVisibilityMode,
  onClose,
  onBack,
}: NodePermissionsSheetProps) {
  const { t } = useI18n();
  const controller = useNodePermissionsController({
    visible,
    node,
    nodes,
    spaceVisibilityMode,
    onBack,
  });

  return (
    <NativeBottomSheet
      visible={visible}
      title={t.permissions.title}
      description={node.name}
      showCloseButton
      maxHeight="90%"
      onClose={controller.handleBack}
      footer={
        <NativeActionBar>
          {controller.actionError ? (
            <NativeInlineError
              message={controller.actionError || t.permissions.failed}
              onReset={controller.resetErrors}
            />
          ) : null}
          <Button label={t.common.close} variant="ghost" fullWidth onPress={onClose} />
        </NativeActionBar>
      }
    >
      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
        <NodePermissionAccessControls
          access={controller.access}
          pending={controller.visibilityPending}
          onPrivateChange={controller.setPrivate}
        />
        {controller.access.isLimited ? (
          <NodePermissionPrincipalSections
            addPending={controller.addPending}
            loading={controller.principalsLoading}
            newPrincipalId={controller.newPrincipalId}
            newPrincipalIsSpace={controller.newPrincipalIsSpace}
            newRole={controller.newRole}
            principals={controller.principals}
            removePending={controller.removePending}
            onAdd={controller.addPrincipal}
            onPrincipalIdChange={controller.setNewPrincipalId}
            onPrincipalIsSpaceChange={controller.setNewPrincipalIsSpace}
            onRemove={controller.removePrincipal}
            onRoleChange={controller.setNewRole}
          />
        ) : null}
      </ScrollView>
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({ body: { maxHeight: 420 } });
