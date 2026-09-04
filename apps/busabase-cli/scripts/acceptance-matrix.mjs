/**
 * Multi-point acceptance for busabase-cli two-turn login / error hints / qrcode.
 *
 * Run: `node scripts/acceptance-matrix.mjs` (after `pnpm run build`).
 * Exits non-zero on the first failing check, so CI can gate on it.
 * Every check runs the BUILT dist/cli.js in a SEPARATE process against a REAL
 * local HTTP server. Nothing is mocked inside the CLI.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

/** Resolve everything from this file, so the script runs from any checkout (and in CI). */
const packageRoot = resolve(import.meta.dirname, "..");
const require = createRequire(join(packageRoot, "package.json"));
const jsQR = require("jsqr");
const { PNG } = require("pngjs");

const execFileAsync = promisify(execFile);
const CLI = join(packageRoot, "dist", "cli.js");
if (!existsSync(CLI)) {
  throw new Error(`${CLI} is missing — run \`pnpm run build\` before this script.`);
}
const home = mkdtempSync(join(tmpdir(), "busa-matrix-"));
/** Scratch space for artifacts this run writes (QR PNGs, the results dump). */
const artifacts = mkdtempSync(join(tmpdir(), "busa-matrix-artifacts-"));

let approved = false;
let deviceCodeIssued = null;
const requestLog = [];

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => {
    body += c;
  });
  req.on("end", () => {
    requestLog.push(req.url);
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.url === "/api/auth/device/code") {
      deviceCodeIssued = `dev-${requestLog.filter((u) => u === "/api/auth/device/code").length}`;
      return send(200, {
        device_code: deviceCodeIssued,
        user_code: "WXYZ7890",
        verification_uri: "https://busabase.com/device",
        verification_uri_complete: "https://busabase.com/device?user_code=WXYZ7890&next=%2Fok+x",
        expires_in: 900,
        interval: 1,
      });
    }
    if (req.url === "/api/auth/device/token") {
      const sent = JSON.parse(body).device_code;
      if (sent !== deviceCodeIssued) return send(400, { error: "expired_token" });
      if (!approved) return send(400, { error: "authorization_pending" });
      return send(200, { access_token: "at-1", expires_in: 3600 });
    }
    if (req.url === "/api/v1/device/finalize") {
      return send(200, { apiKey: "sk_matrix_test", expiresAt: null, credentialType: "api_key" });
    }
    if (req.url === "/api/v1/auth") {
      const auth = req.headers.authorization ?? "";
      if (auth === "Bearer sk_matrix_test" || auth === "Bearer sk_pasted_key") {
        return send(200, {
          user: { id: "u1", email: "matrix@example.com" },
          space: { id: "s1", name: "Matrix Space" },
          spaces: [{ id: "s1", name: "Matrix Space" }],
        });
      }
      return send(401, { error: "unauthorized" });
    }
    if (req.url?.startsWith("/api/v1/bases")) {
      const auth = req.headers.authorization ?? "";
      if (auth === "Bearer sk_forbidden") return send(403, { message: "forbidden" });
      if (auth === "Bearer sk_notfound") return send(404, { message: "no such base" });
      // Only the keys this stub actually issued are valid — anything else is a
      // real 401, the way the server behaves. (An earlier version returned 200
      // for any non-empty bearer, which silently turned the --profile check into
      // a success path with no error envelope to inspect.)
      if (auth === "Bearer sk_matrix_test" || auth === "Bearer sk_pasted_key") return send(200, []);
      return send(401, { message: "unauthorized" });
    }
    return send(404, { message: "not found" });
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const cleanEnv = (extra = {}) => {
  const env = { ...process.env, HOME: home, ...extra };
  for (const k of [
    "BUSABASE_BASE_URL",
    "BUSABASE_API_KEY",
    "BUSABASE_SPACE_ID",
    "BUSABASE_PROFILE",
    "BUSABASE_CONFIG",
  ])
    delete env[k];
  return { ...env, ...extra };
};
const cli = async (args, extraEnv = {}) => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
      env: cleanEnv(extraEnv),
      timeout: 60_000,
    });
    return { status: 0, stdout, stderr };
  } catch (e) {
    return { status: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

const results = [];
const check = (group, label, cond, detail = "") => {
  results.push({ group, label, ok: Boolean(cond), detail });
  console.log(`${cond ? "  ✅" : "  ❌"} ${label}${detail ? `  ${detail}` : ""}`);
  return Boolean(cond);
};
const section = (t) => console.log(`\n\x1b[1;36m${t}\x1b[0m`);

// ══ A. 两轮制登录主路径 ══
section("A. 两轮制登录 (Two-turn login) — 真实跨进程");
const t0 = Date.now();
const turn1 = await cli(["login", "--no-wait", "--output", "json", "--base-url", base]);
const turn1Ms = Date.now() - t0;
const out1 = turn1.status === 0 ? JSON.parse(turn1.stdout) : {};
check("A", "A1 第1轮退出码 0", turn1.status === 0);
check("A", "A2 第1轮立即返回(不阻塞)", turn1Ms < 5000, `${turn1Ms}ms  (阻塞版会等到 900s 超时)`);
check(
  "A",
  "A3 verification_url 逐字节原样",
  out1.verification_url === "https://busabase.com/device?user_code=WXYZ7890&next=%2Fok+x",
);
check("A", "A4 返回 resume_code", Boolean(out1.resume_code), out1.resume_code);
check(
  "A",
  "A5 返回 user_code / expires_in",
  out1.user_code === "WXYZ7890" && out1.expires_in === "900",
);
check("A", "A6 hint 含精确续期命令", out1.hint?.includes(`--resume-code ${out1.resume_code}`));
check("A", "A7 hint 要求结束本轮", out1.hint?.includes("END THIS TURN"));
check("A", "A8 hint 警告勿重启登录", out1.hint?.toLowerCase().includes("invalidates this link"));
check("A", "A9 第1轮不写任何凭证", !existsSync(join(home, ".busabase", ".env")));
approved = true; // 用户在两轮之间授权
const turn2 = await cli([
  "login",
  "--resume-code",
  out1.resume_code,
  "--output",
  "json",
  "--base-url",
  base,
]);
const out2 = turn2.status === 0 ? JSON.parse(turn2.stdout) : {};
check("A", "A10 第2轮(独立进程)签入成功", turn2.status === 0 && out2.status === "signed in");
check(
  "A",
  "A11 上报 method=device / api_key",
  out2.method === "device" && out2.credentialType === "api_key",
);
check(
  "A",
  "A12 凭证真实落盘 .env",
  readFileSync(join(home, ".busabase", ".env"), "utf8").includes("BUSABASE_API_KEY=sk_matrix_test"),
);
const codeReqs = requestLog.filter((u) => u === "/api/auth/device/code").length;
check(
  "A",
  "A13 续期未重新申请 device code",
  codeReqs === 1,
  `device/code 请求数=${codeReqs}(重启会作废用户链接)`,
);
check(
  "A",
  "A14 登录后普通命令可用",
  (await cli(["bases", "list", "--base-url", base, "--output", "json"])).status === 0,
);

// ══ B. 错误信封 hint ══
section("B. 错误信封 hint (Error envelope hint)");
rmSync(join(home, ".busabase"), { recursive: true, force: true });
const e401 = await cli(["bases", "list", "--base-url", base, "--output", "json"]);
const env401 = JSON.parse(e401.stdout);
check("B", "B1 401 退出码 3 (UNAUTHORIZED)", e401.status === 3 && env401.code === "UNAUTHORIZED");
check("B", "B2 401 信封带 hint", typeof env401.hint === "string" && env401.hint.length > 0);
check("B", "B3 hint 自动带上非默认 --base-url", env401.hint.includes(`--base-url ${base}`));
check(
  "B",
  "B4 hint 指向两轮制而非阻塞式",
  env401.hint.includes("--no-wait") && env401.hint.includes("--resume-code"),
);
check("B", "B5 hint 含 opaque-string 规则", env401.hint.includes("opaque string"));
const e403 = await cli([
  "bases",
  "list",
  "--base-url",
  base,
  "--api-key",
  "sk_forbidden",
  "--output",
  "json",
]);
const env403 = JSON.parse(e403.stdout);
check(
  "B",
  "B6 403 hint 走另一套(空间/权限)",
  env403.code === "FORBIDDEN" &&
    env403.hint.includes("space list") &&
    !env403.hint.includes("--no-wait"),
);
const e404 = await cli([
  "bases",
  "list",
  "--base-url",
  base,
  "--api-key",
  "sk_notfound",
  "--output",
  "json",
]);
const env404 = JSON.parse(e404.stdout);
check(
  "B",
  "B7 非认证错误不被污染(无 hint)",
  env404.code === "NOT_FOUND" && env404.hint === undefined,
);
check(
  "B",
  "B8 人类 stderr 散文保持原样",
  e401.stderr.includes("Unauthorized (401)") && e401.stderr.includes("Docs:"),
);
// profile 透传
await cli([
  "login",
  "--api-key",
  "sk_pasted_key",
  "--base-url",
  base,
  "--profile",
  "work",
  "--output",
  "json",
]);
const e401p = await cli([
  "bases",
  "list",
  "--base-url",
  base,
  "--api-key",
  "sk_bad",
  "--profile",
  "work",
  "--output",
  "json",
]);
check(
  "B",
  "B9 多账号下 hint 带 --profile",
  JSON.parse(e401p.stdout).hint?.includes("--profile work"),
  "(真实 profile 落盘后)",
);

// ══ C. qrcode ══
section("C. qrcode 命令");
const QURL = "https://busabase.com/device?user_code=AB-12&next=%2Fy+z";
const qrPath = join(artifacts, "qr-evidence.png");
const qr = await cli(["qrcode", QURL, "--out-file", qrPath, "--output", "json"]);
const qrOut = qr.status === 0 ? JSON.parse(qr.stdout) : {};
check("C", "C1 PNG 生成成功", qr.status === 0 && existsSync(qrPath));
const png = PNG.sync.read(readFileSync(qrPath));
const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
check(
  "C",
  "C2 扫码解回逐字节相同 URL",
  decoded?.data === QURL,
  `解出: ${decoded?.data?.slice(0, 46)}…`,
);
check("C", "C3 JSON 带「必须贴图」提示", qrOut.hint?.includes("MUST include"));
const qrAscii = await cli(["qrcode", QURL, "--ascii"]);
check("C", "C4 --ascii 终端模式可用", qrAscii.status === 0 && qrAscii.stdout.length > 200);
const qrBad = await cli(["qrcode", QURL, "--out-file", "/etc/evil.png"]);
check(
  "C",
  "C5 拒绝白名单外路径",
  qrBad.status !== 0 && qrBad.stderr.includes("Unsafe"),
  "/etc 被拒",
);
const qrSize = await cli([
  "qrcode",
  QURL,
  "--out-file",
  join(artifacts, "small.png"),
  "--size",
  "16",
]);
check("C", "C6 拒绝不可扫的尺寸", qrSize.status !== 0 && qrSize.stderr.includes("--size"));
const qrNoArgs = await cli(["qrcode", QURL]);
check(
  "C",
  "C7 缺 --out-file/--ascii 有明确指引",
  qrNoArgs.status !== 0 && qrNoArgs.stderr.includes("--ascii"),
);

// ══ D. 旧行为零回归 ══
section("D. 存量行为零回归 (Backward compatibility)");
rmSync(join(home, ".busabase"), { recursive: true, force: true });
const apiKeyLogin = await cli([
  "login",
  "--api-key",
  "sk_pasted_key",
  "--base-url",
  base,
  "--output",
  "json",
]);
check(
  "D",
  "D1 --api-key 登录仍工作",
  apiKeyLogin.status === 0 && JSON.parse(apiKeyLogin.stdout).status === "signed in",
);
const refresh = await cli(["login", "--refresh", "--base-url", base, "--output", "json"]);
check(
  "D",
  "D2 --refresh 对 API key 仍是 no-op",
  refresh.status === 0 && JSON.parse(refresh.stdout).status === "nothing to refresh",
);
const logout = await cli(["logout", "--base-url", base, "--output", "json"]);
check(
  "D",
  "D3 logout 仍清空凭证",
  logout.status === 0 &&
    !readFileSync(join(home, ".busabase", ".env"), "utf8").includes("sk_pasted_key"),
);
const conflict1 = await cli(["login", "--no-wait", "--api-key", "sk_x", "--base-url", base]);
check(
  "D",
  "D4 --no-wait + --api-key 明确报错",
  conflict1.status !== 0 && conflict1.stderr.includes("--api-key"),
);
const conflict2 = await cli(["login", "--no-wait", "--resume-code", "c", "--base-url", base]);
check(
  "D",
  "D5 --no-wait + --resume-code 明确报错",
  conflict2.status !== 0 && conflict2.stderr.includes("two halves"),
);
const staleResume = await cli([
  "login",
  "--resume-code",
  "totally-stale",
  "--base-url",
  base,
  "--output",
  "json",
]);
check(
  "D",
  "D6 过期 code 点名重启命令",
  staleResume.status !== 0 &&
    staleResume.stderr.includes("expired") &&
    staleResume.stderr.includes("--no-wait"),
);
const help = await cli(["login", "--help"]);
check(
  "D",
  "D7 login help 保留全部旧 flag",
  ["--device-code", "--oauth", "--no-browser", "--refresh", "--api-key", "--profile"].every((f) =>
    help.stdout.includes(f),
  ),
);
check(
  "D",
  "D8 login help 新增两轮制说明",
  help.stdout.includes("--no-wait") && help.stdout.includes("--resume-code"),
);

// ══ E. 非 TTY 阻塞模式兜底提示 ══
section("E. 阻塞模式的 agent 兜底提示 (non-TTY)");
approved = false;
const blockingStderr = await new Promise((resolve) => {
  const child = spawn(
    process.execPath,
    [CLI, "login", "--device-code", "--no-browser", "--base-url", base],
    { env: cleanEnv() },
  );
  let err = "";
  child.stderr.on("data", (c) => {
    err += c;
  });
  setTimeout(() => {
    child.kill("SIGKILL");
    resolve(err);
  }, 3500);
});
check("E", "E1 非 TTY 下打出 [AI agent] 引导", blockingStderr.includes("[AI agent]"));
check(
  "E",
  "E2 引导指向 --no-wait 两轮制",
  blockingStderr.includes("--no-wait") && blockingStderr.includes("--resume-code"),
);
check("E", "E3 引导带上当前 --base-url", blockingStderr.includes(`--base-url ${base}`));
check(
  "E",
  "E4 阻塞模式本身仍照常打 URL+code",
  blockingStderr.includes("https://busabase.com/device") &&
    blockingStderr.includes("Code: WXYZ7890"),
);

server.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n\x1b[1m总计 ${passed}/${results.length} 项通过\x1b[0m`);
writeFileSync(
  join(artifacts, "results.json"),
  JSON.stringify({ results, base, turn1Ms, out1, env401, env403, out2 }, null, 2),
);
rmSync(home, { recursive: true, force: true });
rmSync(artifacts, { recursive: true, force: true });
process.exit(passed === results.length ? 0 : 1);
