/**
 * Port contracts for previewfile-core.
 *
 * These interfaces let the lib stay infrastructure-agnostic. App-side code
 * implements them — for example, the standalone host uses a LocalConverter
 * that POSTs to its own /api/convert; other embedding hosts will run the conversion
 * in-process via previewfile-core/server.
 */

export interface ConvertToPdfInput {
  /** Public URL to the source file (will be fetched by the converter). */
  fileUrl: string;
  /** MIME type or filename hint, used to pick the right converter. */
  mimeType?: string;
  fileName?: string;
  /** Free-form fields the implementation may use (e.g. shortUrl for previewfile). */
  metadata?: Record<string, unknown>;
}

export interface ConvertToPdfResult {
  /** URL of the converted PDF; the conversion has finished when this resolves. */
  pdfUrl?: string;
}

export interface ConverterPort {
  /**
   * Convert an Office document to PDF. Blocking: hosts' convert routes wait
   * for the worker, so treat this as potentially long-running.
   */
  convertToPdf(input: ConvertToPdfInput): Promise<ConvertToPdfResult>;
}
