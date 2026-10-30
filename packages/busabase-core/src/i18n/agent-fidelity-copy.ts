import type { AcpTranscriptProps } from "@acp-ui/web/transcript";

/** Shared ACP components have English defaults; the host owns product localization. */
export function agentFidelityLabels(locale: string): NonNullable<AcpTranscriptProps["labels"]> {
  if (locale !== "zh-CN" && locale !== "zh-TW") return {};
  const traditional = locale === "zh-TW";
  return {
    permissionCancelled: "已取消",
    permissionConfirmationUnknown: traditional
      ? "暫未確認送達，請重試相同決定。"
      : "暂未确认送达，请重试相同决定。",
    permissionRetry: traditional ? "重試相同決定" : "重试相同决定",
    process: {
      workingFor: (duration) => (traditional ? `正在處理 · ${duration}` : `正在处理 · ${duration}`),
      workedFor: (duration) => (traditional ? `處理完成 · ${duration}` : `处理完成 · ${duration}`),
      waitingInput: "等待你回答",
      waitingPermission: traditional ? "等待你授權" : "等待你授权",
      confirmingInput: traditional ? "正在確認回答送達" : "正在确认回答送达",
      confirmingPermission: traditional ? "正在確認授權決定" : "正在确认授权决定",
      cancelled: "已停止",
      failed: traditional ? "執行失敗" : "执行失败",
      interrupted: traditional ? "執行已中斷" : "执行已中断",
      limited: traditional ? "已達執行限制" : "已达执行限制",
      refused: traditional ? "請求已拒絕" : "请求已拒绝",
      step: (index) => (traditional ? `步驟 ${index}` : `步骤 ${index}`),
      planTitle: traditional ? "執行計畫" : "执行计划",
      planProgress: (completed, total) =>
        traditional ? `已完成 ${completed}/${total} 項` : `已完成 ${completed}/${total} 项`,
    },
    input: {
      waiting: "需要你回答",
      submit: "提交回答",
      sending: "正在提交…",
      decline: traditional ? "拒絕回答" : "拒绝回答",
      cancel: "取消",
      answered: "已回答",
      declined: traditional ? "已拒絕" : "已拒绝",
      cancelled: "已取消",
      confirmationUnknown: traditional
        ? "暫未確認回答送達，已保留原回答供重試。"
        : "暂未确认回答送达，已保留原回答供重试。",
      retry: traditional ? "重試原回答" : "重试原回答",
      unsupported: traditional
        ? "此介面暫不支援這種問題，請在 Buda 中開啟。"
        : "此界面暂不支持这种问题，请在 Buda 中打开。",
      choose: traditional ? "請選擇" : "请选择",
    },
    resources: {
      open: traditional ? "開啟" : "打开",
      download: traditional ? "下載" : "下载",
      resolve: traditional ? "開啟檔案" : "打开文件",
      retry: traditional ? "重試" : "重试",
      unavailable: traditional ? "暫時無法開啟此檔案。" : "暂时无法打开此文件。",
      preview: traditional ? "預覽" : "预览",
      loading: traditional ? "正在讀取預覽…" : "正在读取预览…",
      tooLarge: traditional ? "檔案過大，請下載後開啟。" : "文件过大，请下载后打开。",
    },
    jobs: {
      pending: traditional ? "等待執行" : "等待执行",
      queued: traditional ? "已排程" : "已排队",
      downloading: traditional ? "正在下載" : "正在下载",
      expired: traditional ? "已過期" : "已过期",
      running: traditional ? "執行中" : "执行中",
      in_progress: traditional ? "執行中" : "执行中",
      completed: "已完成",
      succeeded: "已完成",
      failed: traditional ? "失敗" : "失败",
      cancelled: "已取消",
    },
    citations: {
      sources: traditional ? "參考來源" : "参考来源",
      partial: traditional ? "部分來源資訊不完整" : "部分来源信息不完整",
    },
  };
}
