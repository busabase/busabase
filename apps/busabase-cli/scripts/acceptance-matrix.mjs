/**
 * Multi-point acceptance for busabase-cli two-turn login / error hints / qrcode.
 *
 * Run: `node scripts/acceptance-matrix.mjs` (after `pnpm run build`).
 * Exits non-zero on the first failing check, so CI can gate on it.
 * Every check runs the BUILT dist/cli.js in a SEPARATE process against a REAL
 * local HTTP server. Nothing is mocked inside the CLI.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    if (req.url === "/api/health") {
      // doctor probes this. Shaped like the open-source server's response
      // (no `version` field), which is also what its edition inference reads.
      return send(200, { status: "ok", service: "busabase", timestamp: new Date(0).toISOString() });
    }
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

// ══ F. skill / skill install —— 只装了 CLI 没装 skill 的用户 ══
section("F. skill 自举 (bootstrap without the skill installed)");

// 一台“新版”服务器：真的会 serve /SETUP_SKILL.md。主 stub server 对这个路径返 404，
// 正好就是旧版/自托管服务器的样子，两种服务器都要覆盖到。
const LIVE_MARKER = "SERVED-BY-THE-LIVE-HOST";
const setupServer = createServer((req, res) => {
  if (req.url === "/SETUP_SKILL.md") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return res.end(`---\nname: busabase\n---\n# ${LIVE_MARKER}\n`);
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: "not found" }));
});
await new Promise((r) => setupServer.listen(0, "127.0.0.1", r));
const liveBase = `http://127.0.0.1:${setupServer.address().port}`;

// 一个确定没人监听的端口：断网/服务器没起来的情形。先开再关，拿到一个必然 ECONNREFUSED 的地址。
const deadProbe = createServer(() => {});
await new Promise((r) => deadProbe.listen(0, "127.0.0.1", r));
const deadBase = `http://127.0.0.1:${deadProbe.address().port}`;
await new Promise((r) => deadProbe.close(r));

const skillOffline = await cli(["skill", "--base-url", deadBase]);
check(
  "F",
  "F1 没有任何服务器时 skill 仍打出完整文档",
  skillOffline.status === 0 &&
    skillOffline.stdout.includes("name: busabase") &&
    skillOffline.stdout.length > 3000,
  `exit=${skillOffline.status} bytes=${skillOffline.stdout.length}`,
);
check("F", "F2 文档按 --base-url 个性化，不是写死的域名", skillOffline.stdout.includes(deadBase));

const setupLive = await cli(["skill", "setup", "--base-url", liveBase]);
check(
  "F",
  "F3 服务器提供 /SETUP_SKILL.md 时取服务端那份",
  setupLive.status === 0 && setupLive.stdout.includes(LIVE_MARKER),
  `exit=${setupLive.status}`,
);

// 主 stub server 对 /SETUP_SKILL.md 返 404 —— 旧服务器。
const setupOld = await cli(["skill", "setup", "--base-url", base]);
check(
  "F",
  "F4 旧服务器 404 时自动回落且退出码仍为 0",
  setupOld.status === 0 && setupOld.stdout.length > 3000 && !setupOld.stdout.includes(LIVE_MARKER),
  `exit=${setupOld.status} bytes=${setupOld.stdout.length}`,
);
check(
  "F",
  "F5 回落时 stderr 说明用了内嵌副本，stdout 不被污染",
  setupOld.stderr.includes("bundled with busabase-cli") &&
    setupOld.stderr.includes("404") &&
    setupOld.stdout.trimStart().startsWith("---"),
);
check(
  "F",
  "F6 setup-skill 别名与 skill setup 等价",
  (await cli(["setup-skill", "--base-url", liveBase])).stdout.includes(LIVE_MARKER),
);

// 凭据泄漏：这份文档会被 `skill install` 写进用户仓库，默认绝不能带真 key。
// 必须显式 --mode cloud：环回地址会被正确判成自托管版，而自托管版整份文档都不带
// 鉴权头，于是「没泄漏」会因为根本没有那一段而假绿——真正要守的是 cloud 那条路。
const leakEnv = { BUSABASE_API_KEY: "sk_should_never_be_printed" };
const cloudArgs = ["skill", "--mode", "cloud", "--base-url", deadBase];
const noKey = await cli(cloudArgs, leakEnv);
const withKey = await cli([...cloudArgs, "--with-key"], leakEnv);
check(
  "F",
  "F7 cloud 版默认不把真实 API key 写进文档",
  !noKey.stdout.includes("sk_should_never_be_printed") && noKey.stdout.includes("YOUR_API_KEY"),
);
check("F", "F8 --with-key 才注入", withKey.stdout.includes("sk_should_never_be_printed"));
check(
  "F",
  "F13 自托管版整份文档不带鉴权头（--mode 覆盖生效）",
  !(await cli(["skill", "--base-url", deadBase], leakEnv)).stdout.includes("Authorization: Bearer"),
);

// install：真的落盘，真的拒绝覆盖。
const installRoot = mkdtempSync(join(tmpdir(), "busa-skill-install-"));
const installed = join(installRoot, "busabase", "SKILL.md");
const install1 = await cli(["skill", "install", installRoot, "--base-url", deadBase]);
check(
  "F",
  "F9 install 真的写出文件并打印绝对路径",
  install1.status === 0 && existsSync(installed) && install1.stdout.includes(installed),
  `exit=${install1.status}`,
);
check(
  "F",
  "F10 落盘内容就是 skill 打印的那份",
  existsSync(installed) && readFileSync(installed, "utf8").trim() === skillOffline.stdout.trim(),
);
const install2 = await cli(["skill", "install", installRoot, "--base-url", deadBase]);
check(
  "F",
  "F11 已存在时拒绝覆盖并以非 0 退出",
  install2.status !== 0 && `${install2.stdout}${install2.stderr}`.includes("--force"),
  `exit=${install2.status}`,
);
writeFileSync(installed, "EDITED BY THE USER\n");
const install3 = await cli(["skill", "install", installRoot, "--force", "--base-url", deadBase]);
check(
  "F",
  "F12 --force 才覆盖",
  install3.status === 0 && !readFileSync(installed, "utf8").includes("EDITED BY THE USER"),
  `exit=${install3.status}`,
);
rmSync(installRoot, { recursive: true, force: true });
setupServer.close();

// ══ G. doctor —— 环境自检 ══
section("G. doctor 环境自检 (must report even when everything is broken)");

// G 组自带一个干净的 HOME 和 cwd，免得跑测试的人自己的 ~/.busabase 影响判定。
const docHome = mkdtempSync(join(tmpdir(), "busa-doctor-home-"));
const docCwd = mkdtempSync(join(tmpdir(), "busa-doctor-cwd-"));
const doctor = async (args = [], extraEnv = {}) => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, "doctor", ...args], {
      cwd: docCwd,
      env: { ...cleanEnv({ HOME: docHome, ...extraEnv }), HOME: docHome },
      timeout: 60_000,
    });
    return { status: 0, stdout, stderr };
  } catch (e) {
    return { status: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

// 一个必然没人监听的地址：断网/服务器没起来。
const docDead = createServer(() => {});
await new Promise((r) => docDead.listen(0, "127.0.0.1", r));
const deadUrl = `http://127.0.0.1:${docDead.address().port}`;
await new Promise((r) => docDead.close(r));

const t0doc = Date.now();
const broken = await doctor([], { BUSABASE_BASE_URL: deadUrl });
const brokenMs = Date.now() - t0doc;
const LABELS = [
  "Credential file",
  "Settings file",
  "Account",
  "Base URL",
  "Env overrides",
  "Server",
  "Edition",
  "Server version",
  "Credential (stored)",
  "Credential (live)",
  "Target space",
  "Agent skill",
  "MCP",
  "CLI version",
];
check(
  "G",
  "G1 一切皆坏时仍打出全部 14 项，不中途退出",
  LABELS.every((l) => broken.stdout.includes(l)),
  `缺: ${LABELS.filter((l) => !broken.stdout.includes(l)).join(",") || "无"}`,
);
check("G", "G2 服务器不可达标记为失败", /✗ Server/.test(broken.stdout));
check("G", "G3 有失败时退出码非 0", broken.status !== 0, `exit=${broken.status}`);
check(
  "G",
  "G4 未检查项显示 – 而不是 ✓",
  /– Credential \(live\)/.test(broken.stdout) && !/✓ Credential \(live\)/.test(broken.stdout),
);
check(
  "G",
  "G5 每项标注来源（本地/实时/推断）",
  broken.stdout.includes("[read locally]") &&
    broken.stdout.includes("[checked against the server]") &&
    broken.stdout.includes("[inferred]"),
);
check(
  "G",
  "G6 不可达时不重试、不拖时间",
  brokenMs < 15_000 && !broken.stderr.includes("retrying"),
  `${brokenMs}ms`,
);

// 真 server + 有效凭据：主 stub server 认 sk_matrix_test，并有 /api/health。
const healthy = await doctor([], { BUSABASE_BASE_URL: base, BUSABASE_API_KEY: "sk_matrix_test" });
check(
  "G",
  "G7 服务器活着时 Server 变 ok",
  /✓ Server/.test(healthy.stdout),
  `exit=${healthy.status}`,
);
check("G", "G8 凭据被接受时 Credential (live) 变 ok", /✓ Credential \(live\)/.test(healthy.stdout));
check(
  "G",
  "G9 「本地存着」和「服务端认可」分开报，不混为一谈",
  healthy.stdout.includes("Credential (stored)") && healthy.stdout.includes("Credential (live)"),
);

// 凭据被拒：服务器活着但 key 是假的 —— live 必须 fail，而不是沿用本地的乐观判断。
const badKey = await doctor([], { BUSABASE_BASE_URL: base, BUSABASE_API_KEY: "sk_not_a_real_key" });
check(
  "G",
  "G10 服务器活着但 key 无效 → live 判失败，其他项照常报告",
  /✗ Credential \(live\)/.test(badKey.stdout) && /✓ Server/.test(badKey.stdout),
);

// skill 检测：先用 skill install 装进 doctor 的 cwd，再让 doctor 找 —— 顺便验证两条命令的闭环。
check(
  "G",
  "G11 装 skill 前报未安装",
  /! Agent skill/.test(broken.stdout) && broken.stdout.includes("busabase-cli skill install"),
);
const skillInstalled = await cli(
  ["skill", "install", join(docCwd, ".agents", "skills"), "--base-url", deadUrl],
  { HOME: docHome },
);
const afterInstall = await doctor([], { BUSABASE_BASE_URL: deadUrl });
check(
  "G",
  "G12 skill install 之后 doctor 立刻检出（两条命令对同一位置达成一致）",
  skillInstalled.status === 0 && /✓ Agent skill/.test(afterInstall.stdout),
  `install exit=${skillInstalled.status}`,
);

// MCP：伪造一份含 busabase 条目的 .mcp.json，以及一份坏掉的。
writeFileSync(
  join(docCwd, ".mcp.json"),
  JSON.stringify({ mcpServers: { busabase: { url: base } } }),
);
const withMcp = await doctor([], { BUSABASE_BASE_URL: deadUrl });
check("G", "G13 检出配好的 MCP", /✓ MCP/.test(withMcp.stdout));
writeFileSync(join(docCwd, ".mcp.json"), "{ this is not json");
const brokenMcp = await doctor([], { BUSABASE_BASE_URL: deadUrl });
check(
  "G",
  "G14 MCP 配置损坏报警告而不是崩溃",
  /! MCP/.test(brokenMcp.stdout) && brokenMcp.stdout.includes("unreadable"),
);
rmSync(join(docCwd, ".mcp.json"), { force: true });

// 配置文件三态：存在但读不出，必须区别于「不存在」。
const badConfig = join(docHome, ".busabase", "config.json");
mkdirSync(join(docHome, ".busabase"), { recursive: true });
writeFileSync(badConfig, "{ broken");
const corrupt = await doctor([], { BUSABASE_BASE_URL: deadUrl });
check(
  "G",
  "G15 config.json 损坏被指名，而不是静默当成缺省",
  /✗ Settings file/.test(corrupt.stdout) && corrupt.stdout.includes("not valid JSON"),
);
rmSync(badConfig, { force: true });

// JSON 输出：结构化、可被脚本消费。
const asJson = await doctor(["--output", "json"], { BUSABASE_BASE_URL: deadUrl });
let parsedDoctor = null;
try {
  parsedDoctor = JSON.parse(asJson.stdout);
} catch {}
check(
  "G",
  "G16 --output json 是合法 JSON 且每项带 id/state/probe",
  Boolean(parsedDoctor?.checks?.length) &&
    parsedDoctor.checks.every((c) => c.id && c.state && c.probe) &&
    typeof parsedDoctor.summary?.fail === "number",
  parsedDoctor ? `${parsedDoctor.checks.length} 项` : "解析失败",
);

rmSync(docHome, { recursive: true, force: true });
rmSync(docCwd, { recursive: true, force: true });

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
