"use client";

import { Alert, AlertDescription, AlertTitle } from "kui/alert";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Loader2, Palette } from "lucide-react";
import { AvatarUpload } from "openlib/ui/avatar-upload";
import { useEffect, useState } from "react";
import type { TranslationFunctions } from "~/i18n/i18n-types";
import { fetchAppBranding, notifyAppBrandingChanged } from "../hooks/use-app-branding";
import type { AppBrandingVO } from "../types/app-branding";

export type AppBrandingSettingsLabels = TranslationFunctions["appBranding"];

interface Props {
  labels: AppBrandingSettingsLabels;
  /** Whether this tab is the active one — gates the initial load. */
  active: boolean;
  /** Built-in defaults, shown as placeholders when a field is left empty. */
  defaults: { name: string; description: string; logoUrl: string };
}

interface FormState {
  name: string;
  description: string;
  logoUrl: string;
}

const EMPTY_FORM: FormState = { name: "", description: "", logoUrl: "" };

/**
 * A sidebar logo renders at ~24px, and nothing near the 25MB attachment ceiling
 * belongs in a chrome slot loaded on every page — so we refuse it client-side,
 * before spending the upload, with a plain explanation. The server enforces the
 * same cap; this check is only for the fast, friendly message.
 */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const toForm = (branding: AppBrandingVO | null): FormState => ({
  name: branding?.name ?? "",
  description: branding?.description ?? "",
  logoUrl: branding?.logoUrl ?? "",
});

/**
 * Send the cropped image to the app-local branding upload route, which stores
 * it as a plain attachment (deliberately NOT a Drive asset — an asset row would
 * sit in the Assets library flagged "unused" and be deletable, quietly breaking
 * the logo) and answers with the URL to save.
 */
const uploadLogo = async (file: File, labels: AppBrandingSettingsLabels): Promise<string> => {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/branding/logo", { method: "POST", body });
  const payload = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!res.ok || !payload?.url) {
    // The route's 400s explain the actual problem (type, size); fall back to
    // the generic message when there's nothing useful to show.
    throw new Error(payload?.error || labels.logoUploadFailed());
  }
  return payload.url;
};

export function AppBrandingSettingsTab({ labels, active, defaults }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setIsLoading(true);
    void fetchAppBranding().then((branding) => {
      if (cancelled) return;
      setForm(toForm(branding));
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const save = async (next: FormState) => {
    setError(null);
    setSaved(false);
    setIsSaving(true);
    try {
      const res = await fetch("/api/branding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(labels.saveFailed());
      const branding = (await res.json()) as AppBrandingVO;
      setForm(toForm(branding));
      notifyAppBrandingChanged(branding);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.saveFailed());
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * `AvatarUpload` hands back both the file the operator picked and the blob it
   * cropped; only the cropped one is uploaded, so what the sidebar shows is
   * exactly what was framed in the dialog. The blob has no name of its own, so
   * it is rewrapped as a `File` carrying the original name — the server mints
   * its own storage key from the MIME type and keeps this only as a label.
   *
   * PNG, not JPEG (see `outputMimeType` below): a logo with a transparent
   * background must not come back with black behind it.
   */
  const handleCroppedLogo = async (originalFile: File, croppedBlob: Blob) => {
    setSaved(false);
    setError(null);
    setIsUploading(true);
    try {
      const croppedFile = new File([croppedBlob], originalFile.name, { type: "image/png" });
      const url = await uploadLogo(croppedFile, labels);
      // Persist immediately: the dialog closing with nothing saved would read
      // as "the upload did nothing".
      await save({ ...form, logoUrl: url });
    } catch (caught) {
      // Surfaced here rather than rethrown, so `AvatarUpload` doesn't replace
      // the route's specific 400 ("must be PNG/JPG/…") with a generic message.
      setError(caught instanceof Error ? caught.message : labels.logoUploadFailed());
    } finally {
      setIsUploading(false);
    }
  };

  const updateField = (field: keyof FormState, value: string) => {
    setSaved(false);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const isPristine = !form.name && !form.description && !form.logoUrl;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <Alert>
        <Palette className="h-4 w-4" />
        <AlertTitle>{labels.title()}</AlertTitle>
        <AlertDescription>{labels.description()}</AlertDescription>
      </Alert>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="app-branding-name">{labels.nameLabel()}</Label>
        <Input
          id="app-branding-name"
          value={form.name}
          disabled={isLoading || isSaving}
          placeholder={defaults.name}
          onChange={(event) => updateField("name", event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="app-branding-description">{labels.descriptionLabel()}</Label>
        <Input
          id="app-branding-description"
          value={form.description}
          disabled={isLoading || isSaving}
          placeholder={defaults.description}
          onChange={(event) => updateField("description", event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{labels.logoLabel()}</Label>

        {/*
          Same pick-then-crop step as the hosted app's space logo: the sidebar
          slot is square, so letting the operator frame the image beats
          silently squashing whatever they picked.
          `currentAvatar` falls back to the built-in default so the preview is
          never empty, but Remove is only wired up once there is a custom logo
          to remove.
        */}
        <AvatarUpload
          currentAvatar={form.logoUrl || defaults.logoUrl}
          fallback={(form.name || defaults.name).charAt(0).toUpperCase()}
          alt={labels.logoPreviewAlt()}
          size="md"
          disabled={isLoading || isSaving || isUploading}
          onUploadComplete={handleCroppedLogo}
          onRemove={form.logoUrl ? () => void save({ ...form, logoUrl: "" }) : undefined}
          onError={setError}
          uploadLabel={isUploading ? labels.logoUploading() : labels.logoUploadButton()}
          removeLabel={labels.logoRemoveButton()}
          fileHint={labels.logoUploadHint()}
          cropLabel={labels.logoCropTitle()}
          cropHint={labels.logoCropHint()}
          cancelLabel={labels.logoCropCancel()}
          confirmLabel={labels.logoCropConfirm()}
          maxBytes={MAX_LOGO_BYTES}
          invalidTypeMessage={labels.logoNotAnImage()}
          tooLargeMessage={labels.logoTooLarge()}
          uploadFailedMessage={labels.logoUploadFailed()}
          outputMimeType="image/png"
        />

        <Label className="mt-1.5" htmlFor="app-branding-logo-url">
          {labels.logoUrlLabel()}
        </Label>
        <Input
          id="app-branding-logo-url"
          value={form.logoUrl}
          disabled={isLoading || isSaving || isUploading}
          placeholder={defaults.logoUrl}
          onChange={(event) => updateField("logoUrl", event.target.value)}
        />
        <p className="text-muted-foreground text-xs">{labels.logoUrlHint()}</p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {saved && !error ? (
        <Alert>
          <AlertDescription>{labels.saved()}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => save(form)}
          disabled={isLoading || isSaving || isUploading}
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {labels.saveButton()}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => save(EMPTY_FORM)}
          disabled={isLoading || isSaving || isUploading || isPristine}
        >
          {labels.resetButton()}
        </Button>
      </div>

      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">{labels.aboutTitle()}</div>
        <div>{labels.aboutDescription()}</div>
      </div>
    </div>
  );
}
