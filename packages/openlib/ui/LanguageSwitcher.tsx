"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { cn } from "kui/utils";
import { Check, Languages } from "lucide-react";

export interface LanguageOption {
  code: string;
  name: string;
  nativeName?: string;
}

export interface LanguageSwitcherProps {
  /** Array of available languages */
  languages: LanguageOption[];
  /** Current language code */
  currentLang: string;
  /** Callback when language is changed - REQUIRED */
  onLanguageChange: (langCode: string) => void;
  /** Show native language names */
  showNativeNames?: boolean;
  /** Icon size */
  iconSize?: number;
  /** Display mode: 'icon-only' or 'with-text' */
  mode?: "icon-only" | "with-text";
  /** Custom className for styling */
  className?: string;
}

/**
 * A pure, business-agnostic language switcher component
 * Uses kui DropdownMenu for reliable positioning
 * Behavior is handled by the onLanguageChange callback
 */
export function LanguageSwitcher({
  languages,
  currentLang,
  onLanguageChange,
  showNativeNames = true,
  iconSize = 16,
  mode = "with-text",
  className,
}: LanguageSwitcherProps) {
  const currentLanguage = languages.find((lang) => lang.code === currentLang) || languages[0];

  const handleLanguageClick = (langCode: string) => {
    if (langCode !== currentLang) {
      onLanguageChange(langCode);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-transparent hover:bg-accent/50 transition-colors outline-none cursor-pointer",
          mode === "icon-only" && "px-2 py-2",
          className,
        )}
      >
        <Languages size={iconSize} className="opacity-70" />
        {mode === "with-text" && (
          <span className="hidden sm:inline">
            {showNativeNames && currentLanguage?.nativeName
              ? currentLanguage.nativeName
              : currentLanguage?.name || "English"}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="w-52 bg-background border border-border shadow-lg"
      >
        {languages.map((lang) => {
          const isActive = currentLang === lang.code;

          return (
            <DropdownMenuItem
              key={lang.code}
              onClick={() => handleLanguageClick(lang.code)}
              className={cn(
                "flex items-center justify-between gap-3 w-full cursor-pointer",
                isActive && "bg-accent",
              )}
            >
              <span className={cn(isActive && "font-semibold")}>
                {showNativeNames && lang.nativeName ? lang.nativeName : lang.name}
              </span>
              {isActive && <Check size={16} className="flex-shrink-0" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default LanguageSwitcher;
