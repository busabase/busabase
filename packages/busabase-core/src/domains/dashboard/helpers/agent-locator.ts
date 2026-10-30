/**
 * The "locator prompt": just enough for someone's own agent to find a node —
 * the target line (node type, name, nodeId, space; for a record also its
 * recordId) plus the connection check — with no task attached.
 *
 * It exists because that is what people mostly copy. The full scenario prompts
 * are useful, but the common move is "point my agent at THIS, then I'll type
 * what I want", which used to mean pasting a Busabase URL the agent could not
 * resolve. Every "copy locator" entry point (the split button's menu, the card
 * at the top of the prompts dialog, the sidebar's right-click, the ⓘ in the
 * header, the record's ID, the keyboard shortcut) copies this exact text.
 *
 * The connection check always rides along: a fresh agent may not have the
 * busabase skill yet, and a bare target line would send it to a browser.
 *
 * Pure: no React, no DOM — the setup URL is resolved by the caller.
 */

import type { CoreLocale } from "../../../i18n";
import {
  joinPromptSegments,
  type PromptSegment,
  renderAgentConnectionCheck,
} from "./agent-prompt-dispatch";

export interface LocatorPromptOptions {
  /** `renderNodeLocatorTarget` / `renderCreateTargetLine`. */
  target: string;
  /**
   * An optional request appended after the target ("Summarize this table") —
   * what an example chip in the copy toast adds. Omit for the bare locator.
   */
  request?: string;
  /** Same contract as `renderPromptSegments`: no URL → no connection segment. */
  setupUrl?: string;
  targetSpaceId?: string;
  /** `messages.agentPrompts.connectionCheckLeadIn`. */
  leadIn: string;
  /** `messages.agentPrompts.connectionCheck`. */
  connectionCheck: string;
  fmt: (template: string, values: Record<string, string>) => string;
}

/** Target, optional request, connection check — the same shape a full prompt has. */
export const buildLocatorSegments = ({
  target,
  request,
  setupUrl,
  targetSpaceId,
  leadIn,
  connectionCheck,
  fmt,
}: LocatorPromptOptions): PromptSegment[] => {
  const segments: PromptSegment[] = [{ kind: "target", text: target }];
  const task = request?.trim();
  if (task) segments.push({ kind: "task", text: task });
  if (setupUrl) {
    const paragraph = renderAgentConnectionCheck({ connectionCheck, fmt, setupUrl, targetSpaceId });
    segments.push({ kind: "connection", text: `${leadIn}${paragraph}` });
  }
  return segments;
};

/** The exact text every "copy locator" entry point puts on the clipboard. */
export const buildLocatorPrompt = (options: LocatorPromptOptions): string =>
  joinPromptSegments(buildLocatorSegments(options));

// ── Example requests for the copy toast ────────────────────────────────────────

/** Which set of example requests the copy toast offers. */
export type LocatorExampleKind =
  | "base"
  | "doc"
  | "drive"
  | "skill"
  | "airapp"
  | "form"
  | "folder"
  | "record"
  | "create"
  | "other";

const NODE_TYPE_EXAMPLE_KINDS: Partial<Record<string, LocatorExampleKind>> = {
  base: "base",
  doc: "doc",
  drive: "drive",
  skill: "skill",
  airapp: "airapp",
  form: "form",
  folder: "folder",
};

export const locatorExampleKind = (
  nodeType: string | undefined,
  scopeKind?: "node" | "field" | "record" | "cell",
): LocatorExampleKind => {
  if (scopeKind === "record" || scopeKind === "cell") return "record";
  return (nodeType && NODE_TYPE_EXAMPLE_KINDS[nodeType]) || "other";
};

/**
 * Two short things a person might type after pasting the locator — phrased as
 * the person talking to their agent, because a chip copies "locator + this".
 */
export const LOCATOR_EXAMPLES: Record<LocatorExampleKind, Record<CoreLocale, [string, string]>> = {
  base: {
    en: ["Summarize what's in this table", "Find the records added this week"],
    "zh-CN": ["总结一下这个表里有什么", "找出这周新加的记录"],
    "zh-TW": ["總結一下這個表裡有什麼", "找出這週新加的記錄"],
    ja: ["このテーブルの中身を要約して", "今週追加されたレコードを探して"],
    ko: ["이 테이블에 뭐가 있는지 요약해 줘", "이번 주에 추가된 레코드 찾아 줘"],
    es: ["Resume lo que hay en esta tabla", "Busca los registros añadidos esta semana"],
    pt: ["Resuma o que tem nesta tabela", "Ache os registros adicionados esta semana"],
    vi: ["Tóm tắt bảng này có gì", "Tìm các bản ghi được thêm trong tuần này"],
    fr: ["Résumez le contenu de cette table", "Trouvez les enregistrements ajoutés cette semaine"],
    de: [
      "Fassen Sie zusammen, was in dieser Tabelle steht",
      "Finden Sie die diese Woche hinzugefügten Datensätze",
    ],
  },
  doc: {
    en: ["Summarize this doc in five bullet points", "Suggest edits to make this clearer"],
    "zh-CN": ["用五条要点总结这篇文档", "给点修改建议，让它更清楚"],
    "zh-TW": ["用五點總結這篇文件", "給點修改建議，讓它更清楚"],
    ja: ["この文書を5つの要点にまとめて", "もっと分かりやすくする修正案を出して"],
    ko: ["이 문서를 다섯 가지 요점으로 요약해 줘", "더 명확해지도록 수정안을 제안해 줘"],
    es: ["Resume este documento en cinco puntos", "Sugiere cambios para que quede más claro"],
    pt: ["Resuma este documento em cinco tópicos", "Sugira edições para deixá-lo mais claro"],
    vi: ["Tóm tắt tài liệu này thành năm ý", "Gợi ý chỉnh sửa để nó rõ ràng hơn"],
    fr: ["Résumez ce document en cinq points", "Proposez des modifications pour le clarifier"],
    de: [
      "Fassen Sie dieses Dokument in fünf Punkten zusammen",
      "Schlagen Sie Änderungen für mehr Klarheit vor",
    ],
  },
  drive: {
    en: ["Tell me what each file in here is for", "Find the latest version of the contract"],
    "zh-CN": ["告诉我这里每个文件是做什么的", "找到合同的最新版本"],
    "zh-TW": ["告訴我這裡每個檔案是做什麼的", "找到合約的最新版本"],
    ja: ["ここにある各ファイルの用途を教えて", "契約書の最新版を探して"],
    ko: ["여기 있는 파일이 각각 뭔지 알려 줘", "계약서 최신 버전 찾아 줘"],
    es: ["Dime para qué sirve cada archivo de aquí", "Busca la última versión del contrato"],
    pt: ["Me diga para que serve cada arquivo aqui", "Ache a versão mais recente do contrato"],
    vi: ["Cho tôi biết mỗi tệp ở đây dùng để làm gì", "Tìm phiên bản mới nhất của hợp đồng"],
    fr: ["Dites-moi à quoi sert chaque fichier ici", "Trouvez la dernière version du contrat"],
    de: ["Sagen Sie mir, wofür jede Datei hier ist", "Finden Sie die neueste Version des Vertrags"],
  },
  skill: {
    en: ["What can this skill do for me?", "Run this skill on my latest data"],
    "zh-CN": ["这个 Skill 能帮我做什么？", "用这个 Skill 处理我最新的数据"],
    "zh-TW": ["這個 Skill 能幫我做什麼？", "用這個 Skill 處理我最新的資料"],
    ja: ["この Skill で何ができる？", "最新のデータでこの Skill を実行して"],
    ko: ["이 스킬로 뭘 할 수 있어?", "내 최신 데이터로 이 스킬을 실행해 줘"],
    es: ["¿Qué puede hacer esta skill por mí?", "Ejecuta esta skill con mis datos más recientes"],
    pt: ["O que esta skill pode fazer por mim?", "Rode esta skill com meus dados mais recentes"],
    vi: ["Kỹ năng này giúp được tôi việc gì?", "Chạy kỹ năng này với dữ liệu mới nhất của tôi"],
    fr: [
      "Que peut faire cette compétence pour moi ?",
      "Lancez cette compétence sur mes dernières données",
    ],
    de: [
      "Was kann dieser Skill für mich tun?",
      "Wenden Sie diesen Skill auf meine neuesten Daten an",
    ],
  },
  airapp: {
    en: ["Explain what this app does", "Add a search box to this app"],
    "zh-CN": ["讲讲这个应用是干什么的", "给这个应用加一个搜索框"],
    "zh-TW": ["講講這個應用是做什麼的", "幫這個應用加一個搜尋框"],
    ja: ["このアプリが何をするか説明して", "このアプリに検索ボックスを追加して"],
    ko: ["이 앱이 뭘 하는지 설명해 줘", "이 앱에 검색창을 추가해 줘"],
    es: ["Explícame qué hace esta app", "Añade un buscador a esta app"],
    pt: ["Explique o que este app faz", "Adicione uma caixa de busca a este app"],
    vi: ["Giải thích ứng dụng này làm gì", "Thêm ô tìm kiếm vào ứng dụng này"],
    fr: [
      "Expliquez ce que fait cette application",
      "Ajoutez une barre de recherche à cette application",
    ],
    de: ["Erklären Sie, was diese App macht", "Fügen Sie dieser App ein Suchfeld hinzu"],
  },
  form: {
    en: ["Summarize the latest submissions", "Add a phone number field to this form"],
    "zh-CN": ["总结一下最近的提交", "给这个表单加一个手机号字段"],
    "zh-TW": ["總結一下最近的提交", "幫這個表單加一個手機號碼欄位"],
    ja: ["最近の送信内容を要約して", "このフォームに電話番号のフィールドを追加して"],
    ko: ["최근 제출 내용을 요약해 줘", "이 폼에 전화번호 필드를 추가해 줘"],
    es: ["Resume los últimos envíos", "Añade un campo de teléfono a este formulario"],
    pt: ["Resuma os envios mais recentes", "Adicione um campo de telefone a este formulário"],
    vi: ["Tóm tắt các bài gửi gần đây", "Thêm trường số điện thoại vào biểu mẫu này"],
    fr: ["Résumez les derniers envois", "Ajoutez un champ téléphone à ce formulaire"],
    de: [
      "Fassen Sie die neuesten Einsendungen zusammen",
      "Fügen Sie diesem Formular ein Telefonfeld hinzu",
    ],
  },
  folder: {
    en: ["Give me an overview of this folder", "Suggest a cleaner way to organize this"],
    "zh-CN": ["给我讲讲这个文件夹里都有什么", "建议一个更清晰的整理方式"],
    "zh-TW": ["跟我講講這個資料夾裡都有什麼", "建議一個更清楚的整理方式"],
    ja: ["このフォルダの概要を教えて", "もっとすっきりした整理方法を提案して"],
    ko: ["이 폴더에 뭐가 있는지 개요를 알려 줘", "더 깔끔하게 정리할 방법을 제안해 줘"],
    es: ["Dame un resumen de esta carpeta", "Sugiere una forma más ordenada de organizarla"],
    pt: ["Me dê uma visão geral desta pasta", "Sugira um jeito mais organizado de arrumá-la"],
    vi: ["Cho tôi tổng quan về thư mục này", "Gợi ý cách sắp xếp gọn gàng hơn"],
    fr: ["Donnez-moi un aperçu de ce dossier", "Proposez une organisation plus claire"],
    de: [
      "Geben Sie mir einen Überblick über diesen Ordner",
      "Schlagen Sie eine klarere Ordnung vor",
    ],
  },
  record: {
    en: ["Summarize this record for me", "Fill in the empty fields on this record"],
    "zh-CN": ["帮我总结这条记录", "把这条记录的空字段补上"],
    "zh-TW": ["幫我總結這筆記錄", "把這筆記錄的空欄位補上"],
    ja: ["このレコードを要約して", "このレコードの空欄を埋めて"],
    ko: ["이 레코드를 요약해 줘", "이 레코드의 빈 필드를 채워 줘"],
    es: ["Resúmeme este registro", "Rellena los campos vacíos de este registro"],
    pt: ["Resuma este registro para mim", "Preencha os campos vazios deste registro"],
    vi: ["Tóm tắt bản ghi này giúp tôi", "Điền các trường còn trống của bản ghi này"],
    fr: ["Résumez-moi cet enregistrement", "Remplissez les champs vides de cet enregistrement"],
    de: [
      "Fassen Sie diesen Datensatz für mich zusammen",
      "Füllen Sie die leeren Felder dieses Datensatzes aus",
    ],
  },
  create: {
    en: ["Create a table to track my clients", "Draft a meeting notes doc here"],
    "zh-CN": ["建一个表来跟踪我的客户", "在这里起草一份会议纪要文档"],
    "zh-TW": ["建一個表來追蹤我的客戶", "在這裡起草一份會議紀錄文件"],
    ja: ["顧客を管理するテーブルを作って", "ここに議事録の Doc を下書きして"],
    ko: ["고객을 관리할 테이블을 만들어 줘", "여기에 회의록 문서 초안을 써 줘"],
    es: ["Crea una tabla para seguir a mis clientes", "Redacta aquí un Doc de notas de reunión"],
    pt: ["Crie uma tabela para acompanhar meus clientes", "Redija aqui um Doc de ata de reunião"],
    vi: ["Tạo một bảng để theo dõi khách hàng của tôi", "Soạn nháp tài liệu biên bản họp ở đây"],
    fr: [
      "Créez une table pour suivre mes clients",
      "Rédigez ici un Doc de compte rendu de réunion",
    ],
    de: [
      "Legen Sie eine Tabelle für meine Kunden an",
      "Entwerfen Sie hier ein Doc für Besprechungsnotizen",
    ],
  },
  other: {
    en: ["Explain what this is and how to use it", "Summarize what's in here"],
    "zh-CN": ["讲讲这是什么、怎么用", "总结一下这里面有什么"],
    "zh-TW": ["講講這是什麼、怎麼用", "總結一下這裡面有什麼"],
    ja: ["これが何で、どう使うのか説明して", "ここに何があるか要約して"],
    ko: ["이게 뭔지, 어떻게 쓰는지 설명해 줘", "여기 뭐가 있는지 요약해 줘"],
    es: ["Explícame qué es esto y cómo usarlo", "Resume lo que hay aquí"],
    pt: ["Explique o que é isto e como usar", "Resuma o que tem aqui"],
    vi: ["Giải thích đây là gì và cách dùng", "Tóm tắt những gì có ở đây"],
    fr: ["Expliquez ce que c'est et comment l'utiliser", "Résumez ce qu'il y a ici"],
    de: [
      "Erklären Sie, was das ist und wie man es nutzt",
      "Fassen Sie zusammen, was hier drin ist",
    ],
  },
};

export const locatorExamples = (kind: LocatorExampleKind, locale: CoreLocale): string[] =>
  LOCATOR_EXAMPLES[kind][locale];
