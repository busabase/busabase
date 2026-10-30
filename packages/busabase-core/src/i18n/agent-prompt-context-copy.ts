import type { CoreLocale } from "./locales";

const copy: Record<CoreLocale, { inspect: string; fallback: string }> = {
  en: {
    inspect: "Inspect prompt context",
    fallback:
      "This agent does not support embedded context. The complete prompt context was sent as text instead.",
  },
  "zh-CN": {
    inspect: "查看提示词上下文",
    fallback: "此 Agent 不支持嵌入上下文，已将完整提示词上下文作为文本发送。",
  },
  "zh-TW": {
    inspect: "查看提示詞上下文",
    fallback: "此 Agent 不支援嵌入上下文，已將完整提示詞上下文以文字傳送。",
  },
  ja: {
    inspect: "プロンプトのコンテキストを確認",
    fallback:
      "このエージェントは埋め込みコンテキストに対応していないため、完全なプロンプトコンテキストをテキストとして送信しました。",
  },
  ko: {
    inspect: "프롬프트 컨텍스트 확인",
    fallback:
      "이 에이전트는 임베디드 컨텍스트를 지원하지 않아 전체 프롬프트 컨텍스트를 텍스트로 전송했습니다.",
  },
  de: {
    inspect: "Prompt-Kontext ansehen",
    fallback:
      "Dieser Agent unterstützt keinen eingebetteten Kontext. Der vollständige Prompt-Kontext wurde als Text gesendet.",
  },
  es: {
    inspect: "Ver contexto del prompt",
    fallback:
      "Este agente no admite contexto incrustado. El contexto completo del prompt se envió como texto.",
  },
  fr: {
    inspect: "Voir le contexte du prompt",
    fallback:
      "Cet agent ne prend pas en charge le contexte intégré. Le contexte complet du prompt a été envoyé sous forme de texte.",
  },
  pt: {
    inspect: "Ver contexto do prompt",
    fallback:
      "Este agente não suporta contexto incorporado. O contexto completo do prompt foi enviado como texto.",
  },
  vi: {
    inspect: "Xem ngữ cảnh lời nhắc",
    fallback:
      "Agent này không hỗ trợ ngữ cảnh nhúng. Toàn bộ ngữ cảnh lời nhắc đã được gửi dưới dạng văn bản.",
  },
};

export const agentPromptContextCopy = (locale: CoreLocale) => copy[locale];
