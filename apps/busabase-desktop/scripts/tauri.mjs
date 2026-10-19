import { release } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchPnpm } from "./pnpm-launcher.mjs";
import { softwareRenderingEnvironment } from "./tauri-dev-software.mjs";

export function isWslDevelopment(args, env, platform, kernelRelease) {
  return (
    args[0] === "dev" &&
    platform === "linux" &&
    (/microsoft/i.test(kernelRelease) || Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP))
  );
}

export function tauriEnvironment(args, env, platform, kernelRelease) {
  if (!isWslDevelopment(args, env, platform, kernelRelease)) return { ...env };
  const environment = {
    ...env,
    BUSABASE_DESKTOP_SIDECAR_PORT: env.BUSABASE_DESKTOP_SIDECAR_PORT ?? "15420",
  };
  return env.BUSABASE_DESKTOP_RENDERER === "hardware"
    ? environment
    : softwareRenderingEnvironment(environment, platform);
}

export function launchTauri(
  args,
  {
    env = process.env,
    platform = process.platform,
    kernelRelease = release(),
    spawnProcess,
    nodeExecutable,
    processEvents = process,
    warn = console.warn,
  } = {},
) {
  const environment = tauriEnvironment(args, env, platform, kernelRelease);
  if (isWslDevelopment(args, env, platform, kernelRelease)) {
    warn(
      `[busabase-desktop] WSL dev: sidecar port ${environment.BUSABASE_DESKTOP_SIDECAR_PORT}; renderer ${env.BUSABASE_DESKTOP_RENDERER === "hardware" ? "hardware (explicit)" : "software (WSL default)"}.`,
    );
  }
  return launchPnpm(["exec", "tauri", ...args], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: environment,
    platform,
    spawnProcess,
    nodeExecutable,
    processEvents,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    launchTauri(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
