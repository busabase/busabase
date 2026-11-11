import { describe, expect, it } from "vitest";
import { normalizeSilkPayload, pcm16MonoToWavBlob } from "./silk-audio";

function createSilkPayload(withTencentHeader: boolean): Uint8Array {
  const silkHeader = new TextEncoder().encode("#!SILK_V3");
  const pcmPayload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
  if (withTencentHeader) {
    const withHeader = new Uint8Array(1 + silkHeader.length + pcmPayload.length);
    withHeader[0] = 0x02;
    withHeader.set(silkHeader, 1);
    withHeader.set(pcmPayload, 1 + silkHeader.length);
    return withHeader;
  }
  const normal = new Uint8Array(silkHeader.length + pcmPayload.length);
  normal.set(silkHeader, 0);
  normal.set(pcmPayload, silkHeader.length);
  return normal;
}

describe("silk-audio helpers", () => {
  describe("normalizeSilkPayload()", () => {
    it("should keep standard Silk payload unchanged", () => {
      const payload = createSilkPayload(false);
      const normalized = normalizeSilkPayload(payload);
      expect(normalized).toEqual(payload);
    });

    it("should strip Tencent leading byte when present", () => {
      const payload = createSilkPayload(true);
      const normalized = normalizeSilkPayload(payload);
      expect(normalized[0]).toBe("#".charCodeAt(0));
      expect(new TextDecoder().decode(normalized.subarray(0, 9))).toBe("#!SILK_V3");
    });
  });

  describe("pcm16MonoToWavBlob()", () => {
    it("should create a WAV blob with expected metadata", () => {
      const pcm = new Uint8Array([0x01, 0x00, 0x02, 0x00]);
      const blob = pcm16MonoToWavBlob(pcm, 24000);
      expect(blob.type).toBe("audio/wav");
      expect(blob.size).toBe(44 + pcm.length);
    });
  });
});
