import type { CoreLocale } from "./locales";

export const relationFieldMessages: Record<CoreLocale, { title: string }> = {
  en: { title: 'Link records from "{name}"' },
  "zh-CN": { title: "关联表「{name}」的记录" },
  "zh-TW": { title: "關聯表「{name}」的記錄" },
  ja: { title: "「{name}」のレコードをリンク" },
  ko: { title: '"{name}"의 레코드 연결' },
  es: { title: "Vincular registros de «{name}»" },
  pt: { title: 'Vincular registros de "{name}"' },
  vi: { title: 'Liên kết bản ghi từ "{name}"' },
  fr: { title: "Lier des enregistrements de « {name} »" },
  de: { title: "Datensätze aus „{name}“ verknüpfen" },
};
