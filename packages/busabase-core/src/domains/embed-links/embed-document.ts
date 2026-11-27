/**
 * The neutral status documents `/embed/:id` answers with when a link cannot be
 * shown — "unavailable" for every failure a visitor must not be able to tell
 * apart (bad id, wrong secret, revoked, target gone) and "expired" for the
 * holder of a real secret who arrived too late.
 *
 * Successful content is never rendered here: every target hands off to a typed
 * subroute, and ordinary nodes render with the workbench's own Node Detail
 * components (`components/public-embed-node-view.tsx`).
 */

const styles = `
:root {
  color-scheme: light dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: Canvas;
  color: CanvasText;
}
* { box-sizing: border-box; }
html, body { min-height: 100%; margin: 0; }
body { background: Canvas; color: CanvasText; }
.status { display: grid; min-height: 100vh; margin: 0; padding: 1rem; place-items: center; color: color-mix(in srgb, CanvasText 62%, transparent); text-align: center; }
`;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const documentShell = (title: string, content: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>${styles}</style></head><body><main>${content}</main></body></html>`;

type EmbedStatus = "unavailable" | "expired";

const STATUS_MESSAGES: Record<string, Record<EmbedStatus, string>> = {
  en: { unavailable: "Content unavailable", expired: "Link expired" },
  "zh-cn": { unavailable: "内容不可用", expired: "链接已过期" },
  "zh-tw": { unavailable: "內容不可用", expired: "連結已過期" },
  ja: { unavailable: "コンテンツを利用できません", expired: "リンクの有効期限が切れました" },
  ko: { unavailable: "콘텐츠를 사용할 수 없습니다", expired: "링크가 만료되었습니다" },
  de: { unavailable: "Inhalt nicht verfügbar", expired: "Link abgelaufen" },
  es: { unavailable: "Contenido no disponible", expired: "Enlace caducado" },
  fr: { unavailable: "Contenu indisponible", expired: "Lien expiré" },
  pt: { unavailable: "Conteúdo indisponível", expired: "Link expirado" },
  vi: { unavailable: "Nội dung không khả dụng", expired: "Liên kết đã hết hạn" },
};

/**
 * The status pages are all a visitor sees when an embed fails, so they follow
 * the browser's language — this document has no app i18n to lean on. Strings
 * mirror each host's `embedRuntime` translations.
 */
const statusMessages = (acceptLanguage: string | null): Record<EmbedStatus, string> => {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!tag) continue;
    if (tag === "zh" || tag.startsWith("zh-hans") || tag === "zh-sg") {
      return STATUS_MESSAGES["zh-cn"];
    }
    if (tag.startsWith("zh-hant") || tag === "zh-hk" || tag === "zh-mo") {
      return STATUS_MESSAGES["zh-tw"];
    }
    const messages = STATUS_MESSAGES[tag] ?? STATUS_MESSAGES[tag.split("-", 1)[0] ?? ""];
    if (messages) return messages;
  }
  return STATUS_MESSAGES.en;
};

const renderStatusDocument = (status: EmbedStatus, acceptLanguage: string | null): string => {
  const message = statusMessages(acceptLanguage)[status];
  // Centered like the Next-rendered status pages, so the same link reads the
  // same whichever of the two answers it.
  return documentShell(message, `<p class="status">${escapeHtml(message)}</p>`);
};

export const renderUnavailableEmbedDocument = (acceptLanguage: string | null = null): string =>
  renderStatusDocument("unavailable", acceptLanguage);

export const renderExpiredEmbedDocument = (acceptLanguage: string | null = null): string =>
  renderStatusDocument("expired", acceptLanguage);
