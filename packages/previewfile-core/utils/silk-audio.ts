const SILK_MAGIC = "#!SILK_V3";

function hasSilkMagicAt(data: Uint8Array, offset: number): boolean {
  if (data.length < offset + SILK_MAGIC.length) return false;
  const encoder = new TextEncoder();
  const magicBytes = encoder.encode(SILK_MAGIC);
  return magicBytes.every((byte, idx) => data[offset + idx] === byte);
}

export function normalizeSilkPayload(data: Uint8Array): Uint8Array {
  if (hasSilkMagicAt(data, 0)) {
    return data;
  }

  // WeChat/QQ variants often prepend 0x02 before the standard Silk header.
  if (data[0] === 0x02 && hasSilkMagicAt(data, 1)) {
    return data.subarray(1);
  }

  return data;
}

function prependSilkMagic(data: Uint8Array): Uint8Array {
  const magic = new TextEncoder().encode(SILK_MAGIC);
  const next = new Uint8Array(magic.length + data.length);
  next.set(magic, 0);
  next.set(data, magic.length);
  return next;
}

function dedupePayloads(payloads: Uint8Array[]): Uint8Array[] {
  const seen = new Set<string>();
  const unique: Uint8Array[] = [];
  for (const payload of payloads) {
    const fingerprint = `${payload.length}:${Array.from(payload.subarray(0, 12)).join(",")}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    unique.push(payload);
  }
  return unique;
}

function findSilkMagicOffset(data: Uint8Array, maxScanBytes = 32): number {
  const limit = Math.min(maxScanBytes, data.length - SILK_MAGIC.length + 1);
  for (let offset = 0; offset < limit; offset++) {
    if (hasSilkMagicAt(data, offset)) {
      return offset;
    }
  }
  return -1;
}

export function getSilkDecodeCandidates(data: Uint8Array): Uint8Array[] {
  const candidates: Uint8Array[] = [];

  // 1) Original payload as fetched.
  candidates.push(data);

  // 2) Known WeChat/Tencent header normalization.
  candidates.push(normalizeSilkPayload(data));

  // 3) Explicitly strip leading Tencent marker byte if present.
  if (data[0] === 0x02 && data.length > 1) {
    candidates.push(data.subarray(1));
  }

  // 4) Some exports miss the magic string entirely.
  if (!hasSilkMagicAt(data, 0)) {
    candidates.push(prependSilkMagic(data));
  }

  // 5) Some payloads have Tencent marker + raw bitstream (no magic).
  if (data[0] === 0x02 && !hasSilkMagicAt(data, 1) && data.length > 1) {
    candidates.push(prependSilkMagic(data.subarray(1)));
  }

  // 6) Some files contain extra bytes before Silk magic; trim to the first magic occurrence.
  const embeddedMagicOffset = findSilkMagicOffset(data);
  if (embeddedMagicOffset > 0) {
    candidates.push(data.subarray(embeddedMagicOffset));
  }

  return dedupePayloads(candidates);
}

export function pcm16MonoToWavBlob(pcmData: Uint8Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const channelCount = 1;
  const byteRate = sampleRate * channelCount * bytesPerSample;
  const blockAlign = channelCount * bytesPerSample;
  const headerSize = 44;
  const wavBuffer = new ArrayBuffer(headerSize + pcmData.length);
  const view = new DataView(wavBuffer);

  function writeString(offset: number, value: string): void {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM format chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, pcmData.length, true);

  new Uint8Array(wavBuffer, headerSize).set(pcmData);
  return new Blob([wavBuffer], { type: "audio/wav" });
}

/**
 * A module whose one function uses SIMD (v128) instructions — the feature
 * silk-wasm is built with. JavaScriptCore on x86_64 (WebKitGTK on Linux, so
 * Buda Desktop's Linux build) has no wasm SIMD and cannot compile the decoder.
 */
const WASM_SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
]);

/** Whether this runtime can compile WebAssembly SIMD, which the Silk decoder needs. */
export function supportsWasmSimd(): boolean {
  try {
    return typeof WebAssembly === "object" && WebAssembly.validate(WASM_SIMD_PROBE);
  } catch {
    return false;
  }
}
