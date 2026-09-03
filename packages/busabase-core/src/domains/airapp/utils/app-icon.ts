const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

const graphemes = (value: string): string[] => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(value), ({ segment }) => segment);
};

export interface AirAppFallbackGlyph {
  isEmoji: boolean;
  value: string;
}

/** Derives a compact, deterministic glyph without coupling the client to node schema internals. */
export const getAirAppFallbackGlyph = (name: string): AirAppFallbackGlyph => {
  const normalized = name.trim().normalize("NFC");
  if (!normalized) return { isEmoji: false, value: "A" };

  const nameGraphemes = graphemes(normalized);
  const first = nameGraphemes[0] ?? "A";
  if (EMOJI_PATTERN.test(first)) return { isEmoji: true, value: first };

  const words = normalized.split(/\s+/u);
  const value =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => graphemes(word)[0] ?? "")
          .join("")
      : nameGraphemes.slice(0, 2).join("");

  return { isEmoji: false, value: value.toLocaleUpperCase() || "A" };
};
