"use client";

import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
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
import { useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { nodeIconForId } from "../helpers/node-icons";
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

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

interface CreateNodeModalProps {
  open: boolean;
  apiClient: BusabaseDashboardApiClient;
  onOpenChange: (open: boolean) => void;
  /** `mode` is "change-request" when submitted normally, "merged" after approve+merge. */
  onCreated: (changeRequestId: string, mode: "change-request" | "merged") => void;
  /** When opened from a folder's "+", the new node is created inside it. */
  parent?: { id: string; name: string } | null;
}

export function CreateNodeModal({
  open,
  apiClient,
  onOpenChange,
  onCreated,
  parent,
}: CreateNodeModalProps) {
  const messages = useCoreI18n();
  const [selectedType, setSelectedType] = useState(CREATABLE_TYPES[0]?.type ?? "base");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeType =
    CREATABLE_TYPES.find((entry) => entry.type === selectedType) ?? CREATABLE_TYPES[0];

  const reset = () => {
    setName("");
    setSlug("");
    setDescription("");
    setSlugEdited(false);
    setError(null);
  };

  const buildOperations = (trimmedName: string, finalSlug: string) => [
    {
      kind: "create" as const,
      nodeType: selectedType,
      parentNodeId: parent?.id,
      slug: finalSlug,
      name: trimmedName,
      description: description.trim(),
      // A Base needs at least one field; start with a Title to build on.
      ...(selectedType === "base"
        ? {
            fields: [{ slug: "title", name: "Title", type: "text" as const, required: true }],
          }
        : {}),
    },
  ];

  const submitAsChangeRequest = async () => {
    const trimmedName = name.trim();
    const finalSlug = (slugEdited ? slug : toSlug(trimmedName)).trim();
    if (!trimmedName || !finalSlug) {
      setError(messages.createNode.nameRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const changeRequest = await apiClient.createNodeChangeRequest({
        message: fmt(messages.createNode.message, {
          name: trimmedName,
          type: activeType?.label ?? "item",
        }),
        operations: buildOperations(trimmedName, finalSlug),
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
    const finalSlug = (slugEdited ? slug : toSlug(trimmedName)).trim();
    if (!trimmedName || !finalSlug) {
      setError(messages.createNode.nameRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const changeRequest = await apiClient.createNodeChangeRequest({
        message: fmt(messages.createNode.message, {
          name: trimmedName,
          type: activeType?.label ?? "item",
        }),
        operations: buildOperations(trimmedName, finalSlug),
      });
      await apiClient.approveChangeRequest(changeRequest.id, messages.createNode.autoApproved);
      await apiClient.mergeChangeRequest(changeRequest.id);
      reset();
      onOpenChange(false);
      onCreated(changeRequest.id, "merged");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.createNode.couldNotCreate);
    } finally {
      setSubmitting(false);
    }
  };

  const isDisabled = submitting || name.trim().length === 0;

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {fmt(messages.createNode.title, {
              suffix: parent ? fmt(messages.createNode.parentSuffix, { name: parent.name }) : "",
            })}
          </DialogTitle>
          <DialogDescription>
            {parent
              ? fmt(messages.createNode.descriptionInParent, { name: parent.name })
              : messages.createNode.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-4 gap-2">
            {CREATABLE_TYPES.map((entry) => {
              const Icon = entry.icon;
              const isSelected = entry.type === selectedType;
              return (
                <button
                  className={`flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                  key={entry.type}
                  onClick={() => setSelectedType(entry.type)}
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
                  setSlug(toSlug(event.target.value));
                }
              }}
              placeholder={fmt(messages.createNode.itemNamePlaceholder, {
                type: activeType?.label ?? "Item",
              })}
              value={name}
            />
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">{messages.common.slug}</span>
            <Input
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(toSlug(event.target.value));
              }}
              placeholder="my-slug"
              value={slug}
            />
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">{messages.createNode.descriptionOptional}</span>
            <Input
              onChange={(event) => setDescription(event.target.value)}
              placeholder={messages.createNode.descriptionPlaceholder}
              value={description}
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button disabled={submitting} onClick={() => onOpenChange(false)} variant="outline">
            {messages.common.cancel}
          </Button>
          <SplitSubmitButton
            disabled={isDisabled}
            isPrimaryLoading={submitting}
            primaryLabel={fmt(messages.createNode.createRequest, {
              type: activeType?.label ?? "",
            })}
            primaryLoadingLabel={messages.createNode.creating}
            secondaryLabel={messages.createNode.createNow}
            secondaryLoadingLabel={messages.createNode.creating}
            onPrimary={submitAsChangeRequest}
            onSecondary={submitAndMerge}
            hint={messages.createNode.hint}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
