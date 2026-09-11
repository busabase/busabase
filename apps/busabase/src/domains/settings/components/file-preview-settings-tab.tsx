"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Alert, AlertDescription, AlertTitle } from "kui/alert";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Eye, EyeOff, Loader2, Save, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { TranslationFunctions } from "~/i18n/i18n-types";

export type FilePreviewSettingsLabels = TranslationFunctions["filePreviewSettings"];

interface Props {
  active: boolean;
  labels: FilePreviewSettingsLabels;
}

export function FilePreviewSettingsTab({ active, labels }: Props) {
  const orpc = useMemo(() => createBusabaseQueryUtils("/api/rpc"), []);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const configQueryOptions = useMemo(() => orpc.fileTrees.previewConfig.queryOptions({}), [orpc]);
  const configQuery = useQuery({ ...configQueryOptions, enabled: active });

  const updateCredential = useMutation(orpc.vault.updatePreviewFileCredential.mutationOptions());

  const persistApiKey = async (nextValue: string | null) => {
    setMessage(null);
    try {
      await updateCredential.mutateAsync({ apiKey: nextValue });
      await configQuery.refetch();
      setApiKey("");
      setMessage(nextValue === null ? labels.removed() : labels.saved());
    } catch {
      setMessage(labels.saveFailed());
    }
  };

  const config = configQuery.data;
  const credentialConfigured = config?.credentialConfigured ?? false;
  const maxSizeMb = config ? Math.round(config.maxFileSizeBytes / 1024 / 1024) : null;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-medium text-base">{labels.title()}</h3>
        <p className="mt-1 text-muted-foreground text-sm">{labels.description()}</p>
      </div>

      <div className="grid gap-3 rounded-lg border bg-muted/15 p-4 sm:grid-cols-3">
        <div>
          <div className="text-muted-foreground text-xs">{labels.provider()}</div>
          <div className="mt-1 font-medium text-sm">
            {config?.provider === "previewfile" ? "PreviewFile" : labels.builtin()}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">{labels.status()}</div>
          <div className="mt-1">
            <Badge variant="outline">
              {config?.status === "ready"
                ? labels.ready()
                : config?.status === "invalid_configuration"
                  ? labels.invalid()
                  : labels.notConfigured()}
            </Badge>
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">{labels.maxFileSize()}</div>
          <div className="mt-1 font-medium text-sm">
            {maxSizeMb === null ? labels.loading() : `${maxSizeMb} MB`}
          </div>
        </div>
      </div>

      <Alert>
        <ShieldCheck className="size-4" />
        <AlertTitle>{labels.privacyTitle()}</AlertTitle>
        <AlertDescription>{labels.privacyDescription()}</AlertDescription>
      </Alert>

      {config?.vaultEncryptionConfigured === false ? (
        <Alert>
          <ShieldAlert className="size-4" />
          <AlertTitle>{labels.unencryptedTitle()}</AlertTitle>
          <AlertDescription>{labels.unencryptedDescription()}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="previewfile-api-key">{labels.apiKey()}</Label>
          <span className="text-muted-foreground text-xs">
            {credentialConfigured ? labels.apiKeyConfigured() : labels.apiKeyMissing()}
          </span>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              autoComplete="off"
              id="previewfile-api-key"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                credentialConfigured ? labels.replacePlaceholder() : labels.apiKeyPlaceholder()
              }
              type={showApiKey ? "text" : "password"}
              value={apiKey}
            />
            <button
              aria-label={showApiKey ? labels.hide() : labels.reveal()}
              className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground"
              onClick={() => setShowApiKey((value) => !value)}
              type="button"
            >
              {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <Button
            disabled={!apiKey.trim() || updateCredential.isPending}
            onClick={() => void persistApiKey(apiKey.trim())}
            type="button"
          >
            {updateCredential.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {credentialConfigured ? labels.replace() : labels.save()}
          </Button>
          {credentialConfigured ? (
            <Button
              aria-label={labels.remove()}
              disabled={updateCredential.isPending}
              onClick={() => void persistApiKey(null)}
              size="icon"
              title={labels.remove()}
              type="button"
              variant="outline"
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">{labels.apiKeyHint()}</p>
      </div>

      <div className="rounded-md border bg-muted/20 p-3 text-muted-foreground text-xs">
        <div className="mb-1 font-medium text-foreground">{labels.activationTitle()}</div>
        <div>{labels.activationDescription()}</div>
      </div>

      {configQuery.isError ? (
        <p className="text-destructive text-sm">{labels.loadFailed()}</p>
      ) : null}
      {updateCredential.isError ? (
        <p className="text-destructive text-sm">{labels.saveFailed()}</p>
      ) : null}
      {message ? <p className="text-muted-foreground text-sm">{message}</p> : null}
    </div>
  );
}
