"use client";

import { useQuery } from "@tanstack/react-query";
import {
  type ApiKeyPermissionLevel,
  hasApiKeyLevel,
} from "busabase-contract/access-control/api-key-level";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { type CreatableNodeType, listNodeTypes } from "busabase-contract/domains";
import { Button } from "kui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "kui/dialog";
import { Input } from "kui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import type { CoreI18nMessages } from "../../../i18n/messages";
import {
  FormBaseBindingPicker,
  type FormBindingDraft,
  toFormBindings,
} from "../../form/components/form-base-binding-picker";
import { TemplateGrid } from "../../templates/components/template-grid";
import { buildCreateNodePrompts } from "../helpers/node-agent-prompts";
import { nodeIconForId } from "../helpers/node-icons";
import { useAttachmentUpload } from "../hooks/use-attachment-upload";
import type { AgentIntegrationTarget } from "./agent-install-panel";
import { AgentPromptsView } from "./agent-prompts-view";
import { DialogContent } from "./localized-dialog-content";
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
    icon: nodeIconForId(definition.icon),
    common: Boolean(definition.capabilities.commonlyCreated),
  }));

// The few whose name alone is enough to choose correctly, and everything else —
// present, one click behind "More types". Both derived from the registry, so a
// new node type lands in the right group without editing this dialog.
const COMMON_TYPES = CREATABLE_TYPES.filter((entry) => entry.common);
const UNCOMMON_TYPES = CREATABLE_TYPES.filter((entry) => !entry.common);
// Common first, then the rest — so expanding APPENDS rather than reshuffles, and
// the four tiles someone has already learned the position of stay put.
const ORDERED_TYPES = [...COMMON_TYPES, ...UNCOMMON_TYPES];

/**
 * The node types the picker has copy for — one key per registered type. Both
 * catalogs below are indexed by it, so adding a node type surfaces here as a
 * missing-key type error instead of an unlabelled tile.
 */
type NodeTypeCopyKey = keyof CoreI18nMessages["createNode"]["typeHints"];

/**
 * A node type's display name and one-line hint, in the active language.
 *
 * The registry's `label` is a hardcoded English identifier (`"Folder"`), which
 * is why a zh-CN user was looking at eleven English words: the picker rendered
 * that identifier directly. The translated names already existed — every locale
 * catalog carries `nodeDetail.<type>` and has for a long time — so this only
 * has to look them up. The hint is new copy, and is the part that answers the
 * question the name cannot ("Base or Doc? Drive or Folder?").
 */
const useTypeCopy = () => {
  const messages = useCoreI18n();
  // Keyed off `typeHints`, not off `CreatableNodeType`: the registry's derived
  // union has widened to plain `string` (its `Extract<…>` no longer narrows), so
  // it would index these catalogs as `any`. The hint record has exactly one key
  // per node type, so using ITS keys means a type added to the registry without
  // copy is a compile error here rather than a blank tile at runtime.
  return (type: string) => {
    const key = type as NodeTypeCopyKey;
    return {
      name: messages.nodeDetail[key] ?? messages.nodeDetail.item,
      hint: messages.createNode.typeHints[key] ?? "",
    };
  };
};

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
  /**
   * Which edition/space the copied create-prompt should tell an agent to connect
   * to — the same value the host already passes `InstallFromGithubModal`.
   *
   * A prop rather than the dashboard's `AgentIntegrationProvider` because hosts
   * render this modal as a sibling of `BusabaseDashboard`, not inside it.
   */
  agentIntegration?: AgentIntegrationTarget;
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
  agentIntegration,
}: CreateNodeModalProps) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const [, setLocation] = useLocation();
  const [selectedType, setSelectedType] = useState(CREATABLE_TYPES[0]?.type ?? "base");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A Form has no meaning without the Base it writes into — `target_base_id` is
  // NOT NULL — so the tile collects it here and `materializeFormNode` writes the
  // config row inside the merge. Collecting it was the precondition for the Form
  // type being offered at all; without it the tile opened to a dead end.
  const [formBinding, setFormBinding] = useState<FormBindingDraft>({
    targetBaseId: "",
    fieldSlugs: [],
  });
  // Binding a Form to a Base opens an inbound write funnel into it, so the merge
  // asserts `manage` on the TARGET Base. Gating only the submit (and not this
  // hint) would let a cloud `member` fill the whole dialog in and meet a 403.
  const canBindForm = hasApiKeyLevel(submitPermissionLevel, "manage");

  const activeType =
    CREATABLE_TYPES.find((entry) => entry.type === selectedType) ?? CREATABLE_TYPES[0];
  const typeCopy = useTypeCopy();
  const activeTypeName = activeType ? typeCopy(activeType.type).name : messages.nodeDetail.item;
  const [showAllTypes, setShowAllTypes] = useState(false);
  const selectedUncommonType = UNCOMMON_TYPES.find((entry) => entry.type === selectedType);
  // A collapsed picker still shows the active uncommon tile, so "Fewer types"
  // can actually reduce the list without making the current choice disappear.
  // The selection and its type-specific form stay mounted and untouched.
  const visibleTypes = showAllTypes
    ? ORDERED_TYPES
    : selectedUncommonType
      ? [...COMMON_TYPES, selectedUncommonType]
      : COMMON_TYPES;
  const hiddenUncommonTypeCount = showAllTypes
    ? 0
    : UNCOMMON_TYPES.length - (selectedUncommonType ? 1 : 0);
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
  /**
   * Browsing and installing stay where they already work: the Template Center
   * route owns the detail view, the screenshots, and the install dialog. This
   * tab exists because people did not know that route was there — it is a
   * storefront window, not a second checkout — so picking a card closes the
   * modal and hands off to it.
   */
  const openTemplate = (name?: string) => {
    onOpenChange(false);
    setLocation(name ? `/templates/${name}` : "/templates");
  };

  // One conversation per place-to-create, per agent (see `AskAgentAction`).
  // Creating three things in the same folder continues one thread; at the root
  // the space stands in, so a root-level session is still stable across clicks.
  const askAgentScopeId = parent?.id ?? resolveSpaceId(spaceId) ?? "root";

  const reset = () => {
    setName("");
    setSlug("");
    setDescription("");
    setSelectedFile(null);
    setFormBinding({ targetBaseId: "", fieldSlugs: [] });
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

  /**
   * Type-specific CREATE INPUT carried on the `node_create` operation's
   * `metadata` bag and consumed by that type's materializer at merge time.
   *
   * Deliberately part of the one change request rather than a second call the
   * client chains afterwards: a Form's config row and its node are created in
   * the same transaction, so a Form proposed for review is configured exactly
   * like one merged immediately, and a failure can never leave an orphan node
   * behind.
   */
  const buildTypeMetadata = async (): Promise<Record<string, unknown> | undefined> => {
    if (selectedType === "file") {
      return uploadFileNodeAsset();
    }
    if (selectedType === "form") {
      if (!formBinding.targetBaseId) {
        throw new Error(messages.form.targetBaseRequired);
      }
      if (formBinding.fieldSlugs.length === 0) {
        throw new Error(messages.form.collectFieldsRequired);
      }
      return {
        targetBaseId: formBinding.targetBaseId,
        formBindings: toFormBindings(formBinding),
      };
    }
    return undefined;
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
      const metadata = await buildTypeMetadata();
      // Explicit `autoMerge: false`: this is the dedicated "propose for review"
      // action — it must always queue a pending CR regardless of the actor's
      // own permission, unlike `submitAndMerge` below.
      const changeRequest = await apiClient.createNodeChangeRequest({
        message: fmt(messages.createNode.message, {
          name: trimmedName,
          type: activeTypeName,
        }),
        operations: buildOperations(trimmedName, finalSlug, metadata),
        autoMerge: false,
      });
      reset();
      onOpenChange(false);
      onCreated(changeRequest.id, "change-request");
    } catch (caught) {
      setError(presentCoreError(messages, locale, caught, messages.createNode.couldNotCreate));
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
      const metadata = await buildTypeMetadata();
      const changeRequest = await apiClient.createNodeChangeRequest({
        autoMerge: true,
        message: fmt(messages.createNode.message, {
          name: trimmedName,
          type: activeTypeName,
        }),
        operations: buildOperations(trimmedName, finalSlug, metadata),
      });
      reset();
      onOpenChange(false);
      onCreated(changeRequest.id, "merged");
    } catch (caught) {
      setError(presentCoreError(messages, locale, caught, messages.createNode.couldNotCreate));
    } finally {
      setSubmitting(false);
    }
  };

  const isDisabled =
    submitting ||
    name.trim().length === 0 ||
    (selectedType === "file" && !selectedFile) ||
    // Same shape as `file`'s "no asset, no submit": a Form node with no target
    // Base is exactly the dead end this dialog used to hide the type to avoid.
    (selectedType === "form" &&
      (!canBindForm || !orpc || !formBinding.targetBaseId || formBinding.fieldSlugs.length === 0));

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
      {/* Capped height with the body scrolling inside it. Without this the
          dialog grows past a 900px-tall viewport once the full type list is
          expanded — and since Radix scroll-locks the page behind it, the
          footer becomes genuinely unreachable rather than merely clipped. */}
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] min-w-0 max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-4 sm:w-full sm:max-w-3xl sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {fmt(messages.createNode.title, {
              suffix: parent ? fmt(messages.createNode.parentSuffix, { name: parent.name }) : "",
            })}
          </DialogTitle>
        </DialogHeader>

        <Tabs className="flex min-h-0 min-w-0 flex-col gap-3" defaultValue="manual">
          <div className="min-w-0 max-w-full overflow-x-auto pb-1" data-create-node-tabs-scroll>
            <TabsList className="w-max min-w-full justify-start">
              <TabsTrigger value="manual">{messages.createNode.manualTab}</TabsTrigger>
              <TabsTrigger value="agent">{messages.createNode.agentTab}</TabsTrigger>
              <TabsTrigger value="template">{messages.createNode.templateTab}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent className="mt-0 flex min-h-0 min-w-0 flex-col gap-3" value="manual">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
              <DialogDescription className="max-w-full break-words" data-create-node-description>
                {parent
                  ? fmt(messages.createNode.descriptionInParent, { name: parent.name })
                  : messages.createNode.description}
              </DialogDescription>
              {/* Two columns, not six: each tile now carries a sentence, and six
                across left no room for one. The trade is deliberate — a wider
                tile a user can read beats a denser grid they cannot. */}
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                {visibleTypes.map((entry) => {
                  const Icon = entry.icon;
                  const isSelected = entry.type === selectedType;
                  const { name: typeName, hint } = typeCopy(entry.type);
                  return (
                    <button
                      aria-pressed={isSelected}
                      className={`flex w-full min-w-0 max-w-full items-start gap-2.5 overflow-hidden rounded-md border px-3 py-2.5 text-left transition-colors ${
                        isSelected ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                      }`}
                      key={entry.type}
                      onClick={() => {
                        setSelectedType(entry.type);
                        setError(null);
                      }}
                      type="button"
                    >
                      <Icon
                        className={`mt-0.5 size-5 shrink-0 ${
                          isSelected ? "text-foreground" : "text-muted-foreground"
                        }`}
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5 whitespace-normal break-words">
                        <span className="font-medium text-foreground text-sm break-words">
                          {typeName}
                        </span>
                        {hint ? (
                          <span className="text-muted-foreground text-xs leading-4 break-words">
                            {hint}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              {UNCOMMON_TYPES.length > 0 ? (
                <button
                  aria-expanded={showAllTypes}
                  className="self-start rounded-md px-1 py-0.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
                  onClick={() => setShowAllTypes((current) => !current)}
                  type="button"
                >
                  {showAllTypes
                    ? messages.createNode.fewerTypes
                    : fmt(messages.createNode.moreTypes, { count: hiddenUncommonTypeCount })}
                </button>
              ) : null}

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
                    type: activeTypeName,
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
              {selectedType === "form" ? (
                canBindForm ? (
                  orpc ? (
                    <FormBaseBindingPicker
                      disabled={submitting}
                      idPrefix="create-node-form"
                      onChange={(next) => {
                        setFormBinding(next);
                        setError(null);
                      }}
                      orpc={orpc}
                      value={formBinding}
                    />
                  ) : (
                    // No oRPC client (a host that passes only `apiClient`), so the
                    // Bases can't be listed and the target can't be chosen. Say so
                    // rather than offering a submit that would create an orphan.
                    <p className="text-muted-foreground text-sm">
                      {messages.form.needsWorkspaceConnection}
                    </p>
                  )
                ) : (
                  <p className="text-muted-foreground text-sm">{messages.form.setUpNeedsManage}</p>
                )
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
            </div>

            <DialogFooter
              className="flex-row items-center justify-end gap-2 space-x-0 sm:space-x-0"
              data-create-node-footer
            >
              <Button
                disabled={submitting}
                onClick={() => onOpenChange(false)}
                size="sm"
                variant="outline"
              >
                {messages.common.cancel}
              </Button>
              <SplitSubmitButton
                changeRequestAction={{
                  label: fmt(messages.createNode.createRequest, {
                    type: activeTypeName,
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

          <TabsContent className="mt-0 flex min-h-0 flex-1 flex-col gap-3" value="agent">
            <p className="text-muted-foreground text-sm">{messages.createNode.agentTabHint}</p>
            {/* Keep the expanded target picker reachable on narrow viewports. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AgentPromptsView
                agentIntegration={agentIntegration}
                askAgent={orpc ? { orpc, sessionScopeId: askAgentScopeId } : null}
                capabilities={createPrompts.capabilities}
                onHandedOff={() => onOpenChange(false)}
                scenarios={createPrompts.scenarios}
              />
            </div>
          </TabsContent>

          <TabsContent className="mt-0 flex min-h-0 flex-col gap-3" value="template">
            <p className="text-muted-foreground text-sm">{messages.createNode.templateTabHint}</p>
            {orpc ? (
              <div className="max-h-[46vh] overflow-y-auto pr-1">
                <TemplateCatalogGrid onOpenTemplate={openTemplate} orpc={orpc} />
              </div>
            ) : null}
            <button
              className="flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
              onClick={() => openTemplate()}
              type="button"
            >
              {messages.createNode.templatesBrowseAll}
              <ArrowRight className="size-4" />
            </button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The catalog read, isolated so it only happens when someone looks.
 *
 * A separate component rather than a query in the modal because Radix does not
 * mount an inactive `TabsContent` — so "fetch when the tab is opened" needs no
 * `enabled` flag, no tracking of which tab is active, and no fake `queryFn` to
 * satisfy the types while disabled. Mounting IS the trigger.
 */
function TemplateCatalogGrid({
  orpc,
  onOpenTemplate,
}: {
  orpc: BusabaseQueryUtils;
  onOpenTemplate: (name: string) => void;
}) {
  const messages = useCoreI18n();
  const catalog = useQuery(orpc.templates.list.queryOptions({ input: {} }));
  return (
    <TemplateGrid
      columnsClassName="sm:grid-cols-2"
      emptyLabel={messages.createNode.templatesEmpty}
      error={catalog.data?.error}
      isPending={catalog.isPending}
      onOpenTemplate={(template) => onOpenTemplate(template.name)}
      skeletonCount={2}
      templates={catalog.data?.templates ?? []}
    />
  );
}
