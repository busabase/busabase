"use client";

import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { type CreatableNodeType, listNodeTypes } from "busabase-contract/domains";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { useMemo, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { buildCreateNodePrompts } from "../helpers/node-agent-prompts";
import { nodeIconForId } from "../helpers/node-icons";
import { useAttachmentUpload } from "../hooks/use-attachment-upload";
import { AgentPromptsView } from "./agent-prompts-view";
import { resolveSpaceId } from "./node-agent-prompts-dialog";
import { SplitSubmitButton } from "./split-submit-button";

// The creatable types, composed from the registry — adding a creatable node type
// makes it appear here automatically (no edit to this dialog). `hidden` types are
// excluded so they have no visible entry point even though they stay creatable
// over the API.
const CREATABLE_TYPES = listNodeTypes()
  .filter((definition) => definition.capabilities.creatable && !definition.capabilities.hidden)
  .map((definition) => ({
    type: definition.type as CreatableNodeType,
    label: definition.label,
    icon: nodeIconForId(definition.icon),
  }));

/**
 * Short, stable, ASCII-safe token derived from a string — the fallback used when
 * a name transliterates to nothing (see `toSlug`). Deterministic on purpose: the
 * slug field updates live as the user types, so a random suffix would churn on
 * every keystroke. FNV-1a, base36; collisions only matter within one parent and
 * the server already rejects duplicate slugs there.
 */
const hashToken = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
};

/**
 * Derive a URL slug from a display name.
 *
 * Slugs are deliberately ASCII (they're path segments, and the CLI/SDK/share
 * links all assume it), so a name written entirely in a non-Latin script — CJK,
 * Cyrillic, … — strips down to nothing. Falling through with an empty slug used
 * to block creation behind a "Name is required." error, which was doubly wrong:
 * the name was present, and the user was given no hint that the *slug* was the
 * problem. Fall back to a stable token so those names just work; the slug field
 * is visible and pre-filled, so it can still be overridden before submitting.
 */
const toSlug = (value: string, fallbackPrefix = "item") => {
  const trimmed = value.trim();
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (slug) return slug;
  return trimmed ? `${fallbackPrefix}-${hashToken(trimmed)}` : "";
};

const toSlugInput = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/g, "");

interface CreateNodeModalProps {
  open: boolean;
  apiClient: BusabaseDashboardApiClient;
  onOpenChange: (open: boolean) => void;
  /** `mode` is "change-request" when submitted normally, "merged" after approve+merge. */
  onCreated: (changeRequestId: string, mode: "change-request" | "merged") => void;
  /** When opened from a folder's "+", the new node is created inside it. */
  parent?: { id: string; name: string } | null;
  /** Host-resolved workspace permission for this dashboard-sibling modal. */
  submitPermissionLevel?: ApiKeyPermissionLevel;
  /**
   * Enables Ask Agent on the "let an Agent create it" tab. Omit for a host with
   * no oRPC client — the tab still lists the prompts to copy, which is the half
   * that needs nothing from Busabase.
   */
  orpc?: BusabaseQueryUtils | null;
  spaceId?: string;
  spaceName?: string;
}

export function CreateNodeModal({
  open,
  apiClient,
  onOpenChange,
  onCreated,
  parent,
  submitPermissionLevel = "manage",
  orpc = null,
  spaceId,
  spaceName,
}: CreateNodeModalProps) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const [selectedType, setSelectedType] = useState(CREATABLE_TYPES[0]?.type ?? "base");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeType =
    CREATABLE_TYPES.find((entry) => entry.type === selectedType) ?? CREATABLE_TYPES[0];
  const uploadAttachment = useAttachmentUpload(apiClient);

  // Deliberately NOT filtered by `selectedType`: someone on this tab is here
  // because they do not yet know what to create, and filtering would hide the
  // cross-type scenarios ("build me a folder structure") that are the reason to
  // ask an agent at all.
  const createPrompts = useMemo(
    () =>
      buildCreateNodePrompts(
        {
          parentNodeId: parent?.id,
          parentName: parent?.name,
          spaceId: resolveSpaceId(spaceId),
          spaceName,
        },
        locale,
      ),
    [parent?.id, parent?.name, spaceId, spaceName, locale],
  );
  // One conversation per place-to-create, per agent (see `AskAgentAction`).
  // Creating three things in the same folder continues one thread; at the root
  // the space stands in, so a root-level session is still stable across clicks.
  const askAgentScopeId = parent?.id ?? resolveSpaceId(spaceId) ?? "root";

  const reset = () => {
    setName("");
    setSlug("");
    setDescription("");
    setSelectedFile(null);
    setSlugEdited(false);
    setError(null);
  };

  const buildOperations = (
    trimmedName: string,
    finalSlug: string,
    metadata?: Record<string, unknown>,
  ) => [
    {
      kind: "create" as const,
      nodeType: selectedType,
      parentNodeId: parent?.id,
      slug: finalSlug,
      name: trimmedName,
      description: description.trim(),
      ...(metadata ? { metadata } : {}),
      // A Base needs at least one field; start with a Title to build on.
      ...(selectedType === "base"
        ? {
            fields: [
              {
                slug: "title",
                name: messages.createNode.defaultTitleField,
                type: "text" as const,
                required: true,
              },
            ],
          }
        : {}),
    },
  ];

  const uploadFileNodeAsset = async () => {
    if (selectedType !== "file") {
      return undefined;
    }
    if (!selectedFile) {
      throw new Error(messages.createNode.fileRequired);
    }
    const uploaded = await uploadAttachment(selectedFile, "file-node");
    if (!uploaded.assetId) {
      throw new Error(messages.createNode.fileUploadMissingAsset);
    }
    return { assetId: uploaded.assetId };
  };

  const submitAsChangeRequest = async () => {
    const trimmedName = name.trim();
    const finalSlug = (slugEdited ? slug : toSlug(trimmedName, selectedType)).trim();
    if (!trimmedName) {
      setError(messages.createNode.nameRequired);
      return;
    }
    // Only reachable when the user cleared the (pre-filled) slug themselves —
    // `toSlug` always yields something for a non-empty name.
    if (!finalSlug) {
      setError(messages.createNode.slugRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const metadata = await uploadFileNodeAsset();
      // Explicit `autoMerge: false`: this is the dedicated "propose for review"
      // action — it must always queue a pending CR regardless of the actor's
      // own permission, unlike `submitAndMerge` below.
      const changeRequest = await apiClient.createNodeChangeRequest({
        message: fmt(messages.createNode.message, {
          name: trimmedName,
          type: activeType?.label ?? "item",
        }),
        operations: buildOperations(trimmedName, finalSlug, metadata),
        autoMerge: false,
      });
      reset();
      onOpenChange(false);
      onCreated(changeRequest.id, "change-request");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.createNode.couldNotCreate);
    } finally {
      setSubmitting(false);
    }
  };

  const submitAndMerge = async () => {
    const trimmedName = name.trim();
    const finalSlug = (slugEdited ? slug : toSlug(trimmedName, selectedType)).trim();
    if (!trimmedName) {
      setError(messages.createNode.nameRequired);
      return;
    }
    // Only reachable when the user cleared the (pre-filled) slug themselves —
    // `toSlug` always yields something for a non-empty name.
    if (!finalSlug) {
      setError(messages.createNode.slugRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const metadata = await uploadFileNodeAsset();
      const changeRequest = await apiClient.createNodeChangeRequest({
        autoMerge: true,
        message: fmt(messages.createNode.message, {
          name: trimmedName,
          type: activeType?.label ?? "item",
        }),
        operations: buildOperations(trimmedName, finalSlug, metadata),
      });
      reset();
      onOpenChange(false);
      onCreated(changeRequest.id, "merged");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.createNode.couldNotCreate);
    } finally {
      setSubmitting(false);
    }
  };

  const isDisabled =
    submitting || name.trim().length === 0 || (selectedType === "file" && !selectedFile);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {fmt(messages.createNode.title, {
              suffix: parent ? fmt(messages.createNode.parentSuffix, { name: parent.name }) : "",
            })}
          </DialogTitle>
        </DialogHeader>

        <Tabs className="flex min-h-0 flex-col gap-3" defaultValue="manual">
          <TabsList className="self-start">
            <TabsTrigger value="manual">{messages.createNode.manualTab}</TabsTrigger>
            <TabsTrigger value="agent">{messages.createNode.agentTab}</TabsTrigger>
          </TabsList>

          <TabsContent className="mt-0 flex flex-col gap-3" value="manual">
            <DialogDescription>
              {parent
                ? fmt(messages.createNode.descriptionInParent, { name: parent.name })
                : messages.createNode.description}
            </DialogDescription>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              {CREATABLE_TYPES.map((entry) => {
                const Icon = entry.icon;
                const isSelected = entry.type === selectedType;
                return (
                  <button
                    className={`flex min-w-0 flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-xs transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                    key={entry.type}
                    onClick={() => {
                      setSelectedType(entry.type);
                      setError(null);
                    }}
                    type="button"
                  >
                    <Icon className="size-5" />
                    {entry.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">{messages.common.name}</span>
              <Input
                autoFocus
                onChange={(event) => {
                  setName(event.target.value);
                  if (!slugEdited) {
                    setSlug(toSlug(event.target.value, selectedType));
                  }
                }}
                placeholder={fmt(messages.createNode.itemNamePlaceholder, {
                  type: activeType?.label ?? messages.nodeDetail.item,
                })}
                value={name}
              />
            </div>
            {selectedType === "file" ? (
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">{messages.createNode.file}</span>
                <Input
                  accept="*/*"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    setSelectedFile(file);
                    if (file && !name.trim()) {
                      setName(file.name);
                      if (!slugEdited) {
                        setSlug(toSlug(file.name, selectedType));
                      }
                    }
                  }}
                  type="file"
                />
                {selectedFile ? (
                  <span className="text-muted-foreground text-xs">
                    {selectedFile.type || "application/octet-stream"} · {selectedFile.size} B
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {messages.createNode.fileRequired}
                  </span>
                )}
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">{messages.common.slug}</span>
              <Input
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(toSlugInput(event.target.value));
                }}
                placeholder={messages.createNode.slugPlaceholder}
                value={slug}
              />
            </div>
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">
                {messages.createNode.descriptionOptional}
              </span>
              <Input
                onChange={(event) => setDescription(event.target.value)}
                placeholder={messages.createNode.descriptionPlaceholder}
                value={description}
              />
            </div>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button disabled={submitting} onClick={() => onOpenChange(false)} variant="outline">
                {messages.common.cancel}
              </Button>
              <SplitSubmitButton
                changeRequestAction={{
                  label: fmt(messages.createNode.createRequest, {
                    type: activeType?.label ?? "",
                  }),
                  loadingLabel: messages.createNode.creating,
                  onSubmit: submitAsChangeRequest,
                  isLoading: submitting,
                }}
                disabled={isDisabled}
                hint={messages.createNode.hint}
                immediateAction={{
                  label: messages.createNode.createNow,
                  loadingLabel: messages.createNode.creating,
                  onSubmit: submitAndMerge,
                  isLoading: submitting,
                }}
                permissionLevel={submitPermissionLevel}
              />
            </DialogFooter>
          </TabsContent>

          <TabsContent className="mt-0 flex flex-col gap-3" value="agent">
            <p className="text-muted-foreground text-sm">{messages.createNode.agentTabHint}</p>
            <AgentPromptsView
              askAgent={orpc ? { orpc, sessionScopeId: askAgentScopeId } : null}
              capabilities={createPrompts.capabilities}
              onHandedOff={() => onOpenChange(false)}
              scenarios={createPrompts.scenarios}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
