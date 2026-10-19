import { spawn } from "node:child_process";

export function pnpmInvocation(args, env, platform, nodeExecutable = process.execPath) {
  if (env.npm_execpath) {
    if (/\.(cmd|bat)$/i.test(env.npm_execpath)) {
      throw new Error(
        "npm_execpath must point to the pnpm JavaScript CLI, not a command-shell shim.",
      );
    }
    return { command: nodeExecutable, args: [env.npm_execpath, ...args] };
  }
  if (platform === "win32") {
    throw new Error(
      "Run this launcher through `pnpm tauri` on Windows so npm_execpath identifies the pnpm JavaScript CLI.",
    );
  }
  return { command: "pnpm", args };
}

export function launchPnpm(
  args,
  {
    env,
    cwd,
    platform = process.platform,
    nodeExecutable = process.execPath,
    spawnProcess = spawn,
    processEvents = process,
  } = {},
) {
  const invocation = pnpmInvocation(args, env, platform, nodeExecutable);
  const child = spawnProcess(invocation.command, invocation.args, { cwd, env, stdio: "inherit" });
  const forwardInterrupt = () => child.kill("SIGINT");
  const forwardTerminate = () => child.kill("SIGTERM");
  const removeListeners = () => {
    processEvents.removeListener("SIGINT", forwardInterrupt);
    processEvents.removeListener("SIGTERM", forwardTerminate);
  };
  processEvents.on("SIGINT", forwardInterrupt);
  processEvents.on("SIGTERM", forwardTerminate);
  child.on("error", (error) => {
    removeListeners();
    console.error(`[busabase-desktop] Could not launch Tauri: ${error.message}`);
    processEvents.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    removeListeners();
    processEvents.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
  return child;
}
