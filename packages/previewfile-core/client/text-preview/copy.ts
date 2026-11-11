import type { ViewerLanguage } from "../i18n";

const en = {
  loading: "Loading text…",
  failed: "Could not load this file. Check your connection or access, then retry.",
  encoding:
    "This file is not valid UTF-8 text. Download it to check its encoding, then upload a UTF-8 copy.",
  tooLarge: "Text previews support files up to {limit}. Download the file to read it.",
  timedOut: "Loading took too long. Check your connection, then retry.",
  empty: "This text file is empty.",
};

type Copy = { [Key in keyof typeof en]: string };

const copy: Record<ViewerLanguage, Copy> = {
  en,
  "zh-CN": {
    loading: "正在加载文本…",
    failed: "无法加载此文件，请检查网络连接或访问权限后重试。",
    encoding: "此文件不是有效的 UTF-8 文本。请下载检查编码，再上传 UTF-8 版本。",
    tooLarge: "文本预览支持最大 {limit} 的文件，请下载后阅读。",
    timedOut: "加载超时，请检查网络连接后重试。",
    empty: "此文本文件为空。",
  },
  "zh-TW": {
    loading: "正在載入文字…",
    failed: "無法載入此檔案，請檢查網路連線或存取權限後重試。",
    encoding: "此檔案不是有效的 UTF-8 文字。請下載檢查編碼，再上傳 UTF-8 版本。",
    tooLarge: "文字預覽支援最大 {limit} 的檔案，請下載後閱讀。",
    timedOut: "載入逾時，請檢查網路連線後重試。",
    empty: "此文字檔案為空。",
  },
  ja: {
    loading: "テキストを読み込み中…",
    failed: "ファイルを読み込めません。接続またはアクセス権を確認して再試行してください。",
    encoding:
      "有効な UTF-8 テキストではありません。ダウンロードして文字コードを確認し、UTF-8 で再アップロードしてください。",
    tooLarge: "テキストのプレビューは {limit} までです。ダウンロードしてお読みください。",
    timedOut: "読み込みがタイムアウトしました。接続を確認して再試行してください。",
    empty: "このテキストファイルは空です。",
  },
  ko: {
    loading: "텍스트 불러오는 중…",
    failed: "파일을 불러올 수 없습니다. 연결이나 접근 권한을 확인한 후 다시 시도하세요.",
    encoding:
      "올바른 UTF-8 텍스트가 아닙니다. 다운로드하여 인코딩을 확인한 후 UTF-8 파일을 업로드하세요.",
    tooLarge: "텍스트 미리보기는 {limit} 이하 파일을 지원합니다. 다운로드하여 읽으세요.",
    timedOut: "불러오는 시간이 초과되었습니다. 연결을 확인한 후 다시 시도하세요.",
    empty: "이 텍스트 파일은 비어 있습니다.",
  },
  es: {
    loading: "Cargando texto…",
    failed:
      "No se pudo cargar el archivo. Comprueba la conexión o los permisos y vuelve a intentarlo.",
    encoding:
      "El texto no es UTF-8 válido. Descárgalo para revisar la codificación y sube una copia en UTF-8.",
    tooLarge: "La vista previa de texto admite hasta {limit}. Descarga el archivo para leerlo.",
    timedOut: "La carga tardó demasiado. Comprueba la conexión y vuelve a intentarlo.",
    empty: "Este archivo de texto está vacío.",
  },
  pt: {
    loading: "Carregando texto…",
    failed:
      "Não foi possível carregar o arquivo. Verifique a conexão ou o acesso e tente novamente.",
    encoding:
      "O texto não é UTF-8 válido. Baixe-o para verificar a codificação e envie uma cópia em UTF-8.",
    tooLarge: "A prévia de texto suporta até {limit}. Baixe o arquivo para ler.",
    timedOut: "O carregamento demorou demais. Verifique a conexão e tente novamente.",
    empty: "Este arquivo de texto está vazio.",
  },
  vi: {
    loading: "Đang tải văn bản…",
    failed: "Không thể tải tệp. Kiểm tra kết nối hoặc quyền truy cập rồi thử lại.",
    encoding:
      "Văn bản không phải UTF-8 hợp lệ. Tải xuống để kiểm tra mã hóa, rồi tải lên bản UTF-8.",
    tooLarge: "Xem trước văn bản hỗ trợ tối đa {limit}. Tải tệp xuống để đọc.",
    timedOut: "Tải quá lâu. Kiểm tra kết nối rồi thử lại.",
    empty: "Tệp văn bản này trống.",
  },
  fr: {
    loading: "Chargement du texte…",
    failed:
      "Impossible de charger le fichier. Vérifiez la connexion ou vos droits, puis réessayez.",
    encoding:
      "Ce texte n’est pas un UTF-8 valide. Téléchargez-le pour vérifier l’encodage, puis importez une copie UTF-8.",
    tooLarge: "L’aperçu du texte accepte jusqu’à {limit}. Téléchargez le fichier pour le lire.",
    timedOut: "Le chargement a pris trop de temps. Vérifiez la connexion, puis réessayez.",
    empty: "Ce fichier texte est vide.",
  },
  de: {
    loading: "Text wird geladen…",
    failed:
      "Die Datei konnte nicht geladen werden. Prüfe Verbindung oder Zugriffsrechte und versuche es erneut.",
    encoding:
      "Der Text ist kein gültiges UTF-8. Lade ihn zur Prüfung der Kodierung herunter und lade eine UTF-8-Kopie hoch.",
    tooLarge: "Die Textvorschau unterstützt bis zu {limit}. Lade die Datei zum Lesen herunter.",
    timedOut: "Das Laden hat zu lange gedauert. Prüfe die Verbindung und versuche es erneut.",
    empty: "Diese Textdatei ist leer.",
  },
};

export const textAttachmentCopy = (locale: ViewerLanguage): Copy => copy[locale];
