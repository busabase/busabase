"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import type { LucideIcon } from "lucide-react";
import { Check, Languages, Vault, Webhook } from "lucide-react";
import { useState } from "react";
import type { VaultSettingsLabels } from "~/domains/vault/components/vault-settings-tab";
import { VaultSettingsTab } from "~/domains/vault/components/vault-settings-tab";
import type { WebhookSettingsLabels } from "~/domains/webhook/components/webhook-settings-tab";
import { WebhookSettingsTab } from "~/domains/webhook/components/webhook-settings-tab";
import type { TranslationFunctions } from "~/i18n/i18n-types";

export type SettingsDialogLabels = TranslationFunctions["settingsDialog"];

interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
}

type SettingsTab = "language" | "vault" | "webhook";

interface Props {
  labels: SettingsDialogLabels;
  vaultLabels: VaultSettingsLabels;
  webhookLabels: WebhookSettingsLabels;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  languageOptions: LanguageOption[];
  languagePref: string;
  onLocaleChange: (locale: string) => void;
}

function LanguageTabContent({
  languageOptions,
  languagePref,
  onLocaleChange,
}: {
  languageOptions: LanguageOption[];
  languagePref: string;
  onLocaleChange: (locale: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {languageOptions.map((option) => {
        const isActive = option.code === languagePref;
        return (
          <button
            key={option.code}
            type="button"
            onClick={() => onLocaleChange(option.code)}
            className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent ${
              isActive ? "bg-accent" : ""
            }`}
          >
            <span>{option.nativeName || option.name}</span>
            {isActive ? <Check className="ml-auto size-4" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsDialog({
  labels,
  vaultLabels,
  webhookLabels,
  open,
  onOpenChange,
  languageOptions,
  languagePref,
  onLocaleChange,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("language");

  const tabs: { id: SettingsTab; icon: LucideIcon; label: string }[] = [
    { id: "language", icon: Languages, label: labels.languageTab() },
    { id: "vault", icon: Vault, label: labels.vaultTab() },
    { id: "webhook", icon: Webhook, label: labels.webhookTab() },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{labels.title()}</DialogTitle>
          <DialogDescription>{labels.description()}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-48 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent ${
                  activeTab === tab.id ? "bg-accent font-medium" : "text-muted-foreground"
                }`}
              >
                <tab.icon className="size-4" />
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
            {activeTab === "language" ? (
              <LanguageTabContent
                languageOptions={languageOptions}
                languagePref={languagePref}
                onLocaleChange={onLocaleChange}
              />
            ) : null}
            {activeTab === "vault" ? (
              <VaultSettingsTab labels={vaultLabels} active={activeTab === "vault"} />
            ) : null}
            {activeTab === "webhook" ? (
              <WebhookSettingsTab labels={webhookLabels} active={activeTab === "webhook"} />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
