"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { localizeCoreErrorMessage } from "../../../i18n/localize-error";
import {
  FormBaseBindingPicker,
  type FormBindingDraft,
  toFormBindings,
} from "./form-base-binding-picker";

interface FormSetupDialogProps {
  orpc: BusabaseQueryUtils;
  /** The Form node to bind. Accepts the node id or the node slug, like `forms.getByNode`. */
  nodeId: string;
  nodeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

/**
 * Bind an existing, unconfigured Form node to a Base — the way OUT of
 * "Form not set up yet".
 *
 * Deliberately NOT a `SplitSubmitButton`: `forms.create` takes no `autoMerge`
 * and `createForm` is a direct, owner-managed insert (the same shape
 * `forms.update` already uses from the share dialog), so there is no pending
 * ChangeRequest branch to offer and no `/inbox/{id}` to route to. Offering a
 * "propose for review" option that the endpoint cannot honour would be a lie
 * about what the button does.
 */
export function FormSetupDialog({
  orpc,
  nodeId,
  nodeName,
  open,
  onOpenChange,
  onCreated,
}: FormSetupDialogProps) {
  const messages = useCoreI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<FormBindingDraft>({ targetBaseId: "", fieldSlugs: [] });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation(orpc.forms.create.mutationOptions());

  const close = (next: boolean) => {
    if (!next) {
      setDraft({ targetBaseId: "", fieldSlugs: [] });
      setError(null);
      create.reset();
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (!draft.targetBaseId) {
      setError(messages.form.targetBaseRequired);
      return;
    }
    if (draft.fieldSlugs.length === 0) {
      setError(messages.form.collectFieldsRequired);
      return;
    }
    setError(null);
    try {
      await create.mutateAsync({
        nodeId,
        targetBaseId: draft.targetBaseId,
        name: nodeName,
        bindings: toFormBindings(draft),
      });
      // The empty state and the rendered form are the same component reading the
      // same query, so invalidating flips one into the other in place — no reload.
      await queryClient.invalidateQueries({
        queryKey: orpc.forms.getByNode.key({ input: { nodeId } }),
      });
      onCreated?.();
      close(false);
    } catch (caught) {
      // `FORM_ALREADY_EXISTS` and the `Requires manage access…` refusals arrive
      // as raw English server strings; this is the shared mapper that turns the
      // ones we have copy for into the reader's language.
      setError(
        localizeCoreErrorMessage(
          messages,
          caught instanceof Error ? caught.message : messages.form.setUpFailed,
        ),
      );
    }
  };

  return (
    <Dialog onOpenChange={close} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{messages.form.setUpTitle}</DialogTitle>
          <DialogDescription>{messages.form.setUpDescription}</DialogDescription>
        </DialogHeader>

        <FormBaseBindingPicker
          disabled={create.isPending}
          idPrefix="form-setup"
          onChange={(next) => {
            setDraft(next);
            setError(null);
          }}
          orpc={orpc}
          value={draft}
        />

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button disabled={create.isPending} onClick={() => close(false)} variant="outline">
            {messages.common.cancel}
          </Button>
          <Button disabled={create.isPending || !draft.targetBaseId} onClick={() => void submit()}>
            {create.isPending ? messages.form.setUpSaving : messages.form.setUpSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
