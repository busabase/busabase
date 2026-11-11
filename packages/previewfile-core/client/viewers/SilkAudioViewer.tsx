"use client";

import { AlertCircle } from "lucide-react";
import {
  getSilkDecodeCandidates,
  pcm16MonoToWavBlob,
  supportsWasmSimd,
} from "previewfile-core/utils/silk-audio";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import AudioViewer from "./AudioViewer";
import { LoadingState } from "./LoadingState";
import { useViewerHeightClass } from "./viewer-layout";

const CANDIDATE_SAMPLE_RATES = [24000, 16000, 12000, 8000] as const;
const SILK_WASM_CDN_URL = "https://cdn.jsdelivr.net/npm/silk-wasm@3.7.1/lib/index.mjs";

interface SilkWasmModule {
  decode: (
    input: ArrayBufferView | ArrayBuffer,
    sampleRate: number,
  ) => Promise<{ data: Uint8Array }>;
  isSilk: (input: ArrayBufferView | ArrayBuffer) => boolean;
}

async function loadSilkWasmModule(): Promise<SilkWasmModule> {
  // Avoid bundling silk-wasm into Turbopack client graph since the package bundles Node-specific imports.
  const dynamicImport = new Function("url", "return import(url)") as (
    url: string,
  ) => Promise<unknown>;
  return (await dynamicImport(SILK_WASM_CDN_URL)) as SilkWasmModule;
}

interface SilkAudioViewerProps {
  fileUrl: string;
  fileName: string;
  watermark?: string | null;
  noDownload?: boolean;
}

export default function SilkAudioViewer({
  fileUrl,
  fileName,
  watermark,
  noDownload,
}: SilkAudioViewerProps) {
  const heightClass = useViewerHeightClass();
  const [decodedAudioUrl, setDecodedAudioUrl] = useState<string | null>(null);
  const { LL } = useI18n();
  const [decodeFailed, setDecodeFailed] = useState(false);
  // The decoder is built with wasm SIMD; without it (WebKit on x86_64) it
  // cannot even compile, which is no reason to call the file damaged.
  const [simdMissing, setSimdMissing] = useState(false);
  const [isDecoding, setIsDecoding] = useState(true);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function decodeSilkAudio(): Promise<void> {
      setIsDecoding(true);
      setDecodeFailed(false);
      setSimdMissing(false);

      try {
        if (!supportsWasmSimd()) {
          setSimdMissing(true);
          return;
        }

        const response = await fetch(fileUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to fetch Silk file: ${response.status} ${response.statusText}`);
        }

        const inputBytes = new Uint8Array(await response.arrayBuffer());
        const payloadCandidates = getSilkDecodeCandidates(inputBytes);

        const { decode, isSilk } = await loadSilkWasmModule();

        let decodedPcm: Uint8Array | null = null;
        let selectedSampleRate: number = CANDIDATE_SAMPLE_RATES[0];
        const attemptErrors: string[] = [];

        for (const payload of payloadCandidates) {
          if (!isSilk(payload)) {
            attemptErrors.push(
              `Candidate payload not recognized as Silk (len=${payload.length}, firstByte=${payload[0] ?? -1})`,
            );
            continue;
          }

          for (const sampleRate of CANDIDATE_SAMPLE_RATES) {
            try {
              const result = await decode(payload, sampleRate);
              if (result?.data && result.data.length > 0) {
                decodedPcm = result.data;
                selectedSampleRate = sampleRate;
                break;
              }
              attemptErrors.push(
                `Decode returned empty PCM (sampleRate=${sampleRate}, len=${payload.length})`,
              );
            } catch (decodeError) {
              const message =
                decodeError instanceof Error ? decodeError.message : "unknown decode error";
              attemptErrors.push(
                `Decode error (sampleRate=${sampleRate}, len=${payload.length}): ${message}`,
              );
            }
          }

          if (decodedPcm) break;
        }

        if (!decodedPcm) {
          throw new Error(
            `Failed to decode Silk audio after ${payloadCandidates.length} payload candidates. ${
              attemptErrors[0] ?? "No decoder output"
            }`,
          );
        }

        const wavBlob = pcm16MonoToWavBlob(decodedPcm, selectedSampleRate);
        const wavUrl = URL.createObjectURL(wavBlob);

        if (cancelled) {
          URL.revokeObjectURL(wavUrl);
          return;
        }

        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
        }

        objectUrlRef.current = wavUrl;
        setDecodedAudioUrl(wavUrl);
      } catch (error) {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        console.error("Failed to decode Silk audio:", error);
        setDecodeFailed(true);
      } finally {
        if (!cancelled) {
          setIsDecoding(false);
        }
      }
    }

    void decodeSilkAudio();

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [fileUrl]);

  if (isDecoding) {
    return (
      <LoadingState
        variant="converting"
        message={LL.preview.decodingSilk()}
        secondaryMessage={LL.preview.preparingPlayableAudio()}
        fileName={fileName}
      />
    );
  }

  if (simdMissing || decodeFailed || !decodedAudioUrl) {
    return (
      <div
        className={`w-full ${heightClass} bg-muted flex flex-col items-center justify-center relative`}
      >
        {watermark && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-45deg] text-6xl font-bold text-black/10 select-none pointer-events-none whitespace-nowrap z-10">
            {watermark}
          </div>
        )}
        <div className="flex flex-col items-center gap-4 p-8 max-w-xl text-center">
          <AlertCircle size={52} className="text-amber-500" />
          <h3 className="text-xl font-semibold">
            {simdMissing ? LL.preview.silkUnsupportedTitle() : LL.preview.silkDecodeFailedTitle()}
          </h3>
          <p className="text-sm text-muted-foreground">
            {simdMissing ? LL.preview.silkUnsupportedDesc() : LL.preview.silkDecodeFailedDesc()}
          </p>
          {!noDownload && (
            <a
              href={fileUrl}
              download={fileName}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {LL.preview.downloadOriginalFile()}
            </a>
          )}
        </div>
      </div>
    );
  }

  // The decoded audio plays in the same player as any other audio file.
  return (
    <AudioViewer
      fileUrl={decodedAudioUrl}
      fileName={fileName}
      watermark={watermark}
      noDownload={noDownload}
      icon="🎙️"
    />
  );
}
