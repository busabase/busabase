import { NativeActionBar, NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useI18n } from "~/i18n";
import type { InstallFromGithubFlow } from "../hooks/use-install-from-github";

interface InstallSheetFooterProps {
  flow: InstallFromGithubFlow;
  onClose: () => void;
  onReviewChangeRequests: () => void;
}

export function InstallSheetFooter({
  flow,
  onClose,
  onReviewChangeRequests,
}: InstallSheetFooterProps) {
  const { t } = useI18n();
  return (
    <NativeActionBar>
      {flow.error ? <NativeInlineError message={flow.error} onReset={flow.resetErrors} /> : null}
      {flow.result ? (
        <>
          {flow.result.pendingChangeRequests > 0 ? (
            <Button
              label={t.install.reviewNow}
              fullWidth
              onPress={() => {
                flow.reset();
                onClose();
                onReviewChangeRequests();
              }}
            />
          ) : null}
          <Button
            label={t.install.done}
            variant={flow.result.pendingChangeRequests > 0 ? "ghost" : "primary"}
            fullWidth
            onPress={() => {
              flow.reset();
              onClose();
            }}
          />
        </>
      ) : (
        <>
          {flow.plan ? (
            <Button
              label={flow.installing ? t.install.installing : t.install.install}
              disabled={!flow.canInstall}
              fullWidth
              onPress={flow.install}
            />
          ) : (
            <Button
              label={flow.planning ? t.install.previewing : t.install.preview}
              disabled={flow.planning || flow.repoUrl.trim().length === 0}
              fullWidth
              onPress={() => flow.preview()}
            />
          )}
          <Button
            label={t.common.cancel}
            variant="ghost"
            disabled={flow.installing}
            fullWidth
            onPress={() => {
              flow.reset();
              onClose();
            }}
          />
        </>
      )}
    </NativeActionBar>
  );
}
