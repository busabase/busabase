"use client";

// Self-contained node-avatar picker: a round trigger button showing the
// node's current icon (custom or type-default), which opens a Popover with an
// emoji grid + an "upload image" row — mirrors buda's
// `AgentIconPickerContent` + its `Popover` call site
// (`apps/buda/src/domains/agent-controller/components/agent-icon-picker.tsx`
// and `agent-settings-dialog.tsx`), combined into one component since
// `NodeSettingsDialog`'s General tab is this component's only caller (no
// second host needs the trigger and the popover content split apart).

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeIcon } from "busabase-contract/types";
import { EmojiPicker, EmojiPickerContent, EmojiPickerSearch } from "kui/emoji-picker";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { cn } from "kui/utils";
import { ImageUp, Loader2 } from "lucide-react";
import { useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { resolveNodeIcon } from "../helpers/node-icons";
import { useNodeIconCropUpload } from "../hooks/use-node-icon-crop-upload";

interface NodeIconPickerProps {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeType: string;
  icon: NodeIcon | null;
  onChange: (icon: NodeIcon) => void;
}

export function NodeIconPicker({ orpc, nodeId, nodeType, icon, onChange }: NodeIconPickerProps) {
  const messages = useCoreI18n();
  const t = messages.nodeSettings;
  const [open, setOpen] = useState(false);
  const { openWithIcon, openEmpty, dialog, isUploading, uploadingPreview } = useNodeIconCropUpload({
    orpc,
    nodeId,
    onUpload: (next) => {
      onChange(next);
      setOpen(false);
    },
  });

  const hasImage = icon?.type === "attachment";
  const resolved = resolveNodeIcon({ type: nodeType, icon });

  const handleUploadClick = () => {
    if (hasImage && icon) {
      openWithIcon(icon);
    } else {
      openEmpty();
    }
  };

  return (
    <>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <button
            aria-label={t.changeIcon}
            className="group relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted/40 text-2xl shadow-sm transition-all hover:ring-4 hover:ring-primary/20"
            title={t.changeIcon}
            type="button"
          >
            {resolved.kind === "image" ? (
              <img alt="" className="size-full object-cover" src={resolved.url} />
            ) : resolved.kind === "emoji" ? (
              <span aria-hidden="true">{resolved.value}</span>
            ) : (
              <resolved.Icon aria-hidden="true" className="size-6 text-muted-foreground" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-fit p-0">
          <div className="flex w-[272px] flex-col">
            <EmojiPicker
              className={cn(
                "h-[220px] w-full rounded-none border-0 bg-transparent",
                "[&_[data-slot=emoji-picker-row]]:px-3",
                "[&_[data-slot=emoji-picker-emoji]]:size-8",
                "[&_[data-slot=emoji-picker-search-wrapper]]:mx-3",
                "[&_[data-slot=emoji-picker-search-wrapper]]:my-2",
                "[&_[data-slot=emoji-picker-search-wrapper]]:rounded-md",
                "[&_[data-slot=emoji-picker-search-wrapper]]:border",
                "[&_[data-slot=emoji-picker-search-wrapper]]:border-border/60",
                "[&_[data-slot=emoji-picker-search-wrapper]]:bg-background/40",
                "[&_[data-slot=emoji-picker-search-wrapper]]:px-2.5",
                "[&_[data-slot=emoji-picker-search-wrapper]]:h-8",
                "[&_[data-slot=emoji-picker-search]]:h-7",
                "[&_[data-slot=emoji-picker-search]]:py-0",
                "[&_[data-slot=emoji-picker-category-header]]:px-3",
              )}
              onEmojiSelect={({ emoji: selected }) => {
                onChange({ type: "emoji", value: selected });
                setOpen(false);
              }}
            >
              <EmojiPickerSearch />
              <EmojiPickerContent />
            </EmojiPicker>

            <button
              className={cn(
                "flex items-center gap-2.5 border-t px-3 py-2 text-left transition-colors",
                "hover:bg-muted/60",
                isUploading && "pointer-events-none opacity-60",
              )}
              disabled={isUploading}
              onClick={handleUploadClick}
              type="button"
            >
              <span
                className={cn(
                  "relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md",
                  uploadingPreview || hasImage
                    ? "ring-1 ring-border"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {uploadingPreview ? (
                  <>
                    <img
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                      src={uploadingPreview}
                    />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                    </span>
                  </>
                ) : isUploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : hasImage && icon ? (
                  <img alt="" className="size-full object-cover" src={icon.url} />
                ) : (
                  <ImageUp className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-xs leading-tight">{t.iconUploadLabel}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground leading-tight">
                  {t.iconUploadFormatHint}
                </p>
              </div>
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {dialog}
    </>
  );
}
