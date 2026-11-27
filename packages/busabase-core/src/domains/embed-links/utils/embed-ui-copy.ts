/** Small, shared copy for the content-only Embed host, outside the dashboard catalog. */
const EN = {
  unavailable: "Content unavailable",
  expired: "Link expired",
  connectionLost: "The connection was interrupted. Check your network and retry.",
  retry: "Retry",
  navigationUnavailable: "This link is not included in the embedded content.",
  dismiss: "Dismiss",
};

type EmbedUiCopy = typeof EN;

const COPY: Record<string, EmbedUiCopy> = {
  en: EN,
  "zh-cn": {
    unavailable: "内容不可用",
    expired: "链接已过期",
    connectionLost: "连接已中断，请检查网络后重试。",
    retry: "重试",
    navigationUnavailable: "此链接不包含在当前嵌入内容中。",
    dismiss: "关闭提示",
  },
  "zh-tw": {
    unavailable: "內容不可用",
    expired: "連結已過期",
    connectionLost: "連線已中斷，請檢查網路後重試。",
    retry: "重試",
    navigationUnavailable: "此連結不包含在目前嵌入的內容中。",
    dismiss: "關閉提示",
  },
  ja: {
    unavailable: "コンテンツを利用できません",
    expired: "リンクの有効期限が切れました",
    connectionLost: "接続が中断されました。ネットワークを確認して再試行してください。",
    retry: "再試行",
    navigationUnavailable: "このリンクは埋め込みコンテンツに含まれていません。",
    dismiss: "閉じる",
  },
  ko: {
    unavailable: "콘텐츠를 사용할 수 없습니다",
    expired: "링크가 만료되었습니다",
    connectionLost: "연결이 끊겼습니다. 네트워크를 확인한 후 다시 시도하세요.",
    retry: "다시 시도",
    navigationUnavailable: "이 링크는 임베드된 콘텐츠에 포함되어 있지 않습니다.",
    dismiss: "닫기",
  },
  de: {
    unavailable: "Inhalt nicht verfügbar",
    expired: "Link abgelaufen",
    connectionLost:
      "Die Verbindung wurde unterbrochen. Prüfen Sie Ihr Netzwerk und versuchen Sie es erneut.",
    retry: "Erneut versuchen",
    navigationUnavailable: "Dieser Link ist nicht im eingebetteten Inhalt enthalten.",
    dismiss: "Schließen",
  },
  es: {
    unavailable: "Contenido no disponible",
    expired: "Enlace caducado",
    connectionLost: "La conexión se interrumpió. Comprueba la red y vuelve a intentarlo.",
    retry: "Reintentar",
    navigationUnavailable: "Este enlace no está incluido en el contenido integrado.",
    dismiss: "Cerrar",
  },
  fr: {
    unavailable: "Contenu indisponible",
    expired: "Lien expiré",
    connectionLost: "La connexion a été interrompue. Vérifiez votre réseau et réessayez.",
    retry: "Réessayer",
    navigationUnavailable: "Ce lien ne fait pas partie du contenu intégré.",
    dismiss: "Fermer",
  },
  pt: {
    unavailable: "Conteúdo indisponível",
    expired: "Link expirado",
    connectionLost: "A conexão foi interrompida. Verifique a rede e tente novamente.",
    retry: "Tentar novamente",
    navigationUnavailable: "Este link não está incluído no conteúdo incorporado.",
    dismiss: "Fechar",
  },
  vi: {
    unavailable: "Nội dung không khả dụng",
    expired: "Liên kết đã hết hạn",
    connectionLost: "Kết nối bị gián đoạn. Hãy kiểm tra mạng và thử lại.",
    retry: "Thử lại",
    navigationUnavailable: "Liên kết này không nằm trong nội dung được nhúng.",
    dismiss: "Đóng",
  },
};

export function getEmbedUiCopy(locale = "en"): EmbedUiCopy {
  const key = locale.toLowerCase();
  return COPY[key] ?? COPY[key.split("-", 1)[0] ?? ""] ?? EN;
}
