import type { BusabaseConnection, BusabaseSpace } from "~/connection/types";
import type { CoreMessages } from "~/i18n/messages";

interface SpaceSelectorPresentationInput {
  connection: BusabaseConnection | null;
  spaces: readonly BusabaseSpace[];
  isLoadingSpaces: boolean;
  t: Pick<CoreMessages, "nav" | "workspaceSelector">;
}

export interface SpaceSelectorPresentation {
  activeSpace: BusabaseSpace | null;
  isCloud: boolean;
  planLabel: string;
  triggerSubtitle: string;
  triggerTitle: string;
}

export const getSpaceSelectorPresentation = ({
  connection,
  spaces,
  isLoadingSpaces,
  t,
}: SpaceSelectorPresentationInput): SpaceSelectorPresentation => {
  const isCloud = connection?.mode === "cloud";
  const activeSpace = connection?.selectedSpace ?? spaces[0] ?? null;
  const staticWorkspaceName =
    connection?.mode === "demo"
      ? t.workspaceSelector.demoWorkspace
      : t.workspaceSelector.selfHostedWorkspace;
  const triggerTitle = isCloud
    ? (activeSpace?.name ?? (isLoadingSpaces ? t.nav.workspaceLoading : t.nav.workspace))
    : (activeSpace?.name ?? staticWorkspaceName);
  const triggerSubtitle = isCloud
    ? spaces.length > 1
      ? `${spaces.length} ${t.nav.workspaces}`
      : activeSpace?.slug
        ? `@${activeSpace.slug}`
        : "Busabase Cloud"
    : (connection?.serverUrl ?? staticWorkspaceName);
  const planLabel = isCloud
    ? (activeSpace?.plan ?? "Cloud")
    : connection?.mode === "demo"
      ? "Demo"
      : "Local";

  return { activeSpace, isCloud, planLabel, triggerSubtitle, triggerTitle };
};
