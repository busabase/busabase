import type { CoreLocale } from "./locales";

const english = [
  "Buda authorization was not completed. Try again.",
  "Buda authorization expired or could not be verified. Try again.",
  "Buda authorization was declined. Try again when ready.",
  "Your session expired. Sign in again, then retry Buda authorization.",
  "You no longer have permission to connect Buda to this workspace.",
  "Buda is temporarily unavailable. Try authorization again.",
  "Authorization window closed. Check your saved connections or try again.",
  "Complete Buda authorization in the new window…",
] as const;

const translations: Record<CoreLocale, readonly string[]> = {
  en: english,
  "zh-CN": [
    "Buda 授权未完成，请重试。",
    "Buda 授权已过期或无法验证，请重试。",
    "已取消 Buda 授权，请在准备好后重试。",
    "登录会话已过期，请重新登录后重试 Buda 授权。",
    "你已无权将 Buda 连接到此工作空间。",
    "Buda 暂时不可用，请重新授权。",
    "授权窗口已关闭。请查看已保存的连接，或重试。",
    "请在新窗口完成 Buda 授权…",
  ],
  "zh-TW": [
    "Buda 授權未完成，請重試。",
    "Buda 授權已過期或無法驗證，請重試。",
    "已取消 Buda 授權，請在準備好後重試。",
    "登入工作階段已過期，請重新登入後重試 Buda 授權。",
    "你已無權將 Buda 連接到此工作空間。",
    "Buda 暫時無法使用，請重新授權。",
    "授權視窗已關閉。請查看已儲存的連線，或重試。",
    "請在新視窗完成 Buda 授權…",
  ],
  ja: [
    "Buda の認証が完了しませんでした。もう一度お試しください。",
    "Buda の認証が期限切れか確認できません。もう一度お試しください。",
    "Buda の認証がキャンセルされました。準備ができたら再試行してください。",
    "セッションの有効期限が切れました。再ログインして Buda を認証してください。",
    "このワークスペースに Buda を接続する権限がありません。",
    "Buda は一時的に利用できません。認証を再試行してください。",
    "認証ウィンドウが閉じられました。保存済みの接続を確認するか再試行してください。",
    "新しいウィンドウで Buda の認証を完了してください…",
  ],
  ko: [
    "Buda 인증이 완료되지 않았습니다. 다시 시도해 주세요.",
    "Buda 인증이 만료되었거나 확인할 수 없습니다. 다시 시도해 주세요.",
    "Buda 인증이 취소되었습니다. 준비되면 다시 시도해 주세요.",
    "세션이 만료되었습니다. 다시 로그인한 후 Buda 인증을 시도해 주세요.",
    "이 워크스페이스에 Buda를 연결할 권한이 없습니다.",
    "Buda를 일시적으로 사용할 수 없습니다. 인증을 다시 시도해 주세요.",
    "인증 창이 닫혔습니다. 저장된 연결을 확인하거나 다시 시도해 주세요.",
    "새 창에서 Buda 인증을 완료해 주세요…",
  ],
  es: [
    "La autorización de Buda no se completó. Inténtalo de nuevo.",
    "La autorización de Buda caducó o no pudo verificarse. Inténtalo de nuevo.",
    "La autorización de Buda se canceló. Inténtalo de nuevo cuando quieras.",
    "Tu sesión caducó. Inicia sesión y vuelve a autorizar Buda.",
    "Ya no tienes permiso para conectar Buda a este espacio de trabajo.",
    "Buda no está disponible temporalmente. Vuelve a intentar la autorización.",
    "La ventana de autorización se cerró. Revisa las conexiones guardadas o inténtalo de nuevo.",
    "Completa la autorización de Buda en la nueva ventana…",
  ],
  fr: [
    "L’autorisation Buda n’a pas abouti. Réessayez.",
    "L’autorisation Buda a expiré ou n’a pas pu être vérifiée. Réessayez.",
    "L’autorisation Buda a été annulée. Réessayez lorsque vous le souhaitez.",
    "Votre session a expiré. Reconnectez-vous, puis autorisez à nouveau Buda.",
    "Vous n’avez plus l’autorisation de connecter Buda à cet espace de travail.",
    "Buda est temporairement indisponible. Réessayez l’autorisation.",
    "La fenêtre d’autorisation est fermée. Vérifiez les connexions enregistrées ou réessayez.",
    "Terminez l’autorisation Buda dans la nouvelle fenêtre…",
  ],
  de: [
    "Die Buda-Autorisierung wurde nicht abgeschlossen. Versuchen Sie es erneut.",
    "Die Buda-Autorisierung ist abgelaufen oder konnte nicht bestätigt werden. Versuchen Sie es erneut.",
    "Die Buda-Autorisierung wurde abgebrochen. Versuchen Sie es erneut, wenn Sie bereit sind.",
    "Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an und autorisieren Sie Buda erneut.",
    "Sie dürfen Buda nicht mehr mit diesem Arbeitsbereich verbinden.",
    "Buda ist vorübergehend nicht verfügbar. Versuchen Sie die Autorisierung erneut.",
    "Das Autorisierungsfenster wurde geschlossen. Prüfen Sie gespeicherte Verbindungen oder versuchen Sie es erneut.",
    "Schließen Sie die Buda-Autorisierung im neuen Fenster ab…",
  ],
  pt: [
    "A autorização do Buda não foi concluída. Tente novamente.",
    "A autorização do Buda expirou ou não pôde ser verificada. Tente novamente.",
    "A autorização do Buda foi cancelada. Tente novamente quando quiser.",
    "Sua sessão expirou. Entre novamente e tente autorizar o Buda.",
    "Você não tem mais permissão para conectar o Buda a este espaço de trabalho.",
    "O Buda está temporariamente indisponível. Tente autorizar novamente.",
    "A janela de autorização foi fechada. Verifique as conexões salvas ou tente novamente.",
    "Conclua a autorização do Buda na nova janela…",
  ],
  vi: [
    "Chưa hoàn tất ủy quyền Buda. Vui lòng thử lại.",
    "Ủy quyền Buda đã hết hạn hoặc không thể xác minh. Vui lòng thử lại.",
    "Ủy quyền Buda đã bị hủy. Vui lòng thử lại khi sẵn sàng.",
    "Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử ủy quyền Buda.",
    "Bạn không còn quyền kết nối Buda với không gian làm việc này.",
    "Buda tạm thời không khả dụng. Vui lòng thử ủy quyền lại.",
    "Cửa sổ ủy quyền đã đóng. Kiểm tra kết nối đã lưu hoặc thử lại.",
    "Hoàn tất ủy quyền Buda trong cửa sổ mới…",
  ],
};

const reasonIndexes: Record<string, number> = {
  invalid_state: 1,
  expired: 1,
  access_denied: 2,
  session_expired: 3,
  forbidden: 4,
  unavailable: 5,
  closed: 6,
  waiting: 7,
};

for (const [locale, values] of Object.entries(translations)) {
  if (values.length !== english.length || values.some((value) => !value)) {
    throw new Error(`Incomplete Buda authorization copy for ${locale}`);
  }
}

export function budaOauthText(locale: CoreLocale, reason: unknown): string {
  const index =
    typeof reason === "string" && Object.hasOwn(reasonIndexes, reason)
      ? (reasonIndexes[reason] ?? 0)
      : 0;
  return translations[locale][index] ?? english[index] ?? english[0];
}
