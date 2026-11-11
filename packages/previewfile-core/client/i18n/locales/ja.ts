import type { Messages } from "../messages";

export const ja: Messages = {
  loading: () => "プレビューを読み込み中...",
  loadingFile: () => "ファイルを読み込み中...",
  loadingDocument: () => "ドキュメントを読み込み中...",
  loadingOfficeViewer: () => "Office ビューアーを読み込み中...",
  loadingAudioViewer: () => "オーディオプレーヤーを読み込み中...",
  loadingCodeViewer: () => "コードビューアーを読み込み中...",
  loadingImageViewer: () => "画像ビューアーを読み込み中...",
  loadingMarkdownViewer: () => "Markdown ビューアーを読み込み中...",
  loadingVideoViewer: () => "ビデオプレーヤーを読み込み中...",
  loadingPdfViewer: () => "PDF ビューアーを読み込み中...",
  loadingExcelViewer: () => "スプレッドシートビューアーを読み込み中...",
  loadingTiffViewer: () => "TIFF ビューアーを読み込み中...",
  loading3dViewer: () => "3D ビューアーを読み込み中...",
  loadingWordViewer: () => "Word ドキュメントビューアーを読み込み中...",
  loadingEpubViewer: () => "EPUB ビューアーを読み込み中...",
  loadingPsdViewer: () => "PSD ビューアーを読み込み中...",
  loadingSqliteViewer: () => "SQLite データベースを読み込み中...",
  loadingSpreadsheetEngine: () => "スプレッドシートエンジンを読み込み中...",

  fileLabel: () => "ファイル：",
  typeLabel: () => "種類：",
  download: () => "ダウンロード",
  downloadDisabled: () => "このファイルのダウンロードは無効になっています",
  downloadIconTitle: () => "ダウンロードアイコン",
  downloadFile: ({ fileName }) => `${fileName} をダウンロード`,
  downloadOriginalFile: () => "元のファイルをダウンロード",

  previousPage: () => "前のページ",
  nextPage: () => "次のページ",

  pdfLoadErrorTitle: () => "PDF を読み込めませんでした",
  pdfLoadErrorDesc: () => "ページを再読み込みしてください。",

  spreadsheetLoadErrorTitle: () => "スプレッドシートを読み込めませんでした",

  failedToLoadDocumentTitle: () => "ドキュメントを読み込めませんでした",
  failedToLoadDocumentMessage: () => "ドキュメントを読み込めませんでした",
  failedToLoadImageTitle: () => "画像を読み込めませんでした",
  failedToLoadImageDesc: () => "この画像を読み込めませんでした",

  previewNotAvailable: () => "プレビューできません",
  previewNotAvailableDesc: () => "この種類のファイルはブラウザーで直接プレビューできません。",
  unknownError: () => "不明なエラー",
  tryAgain: () => "再試行",

  archivePreviewTitle: () => "アーカイブのプレビュー",
  archiveContentsTitle: () => "アーカイブの内容",
  archiveViewerComingSoon: () =>
    "このアーカイブの内容を表示できません：ファイル名にアーカイブの拡張子（.zip、.rar、.7z、.tar…）がありません。",

  convertingDocumentDesc: () =>
    "Office ドキュメントを PDF に変換しています。通常 10〜30 秒かかります。",
  conversionFailedTitle: () => "変換に失敗しました",
  conversionFailedDesc: () => "ドキュメントを変換できませんでした。もう一度お試しください。",
  conversionCompletedNoUrl: () => "変換は完了しましたが、出力先の URL がありません",

  silkUnsupportedTitle: () => "このブラウザでは WeChat の音声メッセージを再生できません",
  silkUnsupportedDesc: () =>
    "再生には WebAssembly SIMD が必要ですが、このブラウザは対応していません。ファイルをダウンロードするか、Chrome または Edge で開いてください。",
  silkDecodeFailedTitle: () => "この音声メッセージをデコードできませんでした",
  silkDecodeFailedDesc: () =>
    "この WeChat Silk 音声ファイルは破損しているか、デコーダーが対応していない形式の可能性があります。",

  // Loading, errors and retry (LoadingState, ErrorState)
  loadingGeneric: () => "読み込み中...",
  convertingGeneric: () => "変換中...",
  queuedForConversion: () => "変換の順番を待っています...",
  checkingDocument: () => "ドキュメントを確認中...",
  failedToLoadFile: () => "ファイルを読み込めませんでした",
  errorNetwork: () => "サーバーに接続できません。インターネット接続を確認してください。",
  errorNotFound: () => "ファイルが見つかりません。移動または削除された可能性があります。",
  errorForbidden: () => "このファイルにアクセスする権限がありません。",
  errorServer: () => "サーバーで問題が発生しました。しばらくしてからもう一度お試しください。",
  errorTimeout: () => "リクエストがタイムアウトしました。もう一度お試しください。",
  errorCorrupted: () => "ファイルが破損しているか、サポートされていない形式です。",
  retrying: () => "再試行中...",
  technicalDetails: () => "技術的な詳細",
  // Toolbars and hints (TIFF, PSD, 3D)
  zoomIn: () => "拡大",
  zoomOut: () => "縮小",
  zoomInShortcut: () => "拡大（Ctrl/Cmd + +）",
  zoomOutShortcut: () => "縮小（Ctrl/Cmd + -）",
  fitWidth: () => "幅に合わせる",
  fitHeight: () => "高さに合わせる",
  fitToWidth: () => "幅に合わせる",
  fitToHeight: () => "高さに合わせる",
  previousPageShortcut: () => "前のページ（←）",
  nextPageShortcut: () => "次のページ（→）",
  pageOf: ({ page, total }) => `${page} / ${total} ページ`,
  zoomTip: () => "💡 ヒント：Ctrl/Cmd を押しながらスクロールで拡大・縮小",
  zoomAndPagesTip: () =>
    "💡 ヒント：Ctrl/Cmd を押しながらスクロールで拡大・縮小 • 矢印キーでページ移動",
  enterFullscreen: () => "全画面表示",
  exitFullscreen: () => "全画面表示を終了",
  resetCamera: () => "視点をリセット",
  model3dControlsHint: () => "ドラッグで回転 • スクロールでズーム • 右クリックで移動",
  sizeLabel: () => "サイズ：",
  // Audio, WeChat Silk
  loadingAudio: () => "オーディオを読み込み中...",
  audioLoadFailedTitle: () => "オーディオを読み込めませんでした",
  audioLoadFailedDesc: () => "このオーディオファイルは読み込めません",
  browserNoAudio: () => "お使いのブラウザーはオーディオの再生に対応していません。",
  decodingSilk: () => "WeChat の音声メッセージをデコード中...",
  preparingPlayableAudio: () => "ブラウザーで再生できる音声に変換しています",
  // Code, Word, Markdown, PDF
  codeViewerLoadError: () => "コードビューアーを読み込めませんでした",
  codeTruncated: ({ shown, total }) =>
    `全 ${total} 行のうち、先頭の ${shown} 行のみ表示しています。`,
  mayTakeFewSeconds: () => "数秒かかる場合があります...",
  loadingMarkdown: () => "Markdown を読み込み中...",
  loadingPdf: () => "PDF を読み込み中...",
  // EPUB
  loadingEbook: () => "電子書籍を読み込み中...",
  epubLoadFailedTitle: () => "EPUB ファイルを読み込めませんでした",
  epubInvalid: () => "無効な EPUB ファイルです：有効な EPUB（ZIP アーカイブ）ではないようです。",
  tableOfContents: () => "目次",
  noChapters: () => "章が見つかりません",
  epubNavHint: () => "矢印キーまたはボタンでページを移動",
  // 3D models (glTF/OBJ…, STL)
  loading3dModel: () => "3D モデルを読み込み中...",
  model3dLoadFailed: () => "3D モデルを読み込めませんでした",
  model3dEmpty: () => "このモデルには表示できる内容がありません。",
  largeFileTitle: () => "大きなファイルです",
  largeFileDesc: ({ size }) =>
    `このファイルは ${size} あり、読み込みに時間がかかる場合があります。しばらくお待ちください。`,
  loadedPercent: ({ percent }) => `${percent}% 読み込み済み`,
  loadingStl: () => "STL モデルを読み込み中...",
  stlLoadFailedTitle: () => "STL モデルを読み込めませんでした",
  // SQLite
  sqliteNoTables: () => "データベースにテーブルがありません",
  sqliteRowsColumns: ({ rows, columns }) => `${rows} 行 × ${columns} 列`,
  sqliteTableCount: ({ count }) => `${count} 個のテーブル`,
  sqliteTableLabel: () => "テーブル：",
  sqliteTableOption: ({ name, rows }) => `${name}（${rows} 行）`,
  sqliteTableEmpty: ({ name }) => `テーブル「${name}」は空です`,
  sqliteColumnFallback: ({ index }) => `列 ${index}`,
  // Subtitles
  loadingSubtitles: () => "字幕を読み込み中...",
  noSubtitles: () => "字幕が見つからないか、ファイルが空です。",
  // TIFF, PSD
  loadingTiffImage: () => "TIFF 画像を読み込み中...",
  tiffLoadFailed: () => "TIFF ファイルを読み込めませんでした",
  tiffNoPages: () => "TIFF ファイルにページがありません",
  tiffRenderFailed: () => "TIFF のページを表示できませんでした",
  loadingPsdImage: () => "PSD 画像を読み込み中...",
  psdParseFailed: () => "PSD ファイルを解析できないか、画像データがありません",
  psdNoComposite: () => "PSD ファイルに合成画像データがありません",
  // Video (MPEG / MOV transcoding)
  convertingVideo: () => "ビデオを MP4 に変換中...",
  videoConvertMayTake: () => "ファイルサイズによっては時間がかかる場合があります",
  videoConvertedTitle: () => "ビデオを変換しました",
  videoConvertedDesc: () => "ブラウザーで再生できるように MP4 に変換しました。",
  videoUnsupportedTitle: () => "このビデオ形式はサポートされていません",
  downloadVideoFile: () => "ビデオファイルをダウンロード",
  videoWhyTitle: () => "なぜこうなるのですか？",
  videoWhyDesc: () =>
    "このビデオ形式（MPEG や QuickTime/MOV など）は一部のブラウザーで対応が限られています。ほぼすべてのブラウザーとデバイスで再生できる MP4（H.264）形式への変換をおすすめします。",
  videoTranscodeFailed: () =>
    "ビデオを変換できませんでした。お使いのブラウザーが必要な機能に対応していない可能性があります。ファイルをダウンロードしてローカルで変換してください。",
  videoPlayFailed: ({ detail }) => `このビデオを再生できません。エラー：${detail}`,
  // Archives
  archiveNoEntries: () => "項目がありません",
};
