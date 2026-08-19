"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeVO } from "busabase-contract/types";
import { Button } from "kui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "kui/dialog";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import { Switch } from "kui/switch";
import { Globe, Lock, Shield, Trash2, Users } from "lucide-react";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { toast } from "sonner";
import { useCoreI18n } from "../../../i18n";

type NodeVisibility = "private" | "workspace" | "public";
type PermissionLevel = "read" | "changeRequest" | "write" | "manage";
type SpaceVisibilityMode = "open" | "restricted";
type PrincipalType = "user" | "team" | "space";
type MutatingPrincipalType = "user" | "space";

const SPACE_PRINCIPAL_TARGET = "space:space";
const CUSTOM_USER_PRINCIPAL_TARGET = "user:";

/**
 * Optional space-member list for the grant picker, injected by a multi-tenant
 * host (busabase-cloud, which has a `members.list` query) — the shared
 * component can't reach a cloud-only query itself. When empty (the open-source
 * single-user host), the picker offers a User ID target that reveals a
 * free-text principal-id input. Same "host injects, core consumes" pattern as
 * the ACL context booleans.
 */
export interface SpaceMemberOption {
  id: string;
  name: string;
}
const SpaceMembersContext = createContext<SpaceMemberOption[]>([]);
export const SpaceMembersProvider = SpaceMembersContext.Provider;

/**
 * The space's default content-visibility mode, injected by the host so the
 * dialog can describe a node's *effective* access accurately (an unset node is
 * "everyone can see" in `open` mode but "restricted" in `restricted` mode).
 * Defaults to `open` — the open-source single-user host has no restricted mode.
 */
const SpaceVisibilityModeContext = createContext<SpaceVisibilityMode>("open");
export const SpaceVisibilityModeProvider = SpaceVisibilityModeContext.Provider;

/**
 * Optional render-slot for a per-node "access requests" review section, injected
 * by a multi-tenant host (busabase-cloud) that has a request → approve loop. The
 * shared dialog renders whatever the host returns for the current node inside a
 * labeled section; the open-source single-user host injects nothing (there are
 * no permissions and thus no requests), so the section simply doesn't appear.
 * Same "host injects, core consumes" seam as the space-members list above.
 */
type RenderAccessRequests = (nodeId: string) => ReactNode;
const NodeAccessRequestsContext = createContext<RenderAccessRequests | null>(null);
export const NodeAccessRequestsProvider = NodeAccessRequestsContext.Provider;

// A minimal flattened view of the cached nodes.list tree, enough to read a
// node's own explicit visibility and walk its ancestors for inheritance.
interface FlatNode {
  id: string;
  parentId: string | null;
  name: string;
  visibility?: NodeVisibility;
}
// Typed as the real `NodeVO` on purpose, with no cast at the call site. A
// hand-rolled local shape plus an `as` is how this kept reading the long-gone
// `metadata.visibility` after the value moved to the `explicit_visibility`
// column: nothing tied the two together, so the compiler had nothing to check
// and every private node quietly read back as unrestricted. Naming the VO makes
// the next rename a build error at this line.
const buildFlatIndex = (
  nodes: NodeVO[] | undefined,
  map: Map<string, FlatNode> = new Map(),
): Map<string, FlatNode> => {
  if (!nodes) return map;
  for (const node of nodes) {
    map.set(node.id, {
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      visibility: node.explicitVisibility ?? undefined,
    });
    buildFlatIndex(node.children, map);
  }
  return map;
};

/**
 * Node-level Permissions manager. Access is modeled the way Google Drive /
 * Notion do it — a node inherits its space's default visibility until you
 * explicitly **Restrict access** (make it private), at which point only the
 * granted people (+ space admins) can see it. There is no separate
 * "Workspace/Public" radio: the space-wide Open/Restricted switch (Space
 * Settings) sets the default, and this dialog only overrides one node to
 * private. Inheritance cascades down folders.
 *
 * Dialog-only, with no trigger of its own: every entry point (the sidebar row's
 * "•••" menu in `dashboard-shell.tsx`, and `NodeActionsMenu` on each node-detail
 * topbar) is a menu item that owns `open` and renders this. The standalone
 * `NodePermissionsButton` that used to sit in those topbars is gone — the
 * topbars now carry a single "•••" instead of a row of naked buttons.
 */
export function NodePermissionsDialog({
  orpc,
  nodeId,
  nodeName,
  open,
  onOpenChange,
}: {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const messages = useCoreI18n();
  const t = messages.permissions;
  const queryClient = useQueryClient();
  const spaceMembers = useContext(SpaceMembersContext);
  const spaceMode = useContext(SpaceVisibilityModeContext);
  const renderAccessRequests = useContext(NodeAccessRequestsContext);

  const principalsQuery = useQuery(orpc.nodes.principals.list.queryOptions({ input: { nodeId } }));
  const principals = principalsQuery.data ?? [];
  // Resolve a granted user's id to a display name when the host provided the
  // member list (cloud); falls back to the raw id (open source).
  const memberName = (id: string) => spaceMembers.find((m) => m.id === id)?.name ?? id;

  // Reuse the already-cached sidebar tree to read this node's own explicit
  // visibility and to walk its ancestors for inherited privacy.
  const nodesQuery = useQuery(orpc.nodes.list.queryOptions({}));
  const flatIndex = useMemo(() => buildFlatIndex(nodesQuery.data), [nodesQuery.data]);
  const storedVisibility = flatIndex.get(nodeId)?.visibility;
  // Nearest ancestor (excluding self) explicitly set to private — that node
  // structurally hides this one no matter what this node is set to.
  const inheritedPrivateFrom = useMemo(() => {
    const self = flatIndex.get(nodeId);
    let cursor = self?.parentId ? flatIndex.get(self.parentId) : undefined;
    while (cursor) {
      if (cursor.visibility === "private") return cursor.name;
      cursor = cursor.parentId ? flatIndex.get(cursor.parentId) : undefined;
    }
    return undefined;
  }, [flatIndex, nodeId]);

  const updateVisibility = useMutation(orpc.nodes.updateVisibility.mutationOptions());
  const addPrincipal = useMutation(orpc.nodes.principals.add.mutationOptions());
  const removePrincipal = useMutation(orpc.nodes.principals.remove.mutationOptions());

  // `undefined` = no local override (use the stored value); `null` = an
  // in-flight "inherit" override; a string = an in-flight explicit override.
  // Distinguishing `null` from `undefined` matters because clearing to inherit
  // is a real, selectable state here.
  const [visibilityOverride, setVisibilityOverride] = useState<NodeVisibility | null | undefined>(
    undefined,
  );
  const explicitVisibility =
    visibilityOverride === undefined ? storedVisibility : visibilityOverride;
  const isPrivate = explicitVisibility === "private";
  const isInherited = !isPrivate && !!inheritedPrivateFrom;
  // Whether access is actually limited (so granting people is meaningful).
  const isLimited = isPrivate || isInherited || spaceMode === "restricted";

  // `getEffectiveNodeLevel` resolves to the MAX of the actor's space-role
  // baseline and any node grants — a grant can only ever RAISE access, never
  // cap it. A plain member's baseline is already `changeRequest`, so on a node
  // they can ALREADY see, adding a `read` grant changes precisely nothing. That
  // reads as "I just locked this down to read-only", which is the opposite of
  // what happens, so say so instead of silently ignoring the grant.
  // Deliberately conservative: only flagged when this node's OWN state proves
  // default visibility, never inferred through the ancestor chain (the dialog
  // has each node's own visibility, not the materialized effective one).
  const membersAlreadySeeThisNode =
    !isPrivate &&
    !inheritedPrivateFrom &&
    (spaceMode !== "restricted" ||
      explicitVisibility === "workspace" ||
      explicitVisibility === "public");

  const [newPrincipalTarget, setNewPrincipalTarget] = useState("");
  const [customPrincipalId, setCustomPrincipalId] = useState("");
  const [newRole, setNewRole] = useState<PermissionLevel>("read");
  const [roleOverrides, setRoleOverrides] = useState<Record<string, PermissionLevel>>({});
  const [pendingPrincipalKey, setPendingPrincipalKey] = useState<string | null>(null);

  const principalKey = (principalType: PrincipalType, principalId: string) =>
    `${principalType}:${principalId}`;
  const toMutatingPrincipalType = (principalType: PrincipalType): MutatingPrincipalType =>
    principalType === "team" ? "user" : principalType;

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.nodes.principals.list.queryOptions({ input: { nodeId } }).queryKey,
    });

  const handlePrivateToggle = async (makePrivate: boolean) => {
    const next: NodeVisibility | null = makePrivate ? "private" : null;
    setVisibilityOverride(next);
    try {
      await updateVisibility.mutateAsync({ nodeId, visibility: next });
      await queryClient.invalidateQueries({
        queryKey: orpc.nodes.list.queryOptions({}).queryKey,
      });
      toast.success(t.visibilityUpdated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.failed);
      setVisibilityOverride(undefined); // revert to the stored value on failure
    }
  };

  const handleAdd = async () => {
    const isSpaceTarget = newPrincipalTarget === SPACE_PRINCIPAL_TARGET;
    const isUserTarget = newPrincipalTarget.startsWith("user:");
    const principalId = isSpaceTarget
      ? "space"
      : newPrincipalTarget === CUSTOM_USER_PRINCIPAL_TARGET
        ? customPrincipalId.trim()
        : newPrincipalTarget.slice("user:".length);
    if ((!isSpaceTarget && !isUserTarget) || !principalId) return;
    try {
      await addPrincipal.mutateAsync({
        nodeId,
        principalType: isSpaceTarget ? "space" : "user",
        principalId,
        role: newRole,
      });
      setNewPrincipalTarget("");
      setCustomPrincipalId("");
      setNewRole("read");
      await invalidate();
      toast.success(t.granted);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.failed);
    }
  };

  const handleRoleChange = async (
    principalType: PrincipalType,
    principalId: string,
    nextRole: PermissionLevel,
  ) => {
    const key = principalKey(principalType, principalId);
    const mutationPrincipalType = toMutatingPrincipalType(principalType);
    setRoleOverrides((prev) => ({ ...prev, [key]: nextRole }));
    setPendingPrincipalKey(key);
    try {
      await addPrincipal.mutateAsync({
        nodeId,
        principalType: mutationPrincipalType,
        principalId,
        role: nextRole,
      });
      await invalidate();
      setRoleOverrides((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.failed);
      setRoleOverrides((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } finally {
      setPendingPrincipalKey((current) => (current === key ? null : current));
    }
  };

  const handleRemove = async (principalType: PrincipalType, principalId: string) => {
    const key = principalKey(principalType, principalId);
    setPendingPrincipalKey(key);
    try {
      await removePrincipal.mutateAsync({
        nodeId,
        principalType: toMutatingPrincipalType(principalType),
        principalId,
      });
      await invalidate();
      setRoleOverrides((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.failed);
    } finally {
      setPendingPrincipalKey((current) => (current === key ? null : current));
    }
  };

  const ROLE_LABELS: Record<PermissionLevel, string> = {
    read: t.roleRead,
    changeRequest: t.roleChangeRequest,
    write: t.roleWrite,
    manage: t.roleManage,
  };

  // The effective-access banner text (the resolved reality for a member).
  const accessText = isPrivate
    ? t.accessPrivate
    : isInherited
      ? t.accessInherited.replace("{name}", inheritedPrivateFrom ?? "")
      : spaceMode === "restricted"
        ? t.accessRestrictedDefault
        : t.accessVisibleToAll;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-lg bg-card" data-testid="node-permissions-dialog">
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{nodeName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Effective-access banner */}
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
            {isLimited ? (
              <Lock className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Globe className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span>{accessText}</span>
          </div>

          {/* Restrict-access toggle */}
          <div className="flex items-start justify-between gap-3">
            <Label className="flex flex-col gap-1" htmlFor="node-restrict-access">
              <span className="font-medium text-sm">{t.makePrivate}</span>
              <span className="text-muted-foreground text-xs">
                {isInherited
                  ? t.inheritedLockHint.replace("{name}", inheritedPrivateFrom ?? "")
                  : t.makePrivateHint}
              </span>
            </Label>
            <Switch
              checked={isPrivate}
              disabled={isInherited || updateVisibility.isPending}
              id="node-restrict-access"
              onCheckedChange={handlePrivateToggle}
            />
          </div>

          {/* Grants — only meaningful when access is actually limited */}
          {isLimited && (
            <div className="space-y-3 border-border/60 border-t pt-4">
              <Label className="font-medium text-sm">{t.peopleHeading}</Label>
              <div className="space-y-2">
                {principals.length === 0 && (
                  <p className="text-muted-foreground text-xs">{t.noGrants}</p>
                )}
                {principals.map((principal) => {
                  const key = principalKey(principal.principalType, principal.principalId);
                  const isPending = pendingPrincipalKey === key;
                  const roleValue = roleOverrides[key] ?? principal.role;

                  return (
                    <div
                      className="flex flex-col items-stretch gap-2 rounded-md border border-border/60 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                      data-testid={`principal-row-${principal.principalType}-${principal.principalId}`}
                      key={principal.id}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {principal.principalType === "space" ? (
                          <Users className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <Shield className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">
                          {principal.principalType === "space"
                            ? t.everyone
                            : memberName(principal.principalId)}
                        </span>
                      </span>
                      <div className="flex items-center gap-2 sm:shrink-0">
                        <Select
                          onValueChange={(value) =>
                            handleRoleChange(
                              principal.principalType,
                              principal.principalId,
                              value as PermissionLevel,
                            )
                          }
                          value={roleValue}
                        >
                          <SelectTrigger
                            className="h-8 min-w-0 flex-1 sm:w-40 sm:flex-none"
                            data-testid={`principal-role-select-${principal.id}`}
                            disabled={isPending}
                          >
                            <SelectValue>{ROLE_LABELS[roleValue]}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="read">{t.roleRead}</SelectItem>
                            <SelectItem value="changeRequest">{t.roleChangeRequest}</SelectItem>
                            <SelectItem value="write">{t.roleWrite}</SelectItem>
                            <SelectItem value="manage">{t.roleManage}</SelectItem>
                          </SelectContent>
                        </Select>
                        <button
                          className="text-muted-foreground hover:text-rejected-strong"
                          disabled={isPending}
                          onClick={() =>
                            handleRemove(principal.principalType, principal.principalId)
                          }
                          type="button"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add grant */}
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
                <div className="grid min-w-0 gap-2">
                  <Select
                    disabled={addPrincipal.isPending}
                    onValueChange={setNewPrincipalTarget}
                    value={newPrincipalTarget}
                  >
                    <SelectTrigger className="h-8 w-full" data-testid="grant-member-select">
                      <SelectValue placeholder={t.selectMember} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SPACE_PRINCIPAL_TARGET}>{t.everyone}</SelectItem>
                      {spaceMembers.length > 0 ? (
                        spaceMembers.map((member) => (
                          <SelectItem key={member.id} value={`user:${member.id}`}>
                            {member.name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value={CUSTOM_USER_PRINCIPAL_TARGET}>
                          {t.userIdPlaceholder}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {newPrincipalTarget === CUSTOM_USER_PRINCIPAL_TARGET && (
                    <Input
                      className="h-8 w-full"
                      disabled={addPrincipal.isPending}
                      onChange={(e) => setCustomPrincipalId(e.target.value)}
                      placeholder={t.userIdPlaceholder}
                      value={customPrincipalId}
                    />
                  )}
                </div>
                <Select
                  disabled={addPrincipal.isPending}
                  onValueChange={(value) => setNewRole(value as PermissionLevel)}
                  value={newRole}
                >
                  <SelectTrigger className="h-8 w-full" data-testid="grant-role-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">{t.roleRead}</SelectItem>
                    <SelectItem value="changeRequest">{t.roleChangeRequest}</SelectItem>
                    <SelectItem value="write">{t.roleWrite}</SelectItem>
                    <SelectItem value="manage">{t.roleManage}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  disabled={
                    addPrincipal.isPending ||
                    !newPrincipalTarget ||
                    (newPrincipalTarget === CUSTOM_USER_PRINCIPAL_TARGET &&
                      !customPrincipalId.trim())
                  }
                  className="w-full sm:w-auto"
                  data-testid="grant-add-button"
                  onClick={handleAdd}
                  size="sm"
                  type="button"
                >
                  {t.add}
                </Button>
              </div>

              {/*
                The four role labels have to stay short — they also render inline
                on each existing grant row and inside a narrow select trigger —
                so what `write`/`manage` actually convey goes here instead. It is
                worth spelling out: those two levels carry the right to APPROVE
                and merge proposals on this node, which is the whole point of
                handing a folder to its owner, and nothing in a two-word label
                tells you that.
              */}
              <p className="text-muted-foreground text-xs" data-testid="grant-role-hint">
                {t.roleApprovalHint}
              </p>

              {newRole === "read" && membersAlreadySeeThisNode && (
                <p className="text-review-strong text-xs" data-testid="grant-read-noop-hint">
                  {t.readGrantNoopHint}
                </p>
              )}
            </div>
          )}

          {/* Host-injected pending access-requests review section (cloud only). */}
          {renderAccessRequests && (
            <div className="space-y-3 border-border/60 border-t pt-4">
              {renderAccessRequests(nodeId)}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            {t.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
