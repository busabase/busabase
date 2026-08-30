import type { SeedFolderDef, SeedRichNodeDef, SeedScenario } from "../seed-types";
import {
  NESTED_BRAND_KIT_FOLDER_NODE_ID,
  NESTED_LAUNCH_ASSETS_FOLDER_NODE_ID,
  NESTED_LAUNCH_FOLDER_NODE_ID,
  NESTED_RETRO_FOLDER_NODE_ID,
  nestedFolderShape,
  nestedHtmlPage,
} from "./nested-folders";

/**
 * zh-CN twin of `nested-folders.ts` — same node ids, slugs, positions and
 * nesting, only the human-facing labels differ (the convention every other
 * `*.zh-cn.ts` scenario in this folder follows). See the English file for
 * why this deep branch exists at all.
 */

const folders: SeedFolderDef[] = [
  {
    ...nestedFolderShape.productOps,
    name: "产品运营",
    description: "一次发布是怎么跑的——先按项目分，再按工作流分。",
  },
  {
    ...nestedFolderShape.launch,
    name: "2026 发布",
    description: "2026 发布的全部材料，每条工作流一个子文件夹。",
  },
  {
    ...nestedFolderShape.launchAssets,
    name: "发布物料",
    description: "随发布一起上线的页面与视觉素材。",
  },
  {
    ...nestedFolderShape.brandKit,
    name: "品牌套件",
    description: "Logo、配色，以及给合作伙伴的一页纸。",
  },
  {
    ...nestedFolderShape.archive,
    name: "归档",
    description: "已结束的项目，留作参考。",
  },
  {
    ...nestedFolderShape.retro,
    name: "2025 复盘",
    description: "上一次发布留下的经验。",
  },
];

const richNodes: SeedRichNodeDef[] = [
  {
    nodeType: "html",
    nodeId: "nod_nested_html_launch_checklist",
    folderNodeId: NESTED_LAUNCH_FOLDER_NODE_ID,
    slug: "launch-checklist",
    name: "发布检查清单",
    description: "发布当天的 go / no-go 清单。",
    position: 1,
    metadata: {
      htmlDocument: {
        version: 1,
        source: nestedHtmlPage("2026 发布检查清单", "发布当天之前必须全部审核通过的事项。", [
          "定价页已审核并合并",
          "文档已跟上新的引导流程",
          "客服话术已撰写并审核",
          "状态页与回滚方案已确认",
        ]),
      },
    },
  },
  {
    nodeType: "html",
    nodeId: "nod_nested_html_press_page",
    folderNodeId: NESTED_LAUNCH_ASSETS_FOLDER_NODE_ID,
    slug: "launch-press-page",
    name: "媒体页",
    description: "发布周对外的媒体页草稿。",
    position: 1,
    metadata: {
      htmlDocument: {
        version: 1,
        source: nestedHtmlPage("媒体页草稿", "发布当天媒体看到的内容。", [
          "标题与一句话定位",
          "三张产品截图并配说明",
          "创始人引言（已经公关审核）",
          "采访邀约的联系邮箱",
        ]),
      },
    },
  },
  {
    nodeType: "html",
    nodeId: "nod_nested_html_one_pager",
    folderNodeId: NESTED_BRAND_KIT_FOLDER_NODE_ID,
    slug: "launch-one-pager",
    name: "合作伙伴一页纸",
    description: "合作伙伴问「这次发了什么」时，直接发这一页。",
    position: 0,
    metadata: {
      htmlDocument: {
        version: 1,
        source: nestedHtmlPage(
          "合作伙伴一页纸",
          "不需要我们补充任何上下文就能在对方内部转发的一页。",
          ["一句话说明改了什么", "适合谁，不适合谁", "Logo 与配色的使用规则", "问题往哪里提"],
        ),
      },
    },
  },
  {
    nodeType: "html",
    nodeId: "nod_nested_html_retro_summary",
    folderNodeId: NESTED_RETRO_FOLDER_NODE_ID,
    slug: "retro-2025-summary",
    name: "复盘小结",
    description: "2025 发布留下的经验，一页写完。",
    position: 0,
    metadata: {
      htmlDocument: {
        version: 1,
        source: nestedHtmlPage("2025 发布复盘", "刻意写短——只留四条。", [
          "检查清单写得太晚，等于没写",
          "文档和定价页上线时间对不上",
          "第一天客服手里没有话术",
          "回滚方案从来没有演练过",
        ]),
      },
    },
  },
];

export const nestedFoldersZhCnScenario: SeedScenario = { folders, richNodes };
