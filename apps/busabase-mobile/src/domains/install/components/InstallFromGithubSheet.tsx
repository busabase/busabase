import { ScrollView, StyleSheet } from "react-native";
import { NativeBottomSheet } from "~/components/native-screen";
import { useI18n } from "~/i18n";
import { spacing } from "~/theme/tokens";
import { useInstallFromGithub } from "../hooks/use-install-from-github";
import { InstallPlanStep } from "./InstallPlanStep";
import { InstallResultStep } from "./InstallResultStep";
import { InstallSheetFooter } from "./InstallSheetFooter";

interface InstallFromGithubSheetProps {
  visible: boolean;
  onClose: () => void;
  onReviewChangeRequests: () => void;
}

export function InstallFromGithubSheet({
  visible,
  onClose,
  onReviewChangeRequests,
}: InstallFromGithubSheetProps) {
  const { t } = useI18n();
  const flow = useInstallFromGithub();
  const close = () => {
    flow.reset();
    onClose();
  };

  return (
    <NativeBottomSheet
      visible={visible}
      title={t.install.title}
      description={flow.result ? undefined : t.install.description}
      showCloseButton
      maxHeight="90%"
      onClose={close}
      footer={
        <InstallSheetFooter
          flow={flow}
          onClose={onClose}
          onReviewChangeRequests={onReviewChangeRequests}
        />
      }
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {flow.result ? <InstallResultStep result={flow.result} /> : <InstallPlanStep flow={flow} />}
      </ScrollView>
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 460 },
  body: { gap: 10, paddingBottom: spacing[2] },
});
