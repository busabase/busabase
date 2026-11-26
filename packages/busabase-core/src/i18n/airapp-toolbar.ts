import type { CoreLocale } from "./locales";

type AirAppToolbarMessages = {
  menu: string;
  menuShort: string;
  deployedSite: string;
  viewingMode: string;
  openInNewTab: string;
  browserLogs: string;
  onlineLogs: string;
  moreActions: string;
  publish: string;
  publishUpdate: string;
  published: string;
  publicationActions: string;
  refreshPage: string;
  unpublish: string;
  unpublishTitle: string;
  unpublishDescription: string;
  unpublishDone: string;
  unpublishedHint: string;
  stalePreviewHint: string;
};

/** The preview menu is an action entry, independent of the app’s current engine. */
export const airAppToolbarMessages: Record<CoreLocale, AirAppToolbarMessages> = {
  en: {
    menuShort: "Preview",
    menu: "Preview & publish",
    deployedSite: "Deployed Site",
    viewingMode: "Viewing mode",
    openInNewTab: "Open in new tab",
    browserLogs: "Browser logs",
    onlineLogs: "Online logs",
    moreActions: "More actions",
    publish: "Publish",
    publishUpdate: "Publish update",
    published: "Published",
    publicationActions: "Publication actions",
    refreshPage: "Refresh page",
    unpublish: "Unpublish",
    unpublishTitle: "Unpublish this website?",
    unpublishDescription:
      "Visitors will no longer be able to open the public website. Your files and private preview stay available, and you can publish again later.",
    unpublishDone: "The website is unpublished.",
    unpublishedHint:
      "The latest AirApp changes are not live yet. Choose Publish update to review them.",
    stalePreviewHint:
      "This website preview is out of date. Publish update prepares the latest AirApp for review.",
  },
  "zh-CN": {
    menuShort: "预览",
    menu: "预览与发布",
    deployedSite: "已部署网站",
    viewingMode: "查看模式",
    openInNewTab: "在新标签页中打开",
    browserLogs: "浏览器日志",
    onlineLogs: "线上日志",
    moreActions: "更多操作",
    publish: "发布",
    publishUpdate: "更新发布",
    published: "已发布",
    publicationActions: "发布操作",
    refreshPage: "刷新网页",
    unpublish: "取消发布",
    unpublishTitle: "取消发布此网站？",
    unpublishDescription:
      "取消后，访客将无法打开公开网站。文件和私有预览会保留，你可以稍后重新发布。",
    unpublishDone: "网站已取消发布。",
    unpublishedHint: "AirApp 有尚未上线的修改，点击“发布更新”可先预览。",
    stalePreviewHint: "网站预览落后于当前 AirApp，点击“发布更新”可生成最新预览。",
  },
  "zh-TW": {
    menuShort: "預覽",
    menu: "預覽與發布",
    deployedSite: "已部署網站",
    viewingMode: "檢視模式",
    openInNewTab: "在新分頁中開啟",
    browserLogs: "瀏覽器記錄檔",
    onlineLogs: "線上記錄檔",
    moreActions: "更多操作",
    publish: "發布",
    publishUpdate: "更新發布",
    published: "已發布",
    publicationActions: "發布操作",
    refreshPage: "重新整理網頁",
    unpublish: "取消發布",
    unpublishTitle: "取消發布此網站？",
    unpublishDescription:
      "取消後，訪客將無法開啟公開網站。檔案和私人預覽會保留，你可以稍後重新發布。",
    unpublishDone: "網站已取消發布。",
    unpublishedHint: "AirApp 有尚未上線的修改，點擊「發布更新」可先預覽。",
    stalePreviewHint: "網站預覽落後於目前的 AirApp，點擊「發布更新」可產生最新預覽。",
  },
  ja: {
    menuShort: "プレビュー",
    menu: "プレビューと公開",
    deployedSite: "公開済みのウェブサイト",
    viewingMode: "表示モード",
    openInNewTab: "新しいタブで開く",
    browserLogs: "ブラウザログ",
    onlineLogs: "公開サイトのログ",
    moreActions: "その他の操作",
    publish: "公開",
    publishUpdate: "更新を公開",
    published: "公開済み",
    publicationActions: "公開の操作",
    refreshPage: "ページを再読み込み",
    unpublish: "公開を停止",
    unpublishTitle: "このサイトの公開を停止しますか？",
    unpublishDescription:
      "訪問者は公開サイトを開けなくなります。ファイルと非公開プレビューは保持され、後で再公開できます。",
    unpublishDone: "サイトの公開を停止しました。",
    unpublishedHint:
      "AirApp の最新の変更はまだ公開されていません。「更新を公開」から確認できます。",
    stalePreviewHint:
      "ウェブサイトのプレビューが古くなっています。「更新を公開」で最新の AirApp を確認できます。",
  },
  ko: {
    menuShort: "미리보기",
    menu: "미리보기 및 게시",
    deployedSite: "배포된 웹사이트",
    viewingMode: "보기 모드",
    openInNewTab: "새 탭에서 열기",
    browserLogs: "브라우저 로그",
    onlineLogs: "운영 로그",
    moreActions: "추가 작업",
    publish: "게시",
    publishUpdate: "업데이트 게시",
    published: "게시됨",
    publicationActions: "게시 작업",
    refreshPage: "페이지 새로고침",
    unpublish: "게시 취소",
    unpublishTitle: "이 웹사이트의 게시를 취소할까요?",
    unpublishDescription:
      "방문자는 공개 웹사이트를 열 수 없게 됩니다. 파일과 비공개 미리보기는 유지되며 나중에 다시 게시할 수 있습니다.",
    unpublishDone: "웹사이트 게시가 취소되었습니다.",
    unpublishedHint:
      "AirApp의 최신 변경 사항이 아직 게시되지 않았습니다. 업데이트 게시를 선택해 검토하세요.",
    stalePreviewHint:
      "웹사이트 미리보기가 오래되었습니다. 업데이트 게시를 선택하면 최신 AirApp 미리보기를 준비합니다.",
  },
  es: {
    menuShort: "Vista previa",
    menu: "Vista previa y publicación",
    deployedSite: "Sitio web publicado",
    viewingMode: "Modo de visualización",
    openInNewTab: "Abrir en una pestaña nueva",
    browserLogs: "Registros del navegador",
    onlineLogs: "Registros en línea",
    moreActions: "Más acciones",
    publish: "Publicar",
    publishUpdate: "Publicar actualización",
    published: "Publicado",
    publicationActions: "Acciones de publicación",
    refreshPage: "Actualizar página",
    unpublish: "Retirar publicación",
    unpublishTitle: "¿Retirar la publicación del sitio?",
    unpublishDescription:
      "Los visitantes ya no podrán abrir el sitio público. Los archivos y la vista previa privada seguirán disponibles y podrás volver a publicarlo más tarde.",
    unpublishDone: "Se ha retirado la publicación del sitio.",
    unpublishedHint:
      "Los últimos cambios de AirApp aún no están publicados. Elige Publicar actualización para revisarlos.",
    stalePreviewHint:
      "Esta vista previa está desactualizada. Publicar actualización prepara la versión más reciente de AirApp.",
  },
  pt: {
    menuShort: "Prévia",
    menu: "Prévia e publicação",
    deployedSite: "Site publicado",
    viewingMode: "Modo de visualização",
    openInNewTab: "Abrir em nova aba",
    browserLogs: "Logs do navegador",
    onlineLogs: "Logs de produção",
    moreActions: "Mais ações",
    publish: "Publicar",
    publishUpdate: "Publicar atualização",
    published: "Publicado",
    publicationActions: "Ações de publicação",
    refreshPage: "Atualizar página",
    unpublish: "Despublicar",
    unpublishTitle: "Despublicar este site?",
    unpublishDescription:
      "Os visitantes não poderão mais abrir o site público. Seus arquivos e a prévia privada continuarão disponíveis, e você poderá publicar novamente depois.",
    unpublishDone: "O site foi despublicado.",
    unpublishedHint:
      "As últimas alterações do AirApp ainda não foram publicadas. Escolha Publicar atualização para revisá-las.",
    stalePreviewHint:
      "Esta prévia está desatualizada. Publicar atualização prepara a versão mais recente do AirApp.",
  },
  vi: {
    menuShort: "Xem trước",
    menu: "Xem trước và xuất bản",
    deployedSite: "Trang web đã triển khai",
    viewingMode: "Chế độ xem",
    openInNewTab: "Mở trong thẻ mới",
    browserLogs: "Nhật ký trình duyệt",
    onlineLogs: "Nhật ký trực tuyến",
    moreActions: "Thao tác khác",
    publish: "Xuất bản",
    publishUpdate: "Xuất bản bản cập nhật",
    published: "Đã xuất bản",
    publicationActions: "Thao tác xuất bản",
    refreshPage: "Tải lại trang",
    unpublish: "Hủy xuất bản",
    unpublishTitle: "Hủy xuất bản trang web này?",
    unpublishDescription:
      "Khách truy cập sẽ không thể mở trang web công khai. Tệp và bản xem trước riêng tư vẫn được giữ lại, và bạn có thể xuất bản lại sau.",
    unpublishDone: "Đã hủy xuất bản trang web.",
    unpublishedHint:
      "Các thay đổi mới nhất của AirApp chưa được xuất bản. Chọn Xuất bản bản cập nhật để xem trước.",
    stalePreviewHint:
      "Bản xem trước trang web đã cũ. Chọn Xuất bản bản cập nhật để chuẩn bị bản AirApp mới nhất.",
  },
  fr: {
    menuShort: "Aperçu",
    menu: "Aperçu et publication",
    deployedSite: "Site web déployé",
    viewingMode: "Mode d’affichage",
    openInNewTab: "Ouvrir dans un nouvel onglet",
    browserLogs: "Journaux du navigateur",
    onlineLogs: "Journaux en ligne",
    moreActions: "Autres actions",
    publish: "Publier",
    publishUpdate: "Publier la mise à jour",
    published: "Publié",
    publicationActions: "Actions de publication",
    refreshPage: "Actualiser la page",
    unpublish: "Dépublier",
    unpublishTitle: "Dépublier ce site ?",
    unpublishDescription:
      "Les visiteurs ne pourront plus ouvrir le site public. Vos fichiers et l’aperçu privé resteront disponibles, et vous pourrez le republier plus tard.",
    unpublishDone: "Le site a été dépublié.",
    unpublishedHint:
      "Les dernières modifications d’AirApp ne sont pas encore publiées. Choisissez Publier la mise à jour pour les vérifier.",
    stalePreviewHint:
      "Cet aperçu est obsolète. Publier la mise à jour prépare la dernière version d’AirApp.",
  },
  de: {
    menuShort: "Vorschau",
    menu: "Vorschau und Veröffentlichung",
    deployedSite: "Veröffentlichte Website",
    viewingMode: "Ansichtsmodus",
    openInNewTab: "In neuem Tab öffnen",
    browserLogs: "Browser-Protokolle",
    onlineLogs: "Online-Protokolle",
    moreActions: "Weitere Aktionen",
    publish: "Veröffentlichen",
    publishUpdate: "Update veröffentlichen",
    published: "Veröffentlicht",
    publicationActions: "Veröffentlichungsaktionen",
    refreshPage: "Seite neu laden",
    unpublish: "Veröffentlichung aufheben",
    unpublishTitle: "Veröffentlichung dieser Website aufheben?",
    unpublishDescription:
      "Besucher können die öffentliche Website nicht mehr öffnen. Ihre Dateien und die private Vorschau bleiben verfügbar. Sie können die Website später erneut veröffentlichen.",
    unpublishDone: "Die Veröffentlichung der Website wurde aufgehoben.",
    unpublishedHint:
      "Die neuesten AirApp-Änderungen sind noch nicht veröffentlicht. Wähle Update veröffentlichen, um sie zu prüfen.",
    stalePreviewHint:
      "Diese Website-Vorschau ist veraltet. Update veröffentlichen bereitet die aktuelle AirApp zur Prüfung vor.",
  },
};
