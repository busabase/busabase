"use client";

// Multilingual name input: a plain text field with a translations toggle. While
// collapsed it edits a plain string (or the active locale of a record value);
// expanded it shows one input per dashboard locale and emits a locale-keyed
// record. Values in locales outside the dashboard set are preserved untouched.
import { Languages } from "lucide-react";
import type { iString, iStringRecord } from "openlib/i18n/i-string";
import { useState } from "react";
import { type CoreLocale, coreLocaleOptions, useCoreI18n, useCoreLocale } from "../../../i18n";

const textInputClassName =
  "mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary";

export function IStringNameInput({
  label = "Name",
  onChange,
  value,
}: {
  label?: string;
  onChange: (value: iString) => void;
  value: iString;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const [expanded, setExpanded] = useState(typeof value !== "string");

  const asRecord = (): iStringRecord =>
    typeof value === "string" ? (value ? { [locale]: value } : {}) : { ...value };

  const setLocaleValue = (code: CoreLocale, text: string) => {
    const record = asRecord();
    if (text) {
      record[code] = text;
    } else {
      delete record[code];
    }
    const entries = Object.entries(record).filter(([, entry]) => entry);
    if (entries.length === 0) {
      onChange("");
      return;
    }
    // A single translation in the active locale isn't multilingual yet — keep
    // the value a plain string until a second locale is actually filled.
    if (entries.length === 1 && entries[0][0] === locale) {
      onChange(entries[0][1] as string);
      return;
    }
    onChange(record);
  };

  const filledCount =
    typeof value === "string"
      ? 0
      : coreLocaleOptions.filter((option) => value[option.code]?.trim()).length;

  return (
    <div className="block">
      <span className="flex items-center justify-between text-muted-foreground text-xs">
        <span>{label}</span>
        <button
          className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground ${
            expanded || filledCount > 0 ? "text-foreground" : ""
          }`}
          onClick={() => setExpanded((current) => !current)}
          title={messages.common.translations}
          type="button"
        >
          <Languages size={12} />
          {filledCount > 0 ? `${filledCount}/${coreLocaleOptions.length}` : null}
        </button>
      </span>
      {expanded ? (
        <div className="mt-1 grid gap-1.5">
          {coreLocaleOptions.map((option) => (
            <label className="flex items-center gap-2" key={option.code}>
              <span className="w-16 shrink-0 text-[11px] text-muted-foreground">
                {option.nativeName}
              </span>
              <input
                className={textInputClassName}
                onChange={(event) => setLocaleValue(option.code, event.target.value)}
                value={
                  typeof value === "string"
                    ? option.code === locale
                      ? value
                      : ""
                    : (value[option.code] ?? "")
                }
              />
            </label>
          ))}
        </div>
      ) : (
        <input
          className={textInputClassName}
          onChange={(event) => {
            if (typeof value === "string") {
              onChange(event.target.value);
            } else {
              setLocaleValue(locale, event.target.value);
            }
          }}
          value={
            typeof value === "string"
              ? value
              : (value[locale] ?? Object.values(value).find(Boolean) ?? "")
          }
        />
      )}
    </div>
  );
}
