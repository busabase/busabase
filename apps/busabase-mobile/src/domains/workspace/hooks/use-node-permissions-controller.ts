import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NodeVO } from "busabase-contract/types";
import { useCallback, useMemo, useState } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { useI18n } from "~/i18n";
import type {
  NodePermissionPrincipal,
  NodePermissionVisibility,
  PermissionLevel,
} from "../types/node-permissions";
import { resolveNodePermissionAccess, toMutablePrincipalType } from "../utils/node-permissions";

interface Options {
  visible: boolean;
  node: NodeVO;
  nodes: NodeVO[];
  spaceVisibilityMode?: "open" | "restricted" | null;
  onBack: () => void;
}

export const useNodePermissionsController = ({
  visible,
  node,
  nodes,
  spaceVisibilityMode,
  onBack,
}: Options) => {
  const { t } = useI18n();
  const busabase = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const [visibilityOverride, setVisibilityOverride] = useState<NodePermissionVisibility>(undefined);
  const [newPrincipalId, setNewPrincipalId] = useState("");
  const [newPrincipalIsSpace, setNewPrincipalIsSpace] = useState(false);
  const [newRole, setNewRole] = useState<PermissionLevel>("read");

  const principalsQuery = useQuery({
    ...(busabase
      ? busabase.orpc.nodes.principals.list.queryOptions({ input: { nodeId: node.id } })
      : { queryKey: ["no-connection", "node-principals", node.id], queryFn: skipToken }),
    enabled: visible && !!busabase,
  });
  const principals: NodePermissionPrincipal[] = principalsQuery.data ?? [];
  const access = useMemo(
    () =>
      resolveNodePermissionAccess({
        node,
        nodes,
        spaceVisibilityMode,
        visibilityOverride,
      }),
    [node, nodes, spaceVisibilityMode, visibilityOverride],
  );

  const invalidatePrincipals = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: busabase?.orpc.nodes.principals.list.key({ input: { nodeId: node.id } }),
      }),
    [busabase, node.id, queryClient],
  );

  const visibilityMutation = useMutation({
    mutationFn: async (makePrivate: boolean) => {
      if (!busabase) throw new Error(t.common.notConnected);
      const next = makePrivate ? ("private" as const) : null;
      setVisibilityOverride(next);
      await busabase.client.nodes.updateVisibility({ nodeId: node.id, visibility: next });
      return next;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: busabase?.orpc.nodes.list.key() });
    },
    onError: () => setVisibilityOverride(undefined),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!busabase) throw new Error(t.common.notConnected);
      const principalId = newPrincipalIsSpace ? "space" : newPrincipalId.trim();
      if (!principalId) throw new Error(t.permissions.userIdPlaceholder);
      return busabase.client.nodes.principals.add({
        nodeId: node.id,
        principalType: newPrincipalIsSpace ? "space" : "user",
        principalId,
        role: newRole,
      });
    },
    onSuccess: async () => {
      setNewPrincipalId("");
      setNewPrincipalIsSpace(false);
      setNewRole("read");
      await invalidatePrincipals();
    },
  });

  const removeMutation = useMutation({
    mutationFn: async ({
      principalType,
      principalId,
    }: Omit<NodePermissionPrincipal, "id" | "role">) => {
      if (!busabase) throw new Error(t.common.notConnected);
      return busabase.client.nodes.principals.remove({
        nodeId: node.id,
        principalType: toMutablePrincipalType(principalType),
        principalId,
      });
    },
    onSuccess: () => void invalidatePrincipals(),
  });

  const resetErrors = useCallback(() => {
    visibilityMutation.reset();
    addMutation.reset();
    removeMutation.reset();
  }, [addMutation, removeMutation, visibilityMutation]);

  const handleBack = useCallback(() => {
    resetErrors();
    setNewPrincipalId("");
    setNewPrincipalIsSpace(false);
    setNewRole("read");
    onBack();
  }, [onBack, resetErrors]);

  return {
    access,
    actionError:
      visibilityMutation.error?.message ??
      addMutation.error?.message ??
      removeMutation.error?.message ??
      principalsQuery.error?.message ??
      null,
    addPending: addMutation.isPending,
    addPrincipal: () => addMutation.mutate(),
    handleBack,
    newPrincipalId,
    newPrincipalIsSpace,
    newRole,
    principals,
    principalsLoading: principalsQuery.isLoading,
    removePending: removeMutation.isPending,
    removePrincipal: (principal: Omit<NodePermissionPrincipal, "id" | "role">) =>
      removeMutation.mutate(principal),
    resetErrors,
    setNewPrincipalId,
    setNewPrincipalIsSpace,
    setNewRole,
    setPrivate: (makePrivate: boolean) => visibilityMutation.mutate(makePrivate),
    visibilityPending: visibilityMutation.isPending,
  };
};

export type NodePermissionsController = ReturnType<typeof useNodePermissionsController>;
