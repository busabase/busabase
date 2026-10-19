import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchPnpm } from "./pnpm-launcher.mjs";

export function softwareRenderingEnvironment(env, platform) {
  if (platform !== "linux") {
    throw new Error("The software-rendering launcher is Linux-only. Use `pnpm tauri dev` instead.");
  }
  return {
    ...env,
    LIBGL_ALWAYS_SOFTWARE: "true",
    GALLIUM_DRIVER: "llvmpipe",
    WEBKIT_DISABLE_COMPOSITING_MODE: "1",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const env = softwareRenderingEnvironment(process.env, process.platform);
    console.warn(
      "[busabase-desktop] Linux software rendering enabled; GPU acceleration is disabled for this launch.",
    );
    launchPnpm(["tauri", "dev", ...process.argv.slice(2)], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env,
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
