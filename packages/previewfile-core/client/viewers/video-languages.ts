import videojs from "video.js";
import de from "video.js/dist/lang/de.json";
import es from "video.js/dist/lang/es.json";
import fr from "video.js/dist/lang/fr.json";
import ja from "video.js/dist/lang/ja.json";
import ko from "video.js/dist/lang/ko.json";
import pt from "video.js/dist/lang/pt-BR.json";
import vi from "video.js/dist/lang/vi.json";
import zhCN from "video.js/dist/lang/zh-CN.json";
import zhTW from "video.js/dist/lang/zh-TW.json";
import type { ViewerLanguage } from "../i18n";

// video.js brings its own strings (the play button, "Mute", "Fullscreen"…) and
// speaks the language it is given. It has no text for the two skip buttons.
const SKIP_BUTTONS: Record<Exclude<ViewerLanguage, "en">, Record<string, string>> = {
  "zh-CN": { "Skip Backward": "后退", "Skip Forward": "快进" },
  "zh-TW": { "Skip Backward": "倒轉", "Skip Forward": "快轉" },
  ja: { "Skip Backward": "後ろへスキップ", "Skip Forward": "前へスキップ" },
  ko: { "Skip Backward": "뒤로 건너뛰기", "Skip Forward": "앞으로 건너뛰기" },
  pt: { "Skip Backward": "Voltar", "Skip Forward": "Avançar" },
  de: { "Skip Backward": "Zurückspringen", "Skip Forward": "Vorspringen" },
  es: { "Skip Backward": "Retroceder", "Skip Forward": "Avanzar" },
  fr: { "Skip Backward": "Reculer", "Skip Forward": "Avancer" },
  vi: { "Skip Backward": "Tua lại", "Skip Forward": "Tua tới" },
};

const PACKS: Record<Exclude<ViewerLanguage, "en">, Record<string, string>> = {
  "zh-CN": { ...zhCN, ...SKIP_BUTTONS["zh-CN"] },
  "zh-TW": { ...zhTW, ...SKIP_BUTTONS["zh-TW"] },
  ja: { ...ja, ...SKIP_BUTTONS.ja },
  ko: { ...ko, ...SKIP_BUTTONS.ko },
  pt: { ...pt, ...SKIP_BUTTONS.pt },
  de: { ...de, ...SKIP_BUTTONS.de },
  es: { ...es, ...SKIP_BUTTONS.es },
  fr: { ...fr, ...SKIP_BUTTONS.fr },
  vi: { ...vi, ...SKIP_BUTTONS.vi },
};

let registered = false;

/** Teach video.js the languages the viewers speak, and return its code for one. */
export function videoJsLanguage(language: ViewerLanguage): string {
  if (!registered) {
    for (const [code, pack] of Object.entries(PACKS)) videojs.addLanguage(code, pack);
    registered = true;
  }
  return language;
}
