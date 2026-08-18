import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InstallPlanVO, InstallResultVO } from "busabase-contract/domains/install/types";
import { useState } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { useI18n } from "~/i18n";

interface PlanOverrides {
  intoFolder?: string;
  rename?: boolean;
}

const errorMessage = (caught: Error | null, fallback: string): string | null =>
  caught ? caught.message || fallback : null;

export function useInstallFromGithub() {
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const [repoUrl, setRepoUrlState] = useState("");
  const [plan, setPlan] = useState<InstallPlanVO | null>(null);
  const [intoFolder, setIntoFolder] = useState("");
  const [rename, setRename] = useState(false);
  const [autoMerge, setAutoMerge] = useState(false);
  const [result, setResult] = useState<InstallResultVO | null>(null);

  const refreshWorkspace = () => {
    if (!buda) return;
    void queryClient.invalidateQueries({ queryKey: buda.orpc.nodes.list.key() });
    void queryClient.invalidateQueries({ queryKey: buda.orpc.bases.list.key() });
    void queryClient.invalidateQueries({ queryKey: buda.orpc.changeRequests.list.key() });
  };

  const planMutation = useMutation<InstallPlanVO, Error, PlanOverrides>({
    mutationFn: async (overrides) => {
      if (!buda) throw new Error(t.common.notConnected);
      const trimmedUrl = repoUrl.trim();
      if (!trimmedUrl) throw new Error(t.install.repoUrlRequired);
      const nextFolder = (overrides.intoFolder ?? intoFolder).trim();
      return buda.client.install.planFromGithub({
        repoUrl: trimmedUrl,
        ...(nextFolder ? { intoFolder: nextFolder } : {}),
        rename: overrides.rename ?? rename,
      });
    },
    onSuccess: (next, overrides) => {
      setPlan(next);
      setIntoFolder((overrides.intoFolder ?? intoFolder).trim() || next.targetFolderSlug);
    },
  });

  const installMutation = useMutation<InstallResultVO, Error, void>({
    mutationFn: async () => {
      if (!buda) throw new Error(t.common.notConnected);
      const trimmedFolder = intoFolder.trim();
      return buda.client.install.fromGithub({
        repoUrl: repoUrl.trim(),
        ...(trimmedFolder ? { intoFolder: trimmedFolder } : {}),
        rename,
        autoMerge,
      });
    },
    onSuccess: (installed) => {
      setResult(installed);
      refreshWorkspace();
    },
  });

  const resetErrors = () => {
    planMutation.reset();
    installMutation.reset();
  };

  const reset = () => {
    setRepoUrlState("");
    setPlan(null);
    setIntoFolder("");
    setRename(false);
    setAutoMerge(false);
    setResult(null);
    resetErrors();
  };

  const setRepoUrl = (value: string) => {
    setRepoUrlState(value);
    setPlan(null);
    resetErrors();
  };

  const preview = (overrides: PlanOverrides = {}) => planMutation.mutate(overrides);
  const install = () => installMutation.mutate();
  const toggleRename = () => {
    const next = !rename;
    setRename(next);
    preview({ rename: next });
  };
  const previewTargetFolderIfChanged = () => {
    const next = intoFolder.trim();
    if (plan && next && next !== plan.targetFolderSlug) {
      preview({});
    }
  };

  const planning = planMutation.isPending;
  const installing = installMutation.isPending;
  const unresolvedCollisions = plan?.collisions.filter((collision) => !collision.renamedTo) ?? [];
  const canInstall =
    plan !== null &&
    !planning &&
    !installing &&
    unresolvedCollisions.length === 0 &&
    !(plan.requiresAutoMerge && !autoMerge);
  const error =
    errorMessage(installMutation.error, t.install.installFailed) ??
    errorMessage(planMutation.error, t.install.previewFailed);

  return {
    autoMerge,
    canInstall,
    error,
    installing,
    intoFolder,
    plan,
    planning,
    rename,
    repoUrl,
    result,
    unresolvedCollisions,
    install,
    preview,
    previewTargetFolderIfChanged,
    reset,
    resetErrors,
    setAutoMerge,
    setIntoFolder,
    setRepoUrl,
    toggleRename,
  };
}

export type InstallFromGithubFlow = ReturnType<typeof useInstallFromGithub>;
