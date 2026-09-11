import { describe, expect, it } from "vitest";
import { fmt } from "../../../i18n/fmt";
import { dashboardJa } from "../../../i18n/ja";
import { coreMessagesEn } from "../../../i18n/messages";
import { dashboardZhCN } from "../../../i18n/zh-CN";
import { dashboardZhTW } from "../../../i18n/zh-TW";
import { buildAgentInstallPrompt } from "./agent-install-prompt";
import { renderPromptForDispatch } from "./agent-prompt-dispatch";

const catalogs = {
  en: coreMessagesEn,
  "zh-CN": dashboardZhCN,
  "zh-TW": dashboardZhTW,
  ja: dashboardJa,
} as const;

const SETUP_URL =
  "https://app.busabase.com/SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=spc_acme";

const BODY = [
  'Target: the Busabase Folder "Coder" (nodeId: nod_coder), in space "Acme" (spaceId: spc_acme).',
  "",
  "Summarize what is in this folder.",
  "",
  "Reply to me in English.",
].join("\n");

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
      "\n\nBefore you begin, confirm that this environment is connected to Busabase and points to the correct target space (spc_acme). If the Busabase connection is not configured or points to another space, read and follow this setup guide first:\n\n" +
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

    expect(text).toContain("points to the correct target space.");
    expect(text).not.toContain("(undefined)");
  });
});

/**
 * The install prompt's rendered output is frozen here on purpose.
 *
 * Its connection-check paragraph was lifted into a shared i18n key so the node
 * prompts could reuse it; these four strings are what the old, inline template
 * produced, captured before that move. They are the only thing that can catch a
 * shared-key edit silently rewording a prompt on the OTHER surface.
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

  it("renders English exactly as it did before the paragraph became shared", () => {
    expect(render("en")).toBe(
      'Install the Busabase app skill "kelly-email" so you can operate it later.\n\nBefore installing, confirm that this environment is connected to Busabase and points to the correct target space (spc_acme). If the Busabase connection is not configured or points to another space, read and follow this setup guide first:\n\nhttps://app.busabase.com/SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=spc_acme\n\nOnce the connection is ready, run:\n\nnpx skills add busabase/skills --skill kelly-email\n\nInstall the skill only — do not create, change or delete anything in my Busabase space yet. Once it is installed, tell me in a few lines what this app does and what it would create if I asked you to set it up.',
    );
  });

  it("renders Simplified Chinese exactly as it did before", () => {
    expect(render("zh-CN")).toBe(
      "安装 Busabase 应用技能「kelly-email」，以便你之后可以操作它。\n\n安装前，先确认当前环境已经连接 Busabase，并且连接的是正确的目标空间 (spc_acme)。如果当前环境尚未配置 Busabase 连接，或连接指向其他空间，请先阅读并遵循下面的连接引导：\n\nhttps://app.busabase.com/SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=spc_acme\n\n连接就绪后，执行：\n\nnpx skills add busabase/skills --skill kelly-email\n\n只安装技能——先不要在我的 Busabase 空间里创建、修改或删除任何东西。装好之后，用几句话告诉我这个 App 是做什么的，以及如果我让你去搭建它，会创建些什么。",
    );
  });

  it("renders Traditional Chinese exactly as it did before", () => {
    expect(render("zh-TW")).toBe(
      "安裝 Busabase 應用技能「kelly-email」，以便你之後可以操作它。\n\n安裝前，先確認目前環境已經連接 Busabase，並且連接的是正確的目標空間 (spc_acme)。如果目前環境尚未設定 Busabase 連接，或連接指向其他空間，請先閱讀並遵循下方的連接指引：\n\nhttps://app.busabase.com/SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=spc_acme\n\n連接就緒後，執行：\n\nnpx skills add busabase/skills --skill kelly-email\n\n只安裝技能——先不要在我的 Busabase 空間裡建立、修改或刪除任何東西。裝好之後，用幾句話告訴我這個 App 是做什麼的，以及如果我讓你去建置它，會建立些什麼。",
    );
  });

  it("renders Japanese exactly as it did before", () => {
    expect(render("ja")).toBe(
      "Busabase アプリスキル「kelly-email」を導入して、後で操作できるようにしてください。\n\n導入前に、この環境が Busabase に接続済みで、正しい対象スペース (spc_acme)に接続されていることを確認してください。Busabase の接続が未設定、または別のスペースを参照している場合は、先に次の接続ガイドを読んで従ってください：\n\nhttps://app.busabase.com/SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=spc_acme\n\n接続の準備ができたら、次を実行してください：\n\nnpx skills add busabase/skills --skill kelly-email\n\nスキルの導入だけを行い、私の Busabase スペースにはまだ何も作成・変更・削除しないでください。導入できたら、このアプリが何をするものか、セットアップを頼んだら何が作られるかを数行で教えてください。",
    );
  });
});
