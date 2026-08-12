import { Platform } from "react-native";

/**
 * Copy text to the system clipboard, returning whether it actually landed there.
 *
 * Deliberately dependency-free. `expo-clipboard` is NOT a dependency of this app
 * (it may only be present at the workspace root, hoisted there by some other
 * package), and importing a phantom dependency would build fine here
 * while failing to autolink in a real native build. So:
 *
 *  - **web** (Expo web / RN-web, the surface the share link and Agent prompts are
 *    most often used from) uses the standard async Clipboard API, which needs a
 *    secure context and a user gesture — both true when this runs from a button.
 *  - **native** falls back to React Native's own `Clipboard` module. It is
 *    deprecated-but-present in RN 0.85; requiring it lazily keeps the deprecation
 *    warning off the boot path and out of every screen that never copies.
 *
 * Callers MUST honour a `false` result by telling the user copying is unavailable
 * (the prompt/link text is always rendered selectably as the fallback) rather than
 * showing a "Copied" state that didn't happen.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (Platform.OS === "web") {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.writeText) return false;
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  try {
    const { Clipboard } = require("react-native") as {
      Clipboard?: { setString?: (value: string) => void };
    };
    if (!Clipboard?.setString) return false;
    Clipboard.setString(text);
    return true;
  } catch {
    return false;
  }
}
