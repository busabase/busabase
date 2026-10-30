import type { CoreLocale } from "./locales";

const en = {
  automatic: "Automatically show new fields",
  automaticHint: "Keep explicitly hidden fields hidden. New fields appear in this view.",
  manualHint: "New fields stay hidden unless added from this view.",
  created: "Created and shown in the current view",
  pending: "Field submitted for review. It will appear after approval and merge.",
};

type FieldVisibilityMessages = { [K in keyof typeof en]: string };

export const fieldVisibilityMessages: Record<CoreLocale, FieldVisibilityMessages> = {
  en,
  "zh-CN": {
    automatic: "自动显示新增字段",
    automaticHint: "保留已隐藏字段的设置，后续新增字段会自动显示在此视图中。",
    manualHint: "后续新增字段默认隐藏，在此视图中创建的字段除外。",
    created: "已创建并显示在当前视图",
    pending: "字段已提交审核，审核并合并后将显示。",
  },
  "zh-TW": {
    automatic: "自動顯示新增欄位",
    automaticHint: "保留已隱藏欄位的設定，後續新增欄位會自動顯示於此檢視。",
    manualHint: "後續新增欄位預設隱藏，在此檢視建立的欄位除外。",
    created: "已建立並顯示於目前檢視",
    pending: "欄位已提交審核，審核並合併後將顯示。",
  },
  ja: {
    automatic: "新しいフィールドを自動表示",
    automaticHint: "非表示のフィールドはそのまま維持し、新しいフィールドを表示します。",
    manualHint: "このビューで作成したフィールド以外は、自動表示しません。",
    created: "作成して現在のビューに表示しました",
    pending: "フィールドをレビューに提出しました。承認とマージ後に表示されます。",
  },
  ko: {
    automatic: "새 필드 자동 표시",
    automaticHint: "숨긴 필드는 유지하고 새 필드는 이 보기에 자동으로 표시합니다.",
    manualHint: "이 보기에서 만든 필드를 제외하고 새 필드는 숨겨집니다.",
    created: "생성하여 현재 보기에 표시했습니다",
    pending: "필드 검토를 요청했습니다. 승인 및 병합 후 표시됩니다.",
  },
  es: {
    automatic: "Mostrar campos nuevos automáticamente",
    automaticHint: "Los campos ocultos se mantienen ocultos. Los nuevos aparecen en esta vista.",
    manualHint: "Los campos nuevos se ocultan, salvo los creados desde esta vista.",
    created: "Creado y visible en la vista actual",
    pending: "Campo enviado a revisión. Aparecerá tras aprobarlo y fusionarlo.",
  },
  pt: {
    automatic: "Mostrar novos campos automaticamente",
    automaticHint:
      "Os campos ocultos permanecem ocultos. Novos campos aparecem nesta visualização.",
    manualHint: "Novos campos ficam ocultos, exceto os criados nesta visualização.",
    created: "Criado e exibido na visualização atual",
    pending: "Campo enviado para revisão. Ele aparecerá após a aprovação e integração.",
  },
  vi: {
    automatic: "Tự động hiển thị trường mới",
    automaticHint: "Giữ nguyên các trường đã ẩn. Trường mới sẽ hiển thị trong chế độ xem này.",
    manualHint: "Trường mới sẽ bị ẩn, trừ khi được tạo từ chế độ xem này.",
    created: "Đã tạo và hiển thị trong chế độ xem hiện tại",
    pending: "Đã gửi trường để duyệt. Trường sẽ hiển thị sau khi được phê duyệt và hợp nhất.",
  },
  fr: {
    automatic: "Afficher automatiquement les nouveaux champs",
    automaticHint: "Les champs masqués le restent. Les nouveaux apparaissent dans cette vue.",
    manualHint: "Les nouveaux champs restent masqués, sauf ceux créés depuis cette vue.",
    created: "Créé et affiché dans la vue actuelle",
    pending: "Champ soumis à validation. Il apparaîtra après approbation et fusion.",
  },
  de: {
    automatic: "Neue Felder automatisch anzeigen",
    automaticHint:
      "Ausgeblendete Felder bleiben verborgen. Neue Felder erscheinen in dieser Ansicht.",
    manualHint: "Neue Felder bleiben verborgen, außer sie werden in dieser Ansicht erstellt.",
    created: "Erstellt und in der aktuellen Ansicht angezeigt",
    pending: "Feld zur Prüfung eingereicht. Es erscheint nach Freigabe und Zusammenführung.",
  },
};
