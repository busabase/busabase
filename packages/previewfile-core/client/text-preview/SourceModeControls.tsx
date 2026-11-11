"use client";

import { useI18n } from "../i18n";

const modes = {
  en: ["Preview", "Source"],
  "zh-CN": ["预览", "源码"],
  "zh-TW": ["預覽", "原始碼"],
  ja: ["プレビュー", "ソース"],
  ko: ["미리보기", "소스"],
  es: ["Vista previa", "Código fuente"],
  pt: ["Prévia", "Código-fonte"],
  fr: ["Aperçu", "Source"],
  de: ["Vorschau", "Quelltext"],
  vi: ["Xem trước", "Mã nguồn"],
};

/** Shared controls for a rendered preview and its unchanged UTF-8 source. */
export function SourceModeControls({
  source,
  onChange,
}: {
  source: boolean;
  onChange: (source: boolean) => void;
}) {
  const { language } = useI18n();
  return (
    <div className="mb-3 flex gap-1" role="group">
      {[false, true].map((showSource) => (
        <button
          key={String(showSource)}
          type="button"
          aria-pressed={source === showSource}
          className={`rounded-md border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${source === showSource ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-accent"}`}
          onClick={() => onChange(showSource)}
        >
          {modes[language][showSource ? 1 : 0]}
        </button>
      ))}
    </div>
  );
}

export function LiteralTextSource({ text }: { text: string }) {
  return (
    <pre
      className="m-0 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed [overflow-wrap:anywhere]"
      data-testid="attachment-text-content"
    >
      {text}
    </pre>
  );
}
