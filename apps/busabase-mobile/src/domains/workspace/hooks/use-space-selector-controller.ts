import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { createCloudSpacesClient } from "~/api/cloud-spaces";
import { useConnection } from "~/connection/connection-store";
import type { BusabaseSpace } from "~/connection/types";
import { useI18n } from "~/i18n";
import { getSpaceSelectorPresentation } from "../utils/space-selector-presentation";

interface UseSpaceSelectorControllerOptions {
  presentation: "sheet" | "popover";
  onDismissContainer?: () => void;
}

export const useSpaceSelectorController = ({
  presentation,
  onDismissContainer,
}: UseSpaceSelectorControllerOptions) => {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { getCloudAuthorizationHeaders, selectSpace, state } = useConnection();
  const [open, setOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const connection = state.status === "connected" ? state.connection : null;
  const isCloud = connection?.mode === "cloud";

  const spacesQuery = useQuery({
    queryKey: ["space-selector", connection?.serverUrl, connection?.cloudUser?.id],
    enabled: isCloud,
    queryFn: async () => {
      if (!connection?.serverUrl) {
        throw new Error("No Busabase Cloud connection");
      }
      const client = createCloudSpacesClient(connection.serverUrl, () =>
        getCloudAuthorizationHeaders({ spaceId: null }),
      );
      return client.spaces.list();
    },
  });

  const spaces = spacesQuery.data ?? [];
  const isLoadingSpaces = isCloud && spacesQuery.isLoading;
  const isFetchingSpaces = isCloud && spacesQuery.isFetching;
  const workspace = {
    ...getSpaceSelectorPresentation({ connection, spaces, isLoadingSpaces, t }),
    spaces,
    serverUrl: connection?.serverUrl,
    isLoadingSpaces,
    isFetchingSpaces,
    hasLoadError: Boolean(spacesQuery.error),
  };

  const closeMenu = useCallback(() => setOpen(false), []);
  const toggleMenu = useCallback(
    () => setOpen((current) => (presentation === "popover" ? !current : true)),
    [presentation],
  );
  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      onDismissContainer?.();
      router.replace(href as never);
    },
    [onDismissContainer, router],
  );
  // Install is a separate modal. Close both menu layers before presenting it.
  const openInstallSheet = useCallback(() => {
    setOpen(false);
    onDismissContainer?.();
    setInstallOpen(true);
  }, [onDismissContainer]);
  const closeInstallSheet = useCallback(() => setInstallOpen(false), []);
  // Installation invalidates workspace queries before this action is offered.
  const reviewChangeRequests = useCallback(() => {
    setInstallOpen(false);
    router.replace("/drawer/inbox");
  }, [router]);
  const selectWorkspace = useCallback(
    async (space: BusabaseSpace) => {
      await selectSpace(space);
      queryClient.clear();
      setOpen(false);
      onDismissContainer?.();
      router.replace("/drawer/home");
    },
    [onDismissContainer, queryClient, router, selectSpace],
  );
  const refreshWorkspaces = useCallback(() => {
    void spacesQuery.refetch();
  }, [spacesQuery.refetch]);

  return {
    installOpen,
    open,
    pathname,
    workspace,
    closeInstallSheet,
    closeMenu,
    navigate,
    openInstallSheet,
    refreshWorkspaces,
    reviewChangeRequests,
    selectWorkspace,
    toggleMenu,
  };
};

export type SpaceSelectorController = ReturnType<typeof useSpaceSelectorController>;
export type SpaceSelectorWorkspace = SpaceSelectorController["workspace"];
