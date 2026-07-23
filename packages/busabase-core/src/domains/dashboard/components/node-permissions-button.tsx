"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
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
import { useIsAnonymousVisitor } from "../visitor-context";
import { NodeActionButton } from "./node-action-button";

type NodeVisibility = "private" | "workspace" | "public";
type PermissionLevel = "read" | "changeRequest" | "write" | "manage";
type SpaceVisibilityMode = "open" | "restricted";

/**
 * Optional space-member list for the grant picker, injected by a multi-tenant
 * host (busabase-cloud, which has a `members.list` query) — the shared
 * component can't reach a cloud-only query itself. When empty (the
 * open-source single-user host), the picker falls back to a free-text
 * principal-id input. Same "host injects, core consumes" pattern as the ACL
 * context booleans.
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
interface TreeNode {
  id: string;
  parentId?: string | null;
  name?: string;
  metadata?: { visibility?: NodeVisibility };
  children?: TreeNode[];
}

const buildFlatIndex = (
  nodes: TreeNode[] | undefined,
  map: Map<string, FlatNode> = new Map(),
): Map<string, FlatNode> => {
  if (!nodes) return map;
  for (const node of nodes) {
    map.set(node.id, {
      id: node.id,
      parentId: node.parentId ?? null,
      name: node.name ?? "",
      visibility: node.metadata?.visibility,
    });
    buildFlatIndex(node.children, map);
  }
  return map;
};

/**
 * Node-level Permissions manager: a trigger button + dialog. Access is modeled
 * the way Google Drive / Notion do it — a node inherits its space's default
 * visibility until you explicitly **Restrict access** (make it private), at
 * which point only the granted people (+ space admins) can see it. There is no
 * separate "Workspace/Public" radio: the space-wide Open/Restricted switch
 * (Space Settings) sets the default, and this dialog only overrides one node to
 * private. Inheritance cascades down folders. One component drives every entry
 * point (sidebar "•••" menu and each node-detail toolbar), same shape as
 * `NodeDeleteButton`.
 */
export function NodePermissionsButton({
  orpc,
  nodeId,
  nodeName,
  variant = "toolbar",
}: {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeName: string;
  /** "toolbar" = the bordered pill used in node-detail headers; "icon" = the
   *  compact mobile toolbar action; "menu" = a full-width sidebar row. */
  variant?: "toolbar" | "menu" | "icon";
}) {
  const messages = useCoreI18n();
  const t = messages.permissions;
  const [open, setOpen] = useState(false);
  // Managing access is a manage-only action — a public read-only visitor can
  // never use it, so self-gate here to cover every mount (base/doc/folder/file
  // headers, sidebar menu). Hooks above run unconditionally first.
  const isAnon = useIsAnonymousVisitor();
  if (isAnon) {
    return null;
  }

  return (
    <>
      <NodeActionButton
        icon={Shield}
        label={t.title}
        onClick={() => setOpen(true)}
        variant={variant}
      />
      {open && (
        <NodePermissionsDialog
          nodeId={nodeId}
          nodeName={nodeName}
          onOpenChange={setOpen}
          open={open}
          orpc={orpc}
        />
      )}
    </>
  );
}

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
  const flatIndex = useMemo(
    () => buildFlatIndex(nodesQuery.data as TreeNode[] | undefined),
    [nodesQuery.data],
  );
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

  const [newPrincipalId, setNewPrincipalId] = useState("");
  const [newPrincipalIsSpace, setNewPrincipalIsSpace] = useState(false);
  const [newRole, setNewRole] = useState<PermissionLevel>("read");

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
    const principalId = newPrincipalIsSpace ? "space" : newPrincipalId.trim();
    if (!principalId) return;
    try {
      await addPrincipal.mutateAsync({
        nodeId,
        principalType: newPrincipalIsSpace ? "space" : "user",
        principalId,
        role: newRole,
      });
      setNewPrincipalId("");
      setNewPrincipalIsSpace(false);
      setNewRole("read");
      await invalidate();
      toast.success(t.granted);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.failed);
    }
  };

  const handleRemove = async (principalType: "user" | "team" | "space", principalId: string) => {
    try {
      await removePrincipal.mutateAsync({
        nodeId,
        principalType: principalType === "team" ? "user" : principalType,
        principalId,
      });
      await invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.failed);
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
      <DialogContent className="max-w-lg">
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
                {principals.map((principal) => (
                  <div
                    className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm"
                    key={principal.id}
                  >
                    <span className="flex items-center gap-2">
                      {principal.principalType === "space" ? (
                        <Users className="size-4 text-muted-foreground" />
                      ) : (
                        <Shield className="size-4 text-muted-foreground" />
                      )}
                      <span>
                        {principal.principalType === "space"
                          ? t.everyone
                          : memberName(principal.principalId)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        · {ROLE_LABELS[principal.role]}
                      </span>
                    </span>
                    <button
                      className="text-muted-foreground hover:text-red-600"
                      onClick={() => handleRemove(principal.principalType, principal.principalId)}
                      type="button"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add grant */}
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-muted-foreground text-xs">
                  <input
                    checked={newPrincipalIsSpace}
                    onChange={(e) => setNewPrincipalIsSpace(e.target.checked)}
                    type="checkbox"
                  />
                  {t.everyone}
                </label>
                {!newPrincipalIsSpace &&
                  (spaceMembers.length > 0 ? (
                    <Select onValueChange={setNewPrincipalId} value={newPrincipalId}>
                      <SelectTrigger className="h-8 flex-1">
                        <SelectValue placeholder={t.selectMember} />
                      </SelectTrigger>
                      <SelectContent>
                        {spaceMembers.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      className="h-8 flex-1"
                      onChange={(e) => setNewPrincipalId(e.target.value)}
                      placeholder={t.userIdPlaceholder}
                      value={newPrincipalId}
                    />
                  ))}
                <Select
                  onValueChange={(value) => setNewRole(value as PermissionLevel)}
                  value={newRole}
                >
                  <SelectTrigger className="h-8 w-40">
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
                    addPrincipal.isPending || (!newPrincipalIsSpace && !newPrincipalId.trim())
                  }
                  onClick={handleAdd}
                  size="sm"
                  type="button"
                >
                  {t.add}
                </Button>
              </div>
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
