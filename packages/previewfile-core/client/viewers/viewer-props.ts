/** What `FileViewer` hands every leaf viewer. */
export interface ViewerProps {
  fileUrl: string;
  fileName: string;
  watermark?: string | null;
  noDownload?: boolean;
}
