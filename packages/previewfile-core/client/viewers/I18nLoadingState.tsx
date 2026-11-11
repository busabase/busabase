/**
 * I18n-aware loading state wrapper for dynamic imports
 * Provides localized loading messages
 */

import { useI18n } from "../i18n";
import { LoadingState } from "./LoadingState";

export function I18nAudioViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingAudioViewer()} />;
}

export function I18nCodeViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingCodeViewer()} />;
}

export function I18nImageViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingImageViewer()} />;
}

export function I18nMarkdownViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingMarkdownViewer()} />;
}

export function I18nVideoViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingVideoViewer()} />;
}

export function I18nPdfViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingPdfViewer()} />;
}

export function I18nExcelViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingExcelViewer()} />;
}

export function I18nTiffViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingTiffViewer()} />;
}

export function I18n3dViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loading3dViewer()} />;
}

export function I18nOfficeViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingOfficeViewer()} />;
}

export function I18nWordViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingWordViewer()} />;
}

export function I18nEpubViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingEpubViewer()} />;
}

export function I18nPsdViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingPsdViewer()} />;
}

export function I18nSqliteViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingSqliteViewer()} />;
}

export function I18nSubtitleViewerLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingFile()} />;
}

export function I18nFileLoading() {
  const { LL } = useI18n();
  return <LoadingState message={LL.preview.loadingFile()} />;
}
