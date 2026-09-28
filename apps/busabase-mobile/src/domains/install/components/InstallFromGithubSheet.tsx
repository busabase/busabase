import { useEffect, useRef } from "react";
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
  /**
   * Pre-fills the URL and target folder, and previews once when the sheet
   * opens — the Template Center's "Install" button.
   *
   * Reuses this exact sheet rather than a template-specific one: browsing and
   * installing must never disagree about what a package is, and they cannot,
   * if the preview a user confirms is literally the same preview. Mirrors
   * web's `InstallFromGithubModal` `initialRepoUrl`/`initialIntoFolder`.
   */
  initialRepoUrl?: string;
  initialIntoFolder?: string;
}

export function InstallFromGithubSheet({
  visible,
  onClose,
  onReviewChangeRequests,
  initialRepoUrl,
  initialIntoFolder,
}: InstallFromGithubSheetProps) {
  const { t } = useI18n();
  const flow = useInstallFromGithub();
  const autoPreviewed = useRef(false);
  // `flow` is a fresh object every render (it is a hook's return value, not a
  // ref), so its functions cannot go in the effect's dependency array without
  // re-running this on every keystroke the user makes inside the very fields
  // it seeds. A ref always reads the latest `flow` without being one of its
  // dependencies — the effect still only fires on `visible`/`initialRepoUrl`
  // changing, exactly once per opening.
  const flowRef = useRef(flow);
  flowRef.current = flow;

  useEffect(() => {
    if (!visible) {
      autoPreviewed.current = false;
      return;
    }
    if (!initialRepoUrl || autoPreviewed.current) return;
    autoPreviewed.current = true;
    flowRef.current.setRepoUrl(initialRepoUrl);
    flowRef.current.setIntoFolder(initialIntoFolder ?? "");
    // `setRepoUrl` above does not take effect until the next render, so the
    // preview below cannot read it back off `flow.repoUrl` — it would still
    // see the empty string this render started with. Passed as an override
    // instead, exactly like `intoFolder` already is.
    flowRef.current.preview({ repoUrl: initialRepoUrl, intoFolder: initialIntoFolder });
  }, [visible, initialRepoUrl, initialIntoFolder]);

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
        {flow.result ? (
          <InstallResultStep result={flow.result} />
        ) : (
          <InstallPlanStep flow={flow} urlLocked={Boolean(initialRepoUrl)} />
        )}
      </ScrollView>
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 460 },
  body: { gap: 10, paddingBottom: spacing[2] },
});
