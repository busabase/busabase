import type { ConverterPort, ConvertToPdfInput, ConvertToPdfResult } from "../../types/ports";

interface ConvertApiResponse {
  success?: boolean;
  outputUrl?: string;
  error?: string;
}

export interface HttpConverterOptions {
  /** Path of the host's convert route (`createConvertRoute`). Default `/api/convert`. */
  endpoint?: string;
  /**
   * Turn the endpoint into the URL to call. Default: as-is (same origin). Hosts
   * whose UI runs on another origin than their server (desktop/mobile shells)
   * point it at the server here.
   */
  resolveApiUrl?: (path: string) => string;
  /** Turn the returned output path into a URL the viewer can load. Default: as-is. */
  resolveOutputUrl?: (path: string) => string;
  /** Adjust each request, e.g. to add auth headers. Default: send cookies. */
  prepareRequest?: (init: RequestInit) => RequestInit;
  /**
   * Host-specific fields for the request body, from the viewer's input — e.g.
   * the share link and password PreviewFile's route converts for.
   */
  extraBody?: (input: ConvertToPdfInput) => Record<string, unknown>;
}

async function parseConverterJson<T>(response: Response): Promise<T> {
  const raw = await response.text();

  try {
    return JSON.parse(raw) as T;
  } catch {
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "unknown content";
    throw new Error(
      `Conversion service returned ${contentType} instead of JSON (${response.status} ${response.statusText})`,
    );
  }
}

/**
 * `ConverterPort` backed by the host's own convert route, which wraps
 * `previewfile-core/server` (`createConvertRoute`). The route blocks until the
 * PDF is ready, so there is no job to poll and `getJobStatus` is not offered.
 */
export function createHttpConverter(options: HttpConverterOptions = {}): ConverterPort {
  const endpoint = options.endpoint ?? "/api/convert";
  const resolveApiUrl = options.resolveApiUrl ?? ((path: string) => path);
  const resolveOutputUrl = options.resolveOutputUrl ?? ((path: string) => path);
  const prepareRequest =
    options.prepareRequest ??
    ((init: RequestInit): RequestInit => ({ ...init, credentials: "include" }));

  return {
    async convertToPdf(input: ConvertToPdfInput): Promise<ConvertToPdfResult> {
      const response = await fetch(
        resolveApiUrl(endpoint),
        prepareRequest({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...options.extraBody?.(input),
            fileUrl: input.fileUrl,
            fileName: input.fileName,
            mimeType: input.mimeType,
            outputFormat: "pdf",
          }),
        }),
      );

      const data = await parseConverterJson<ConvertApiResponse>(response);

      if (!response.ok || data.success === false) {
        throw new Error(data.error || `Conversion failed: ${response.statusText}`);
      }

      return { pdfUrl: data.outputUrl ? resolveOutputUrl(data.outputUrl) : undefined };
    },
  };
}
