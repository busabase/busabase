import { describe, expect, it } from "vitest";
import { fmt } from "../../../i18n/fmt";
import { dashboardJa } from "../../../i18n/ja";
import { coreMessagesEn } from "../../../i18n/messages";
import { dashboardZhCN } from "../../../i18n/zh-CN";
import { dashboardZhTW } from "../../../i18n/zh-TW";
import { buildAgentInstallCommand, buildAgentInstallPrompt } from "./agent-install-prompt";
import {
  joinPromptSegments,
  renderPromptForDispatch,
  renderPromptSegments,
} from "./agent-prompt-dispatch";

const catalogs = {
  en: coreMessagesEn,
  "zh-CN": dashboardZhCN,
  "zh-TW": dashboardZhTW,
  ja: dashboardJa,
} as const;

const SETUP_URL =
  "https://app.busabase.com/SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=spc_acme";

const TARGET =
  'Target: the Busabase Folder "Coder" (nodeId: nod_coder), in space "Acme" (spaceId: spc_acme).';
const FOOTER = "Reply to me in English.";
const BODY = [TARGET, "", "Summarize what is in this folder.", "", FOOTER].join("\n");

const dispatch = (locale: keyof typeof catalogs, setupUrl?: string) =>
  renderPromptForDispatch({
    body: BODY,
    connectionCheck: catalogs[locale].agentPrompts.connectionCheck,
    fmt,
    leadIn: catalogs[locale].agentPrompts.connectionCheckLeadIn,
    setupUrl,
    targetSpaceId: "spc_acme",
  });

describe("renderPromptForDispatch", () => {
  it("appends the connection check after the body the preview shows", () => {
    const text = dispatch("en", SETUP_URL);

    // The preview's three parts survive byte-for-byte at the front: someone who
    // only wants the target line must still be able to select it off the top.
    expect(text.startsWith(`${BODY}\n\n`)).toBe(true);
    expect(text.slice(BODY.length)).toBe(
      "\n\nBefore you begin, make sure this environment can reach Busabase through the busabase skill, the Busabase MCP or busabase-cli, pointed at the correct target space (spc_acme), and do the work through them — not by opening Busabase in a browser. If none of them is set up, or the connection points to another space, first fetch this setup guide as plain text (for example with curl) and follow it:\n\n" +
        SETUP_URL,
    );
  });

  it("appends nothing at all when the host could not resolve a setup URL", () => {
    // The dangerous alternative is a default origin: a `localhost:15419` guide
    // handed to a Cloud user's agent points it at a machine that is not theirs.
    expect(dispatch("en", undefined)).toBe(BODY);
    expect(dispatch("zh-CN", "")).toBe(BODY);
  });

  it("reads as one sentence in every locale, and always ends on the setup URL", () => {
    for (const locale of Object.keys(catalogs) as (keyof typeof catalogs)[]) {
      const text = dispatch(locale, SETUP_URL);
      expect(text.startsWith(`${BODY}\n\n`)).toBe(true);
      expect(text.endsWith(`\n\n${SETUP_URL}`)).toBe(true);
      // A leftover `{token}` means a placeholder was never interpolated — the
      // exact failure a single-pass `fmt` produces if the paragraph is nested
      // inside another template instead of rendered first.
      expect(text.slice(BODY.length)).not.toMatch(/\{[a-z]+\}/i);
    }
  });

  it("omits the space parenthetical on Desktop, where there is no space to name", () => {
    const text = renderPromptForDispatch({
      body: BODY,
      connectionCheck: coreMessagesEn.agentPrompts.connectionCheck,
      fmt,
      leadIn: coreMessagesEn.agentPrompts.connectionCheckLeadIn,
      setupUrl: "http://localhost:15419/SETUP_SKILL.md?edition=desktop&editionConfirmed=1",
    });

    expect(text).toContain("pointed at the correct target space, and do the work");
    expect(text).not.toContain("(undefined)");
  });
});

describe("renderPromptSegments", () => {
  const segments = (
    overrides: { body?: string; target?: string; footer?: string; setupUrl?: string } = {},
  ) =>
    renderPromptSegments({
      body: BODY,
      connectionCheck: coreMessagesEn.agentPrompts.connectionCheck,
      fmt,
      footer: FOOTER,
      leadIn: coreMessagesEn.agentPrompts.connectionCheckLeadIn,
      setupUrl: SETUP_URL,
      target: TARGET,
      targetSpaceId: "spc_acme",
      ...overrides,
    });

  it("splits the preview into target, task, footer and connection check", () => {
    expect(segments().map((segment) => [segment.kind, segment.text.slice(0, 24)])).toEqual([
      ["target", TARGET.slice(0, 24)],
      ["task", "Summarize what is in thi"],
      ["footer", FOOTER.slice(0, 24)],
      ["connection", "Before you begin, make s"],
    ]);
  });

  it("joins back to exactly the text that is copied — what you see is what the agent gets", () => {
    expect(joinPromptSegments(segments())).toBe(dispatch("en", SETUP_URL));
  });

  it("names the agent-side tools and rules out the browser in every locale", () => {
    for (const locale of Object.keys(catalogs) as (keyof typeof catalogs)[]) {
      const check = catalogs[locale].agentPrompts.connectionCheck;
      expect(check).toContain("busabase-cli");
      expect(check).toContain("MCP");
      expect(check).toContain("curl");
    }
  });

  it("keeps a custom prompt whole when {target} sits mid-sentence", () => {
    const body = `Please review ${TARGET} carefully.\n\n${FOOTER}`;
    const parts = segments({ body });
    expect(parts.map((segment) => segment.kind)).toEqual(["task", "footer", "connection"]);
    expect(parts[0]?.text).toBe(`Please review ${TARGET} carefully.`);
  });

  it("drops the empty task when a custom prompt is only {target}", () => {
    const parts = segments({ body: `${TARGET}\n\n${FOOTER}`, setupUrl: undefined });
    expect(parts.map((segment) => segment.kind)).toEqual(["target", "footer"]);
    expect(joinPromptSegments(parts)).toBe(`${TARGET}\n\n${FOOTER}`);
  });

  it("previews a hand-built prompt with no framing as one task", () => {
    expect(segments({ target: undefined, footer: undefined, setupUrl: undefined })).toEqual([
      { kind: "task", text: BODY },
    ]);
  });
});

/**
 * The install prompt's rendered output is frozen here on purpose.
 *
 * Its connection-check paragraph is a shared i18n key the node prompts reuse.
 * These four strings are the only thing that can catch a shared-key edit
 * silently rewording a prompt on the OTHER surface — so when the paragraph is
 * reworded deliberately, it is reworded here too, by hand.
 */
describe("buildAgentInstallPrompt", () => {
  const render = (locale: keyof typeof catalogs) =>
    buildAgentInstallPrompt({
      connectionCheck: catalogs[locale].agentPrompts.connectionCheck,
      fmt,
      packageName: "Kelly Email",
      setupUrl: SETUP_URL,
      source: { owner: "busabase", repo: "skills", ref: "main", subdir: "skills/kelly-email" },
      targetSpaceId: "spc_acme",
      template: catalogs[locale].install.agentPromptBody,
    });

  it("renders English exactly", () => {
    expect(render("en")).toBe(
      'Install the Busabase app skill "kelly-email" so you can operate it later.\n\nBefore installing, make sure this environment can reach Busabase through the busabase skill, the Busabase MCP or busabase-cli, pointed at the correct target space (spc_acme), and do the work through them — not by opening Busabase in a browser. If none of them is set up, or the connection points to another space, first fetch this setup guide as plain text (for example with curl) and follow it:\n\nhttps://app.busabase.com/SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=spc_acme\n\nOnce the connection is ready, run:\n\nnpx skills add busabase/skills --skill kelly-email\n\nInstall the skill only — do not create, change or delete anything in my Busabase space yet. Once it is installed, tell me in a few lines what this app does and what it would create if I asked you to set it up.',
    );
  });

  it("renders Simplified Chinese exactly", () => {
    expect(render("zh-CN")).toBe(
      "安装 Busabase 应用技能「kelly-email」，以便你之后可以操作它。\n\n安装前，先确认当前环境能通过 busabase 技能、Busabase MCP 或 busabase-cli 访问 Busabase，并且连接的是正确的目标空间 (spc_acme)；之后都用这些工具来操作，不要在浏览器里打开 Busabase 网页来做。如果它们都还没配置好，或连接指向其他空间，请先以纯文本方式读取下面的连接引导（例如用 curl）并照着做：\n\nhttps://app.busabase.com/SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=spc_acme\n\n连接就绪后，执行：\n\nnpx skills add busabase/skills --skill kelly-email\n\n只安装技能——先不要在我的 Busabase 空间里创建、修改或删除任何东西。装好之后，用几句话告诉我这个 App 是做什么的，以及如果我让你去搭建它，会创建些什么。",
    );
  });

  it("renders Traditional Chinese exactly", () => {
    expect(render("zh-TW")).toBe(
      "安裝 Busabase 應用技能「kelly-email」，以便你之後可以操作它。\n\n安裝前，先確認目前環境能透過 busabase 技能、Busabase MCP 或 busabase-cli 存取 Busabase，並且連接的是正確的目標空間 (spc_acme)；之後都用這些工具來操作，不要在瀏覽器裡開啟 Busabase 網頁來做。如果它們都還沒設定好，或連接指向其他空間，請先以純文字方式讀取下方的連接指引（例如用 curl）並照著做：\n\nhttps://app.busabase.com/SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=spc_acme\n\n連接就緒後，執行：\n\nnpx skills add busabase/skills --skill kelly-email\n\n只安裝技能——先不要在我的 Busabase 空間裡建立、修改或刪除任何東西。裝好之後，用幾句話告訴我這個 App 是做什麼的，以及如果我讓你去建置它，會建立些什麼。",
    );
  });

  it("renders Japanese exactly", () => {
    expect(render("ja")).toBe(
      "Busabase アプリスキル「kelly-email」を導入して、後で操作できるようにしてください。\n\n導入前に、この環境から busabase スキル、Busabase MCP、または busabase-cli で Busabase にアクセスでき、正しい対象スペース (spc_acme)に接続されていることを確認し、作業はそれらのツールで行ってください。ブラウザで Busabase の画面を開いて操作しないでください。どれも未設定、または別のスペースを参照している場合は、先に次の接続ガイドをプレーンテキストとして取得し（例：curl）、その手順に従ってください：\n\nhttps://app.busabase.com/SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=spc_acme\n\n接続の準備ができたら、次を実行してください：\n\nnpx skills add busabase/skills --skill kelly-email\n\nスキルの導入だけを行い、私の Busabase スペースにはまだ何も作成・変更・削除しないでください。導入できたら、このアプリが何をするものか、セットアップを頼んだら何が作られるかを数行で教えてください。",
    );
  });

  it("points a template agent at the resource installer and selected package", () => {
    const source = {
      owner: "busabase",
      repo: "templates",
      ref: "main",
      subdir: "templates/busa-drama",
    };
    const command =
      "npx --yes busabase-cli@latest install https://github.com/busabase/templates/tree/main --skill busa-drama\nnpx skills add https://github.com/busabase/templates/tree/main/templates/busa-drama";

    expect(buildAgentInstallCommand(source)).toBe(command);
    expect(
      buildAgentInstallPrompt({
        connectionCheck: coreMessagesEn.agentPrompts.connectionCheck,
        fmt,
        packageName: "Busa Drama",
        setupUrl: SETUP_URL,
        source,
        targetSpaceId: "spc_acme",
        template: coreMessagesEn.install.agentTemplatePromptBody,
      }),
    ).toContain(command);
  });

  it("uses a template's declared ref and keeps existing skill and root commands", () => {
    expect(
      buildAgentInstallCommand({
        owner: "busabase",
        repo: "templates",
        ref: "release",
        subdir: "templates/busa-drama",
      }),
    ).toBe(
      "npx --yes busabase-cli@latest install https://github.com/busabase/templates/tree/release --skill busa-drama\nnpx skills add https://github.com/busabase/templates/tree/release/templates/busa-drama",
    );
    expect(
      buildAgentInstallCommand({
        owner: "busabase",
        repo: "skills",
        ref: "main",
        subdir: "skills/kelly-email",
      }),
    ).toBe("npx skills add busabase/skills --skill kelly-email");
    expect(buildAgentInstallCommand({ owner: "busabase", repo: "skills" })).toBe(
      "npx skills add busabase/skills",
    );
  });
});
