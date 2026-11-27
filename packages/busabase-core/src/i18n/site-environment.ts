import type { CoreLocale } from "./locales";

type SiteEnvironmentMessages = {
  unboundTitle: string;
  unboundDescription: string;
  adoptExisting: string;
  directSource: string;
  spaceSource: string;
  deploymentList: string;
  deploymentEmpty: string;
  deploymentDraft: string;
  directRemovalTitle: string;
  directRemovalDescription: string;
  confirmRemove: string;
  cancel: string;
  secretTypeLocked: string;
  bindingRemovalDescription: string;
  title: string;
  manageRequired: string;
  forbidden: string;
  unauthorized: string;
  addVariable: string;
  removeVariable: string;
  value: string;
  kind: string;
  clearValue: string;
  valuePlaceholder: string;
  newValuePlaceholder: string;
  valueSaved: string;
  valueSavedEmpty: string;
  valueCleared: string;
  directInvalid: string;
  directMissing: string;
  directRuntimeDisabled: string;
  openVault: string;
  openApiKeyVault: string;

  description: string;
  loading: string;
  loadFailed: string;
  retry: string;
  empty: string;
  noSources: string;
  add: string;
  remove: string;
  name: string;
  source: string;
  chooseSource: string;
  secret: string;
  variable: string;
  save: string;
  saving: string;
  saved: string;
  saveFailed: string;
  unsaved: string;
  pendingPreview: string;
  pendingLive: string;
  latestOnPublish: string;
  missing: string;
  runtimeDisabled: string;
  invalid: string;
  limit: string;
};

export const siteEnvironmentMessages: Record<CoreLocale, SiteEnvironmentMessages> = {
  en: {
    unboundTitle: "Saved but not used by this website",
    unboundDescription:
      "These items are saved in this website’s Vault but will not be deployed. Add an existing item without re-entering its value.",
    adoptExisting: "Add to website configuration",
    directSource: "Website Vault",
    spaceSource: "Space Vault",
    deploymentList: "Configuration for the next deployment",
    deploymentEmpty: "The next deployment will contain no custom configuration.",
    deploymentDraft: "Save these changes before preparing a preview or publishing.",
    directRemovalTitle: "Delete this saved item?",
    directRemovalDescription:
      "Saving will delete only the selected items from the website’s Vault and remove them from its next deployment. Other saved items remain. Existing deployments change only after publishing an update.",
    confirmRemove: "Delete item",
    cancel: "Cancel",
    secretTypeLocked:
      "A saved Secret cannot be converted to a Variable. Create a new Variable instead.",
    bindingRemovalDescription: "Removing a binding keeps the original Space Vault item.",

    manageRequired:
      "This website uses Space Vault items. A workspace owner or admin must prepare previews, publish, or roll back. API keys also need manage access.",
    forbidden:
      "You do not have permission to manage this website. Ask a workspace owner or admin for access.",
    unauthorized: "Sign in again to manage this website.",

    addVariable: "Add secret or variable",
    removeVariable: "Delete item",
    value: "Value",
    kind: "Type",
    clearValue: "Clear value",
    valuePlaceholder: "Saved; leave blank to keep",
    newValuePlaceholder: "Enter a value",
    valueSaved: "Saved; leave blank to keep",
    valueSavedEmpty: "Saved empty",
    valueCleared: "Will be saved empty",
    directInvalid:
      "Use a unique uppercase name with letters, digits and underscores. It cannot start with a digit or use a platform-reserved name.",
    directMissing: "This saved value was removed. Enter a replacement or remove this item.",
    directRuntimeDisabled:
      "Runtime access is disabled for this value. Enable it in Vault or remove this item.",
    openVault: "Open Vault",
    openApiKeyVault: "Open API key Vault",

    title: "Secrets & Variables",
    description:
      "Names, types and values for website items stay in sync with the website Vault. Bindings select Space Vault items. Save to include the selected items in the next deployment.",
    loading: "Loading Secrets & Variables…",
    loadFailed: "Could not load Secrets & Variables.",
    retry: "Try again",
    empty: "No Vault bindings yet.",
    noSources: "No runtime-enabled Space Vault items are available.",
    add: "Add binding",
    remove: "Remove binding",
    name: "Name",
    source: "Vault source",
    chooseSource: "Choose a Vault item",
    secret: "Secret",
    variable: "Variable",
    save: "Save",
    saving: "Saving…",
    saved: "Secrets & Variables saved. Deploy the website to apply them.",
    saveFailed: "Could not save. Your changes are still here; try again.",
    unsaved: "Unsaved changes",
    pendingPreview:
      "The preview uses earlier Vault settings. Prepare a new website preview to apply the latest settings.",
    pendingLive:
      "The live website uses earlier Vault settings. Publish an update to apply the latest settings.",
    latestOnPublish:
      "Publishing uses the latest Vault values, even if they changed after the preview.",
    missing: "This Vault item was removed. Choose another item or remove this binding.",
    runtimeDisabled:
      "Runtime access is disabled for this item. Choose another item or remove this binding.",
    invalid:
      "Use a unique name with letters, digits and underscores. It cannot start with a digit or use a platform-reserved name.",
    limit: "You can configure up to 100 items.",
  },
  "zh-CN": {
    unboundTitle: "已保存，但未用于此网站",
    unboundDescription:
      "这些条目已保存在本站保险库，尚未加入部署清单。接入已有项时无需重新填写值。",
    adoptExisting: "加入网站配置",
    directSource: "本站保险库",
    spaceSource: "Space 保险库",
    deploymentList: "下次部署的配置清单",
    deploymentEmpty: "下次部署不包含自定义配置。",
    deploymentDraft: "请先保存这些修改，再创建预览或发布。",
    directRemovalTitle: "删除此已保存条目？",
    directRemovalDescription:
      "保存后，将仅从本站保险库删除所选条目，并从本站下次部署清单移除。其他已保存条目保留；已部署版本在发布更新后才会改变。",
    confirmRemove: "删除条目",
    cancel: "取消",
    secretTypeLocked: "已保存的密钥不能转换为变量，请新建变量。",
    bindingRemovalDescription: "移除绑定会保留 Space 保险库中的原条目。",

    manageRequired:
      "此网站使用了空间保险库条目，预览、发布或回滚须由空间所有者或管理员执行；使用 API Key 时还须具备管理权限。",
    forbidden: "你没有管理此网站的权限，请联系空间所有者或管理员。",
    unauthorized: "请重新登录后管理此网站。",

    addVariable: "添加密钥或变量",
    removeVariable: "删除条目",
    value: "值",
    kind: "类型",
    clearValue: "清空值",
    valuePlaceholder: "已保存，留空保留",
    newValuePlaceholder: "输入值",
    valueSaved: "已保存，留空保留",
    valueSavedEmpty: "已保存为空值",
    valueCleared: "将保存为空值",
    directInvalid: "名称须唯一，只能包含大写字母、数字和下划线，不能以数字开头或使用平台保留名称。",
    directMissing: "此值已被删除，请输入替代值或移除此条目。",
    directRuntimeDisabled: "此值不允许运行时使用，请在保险库中启用，或移除此条目。",
    openVault: "打开保险库",
    openApiKeyVault: "打开 API Key 保险库",

    title: "密钥与变量",
    description:
      "本站条目的名称、类型与值与本站保险库同步。绑定仅从 Space 保险库选择。保存后，选中的条目在下次部署时生效。",
    loading: "正在加载密钥与变量…",
    loadFailed: "密钥与变量加载失败。",
    retry: "重试",
    empty: "尚未绑定保险库内容。",
    noSources: "此空间保险库中没有可供运行时使用的条目。",
    add: "添加绑定",
    remove: "移除绑定",
    name: "名称",
    source: "保险库来源",
    chooseSource: "选择保险库条目",
    secret: "密钥",
    variable: "变量",
    save: "保存",
    saving: "正在保存…",
    saved: "密钥与变量已保存，部署网站后生效。",
    saveFailed: "保存失败，修改已保留，请重试。",
    unsaved: "有未保存的修改",
    pendingPreview: "预览仍在使用之前的保险库配置，请创建新的网站预览以应用最新配置。",
    pendingLive: "线上网站仍在使用之前的保险库配置，发布更新后应用最新配置。",
    latestOnPublish: "发布时使用最新保险库值，即使它们在预览后发生了变化。",
    missing: "此保险库条目已被删除，请选择其他条目或移除此绑定。",
    runtimeDisabled: "此条目不允许运行时使用，请选择其他条目或移除此绑定。",
    invalid: "名称须唯一，只能包含字母、数字和下划线，不能以数字开头或使用平台保留名称。",
    limit: "最多可以配置 100 个条目。",
  },
  "zh-TW": {
    unboundTitle: "已儲存，但未用於此網站",
    unboundDescription:
      "這些項目已儲存在本站保險庫，尚未加入部署清單。加入現有項目時無須重新填寫值。",
    adoptExisting: "加入網站設定",
    directSource: "本站保險庫",
    spaceSource: "Space 保險庫",
    deploymentList: "下次部署的設定清單",
    deploymentEmpty: "下次部署不包含自訂設定。",
    deploymentDraft: "請先儲存這些修改，再建立預覽或發佈。",
    directRemovalTitle: "刪除此已儲存項目？",
    directRemovalDescription:
      "儲存後，僅從本站保險庫刪除所選項目，並從本站下次部署清單移除。其他已儲存項目會保留；已部署版本在發佈更新後才會改變。",
    confirmRemove: "刪除項目",
    cancel: "取消",
    secretTypeLocked: "已儲存的密鑰無法轉換為變數，請新增變數。",
    bindingRemovalDescription: "移除綁定會保留 Space 保險庫中的原項目。",

    manageRequired:
      "此網站使用了空間保險庫項目，預覽、發佈或回復版本須由空間擁有者或管理員執行；使用 API Key 時還須具備管理權限。",
    forbidden: "你沒有管理此網站的權限，請聯絡空間擁有者或管理員。",
    unauthorized: "請重新登入後管理此網站。",

    addVariable: "新增密鑰或變數",
    removeVariable: "刪除項目",
    value: "值",
    kind: "類型",
    clearValue: "清空值",
    valuePlaceholder: "已儲存，留空保留",
    newValuePlaceholder: "輸入值",
    valueSaved: "已儲存，留空保留",
    valueSavedEmpty: "已儲存為空值",
    valueCleared: "將儲存為空值",
    directInvalid: "名稱須唯一，只能包含大寫字母、數字和底線，不能以數字開頭或使用平台保留名稱。",
    directMissing: "此值已被刪除，請輸入替代值或移除此項目。",
    directRuntimeDisabled: "此值不允許執行階段使用，請在保險庫中啟用，或移除此項目。",
    openVault: "開啟保險庫",
    openApiKeyVault: "開啟 API Key 保險庫",

    title: "密鑰與變數",
    description:
      "本站項目的名稱、類型與值會與本站保險庫同步。綁定僅從 Space 保險庫選擇。儲存後，選取的項目會在下次部署時生效。",
    loading: "正在載入密鑰與變數…",
    loadFailed: "密鑰與變數載入失敗。",
    retry: "重試",
    empty: "尚未綁定保險庫內容。",
    noSources: "此空間保險庫沒有可供執行階段使用的項目。",
    add: "新增綁定",
    remove: "移除綁定",
    name: "名稱",
    source: "保險庫來源",
    chooseSource: "選擇保險庫項目",
    secret: "密鑰",
    variable: "變數",
    save: "儲存",
    saving: "正在儲存…",
    saved: "密鑰與變數已儲存，部署網站後生效。",
    saveFailed: "儲存失敗，修改已保留，請重試。",
    unsaved: "有未儲存的修改",
    pendingPreview: "預覽仍使用先前的保險庫設定，請建立新的網站預覽以套用最新設定。",
    pendingLive: "線上網站仍使用先前的保險庫設定，發布更新以套用最新設定。",
    latestOnPublish: "發布時使用最新保險庫值，即使它們在預覽後發生變更。",
    missing: "此保險庫項目已刪除，請選擇其他項目或移除此綁定。",
    runtimeDisabled: "此項目不允許執行階段使用，請選擇其他項目或移除此綁定。",
    invalid: "名稱必須唯一，只能包含英文字母、數字及底線，不能以數字開頭或使用平台保留名稱。",
    limit: "最多可以設定 100 個項目。",
  },
  ja: {
    unboundTitle: "保存済み・このサイトでは未使用",
    unboundDescription:
      "このサイトの Vault に保存されていますが、デプロイには含まれません。値を再入力せずに既存の項目を追加できます。",
    adoptExisting: "サイト設定に追加",
    directSource: "サイトの Vault",
    spaceSource: "Space の Vault",
    deploymentList: "次のデプロイに含まれる設定",
    deploymentEmpty: "次のデプロイにカスタム設定は含まれません。",
    deploymentDraft: "プレビュー作成または公開の前に変更を保存してください。",
    directRemovalTitle: "保存済みの項目を削除しますか？",
    directRemovalDescription:
      "保存すると、選択した項目だけがサイトの Vault と次のデプロイから削除されます。他の保存済み項目は保持されます。既存のデプロイは更新を公開するまで変わりません。",
    confirmRemove: "項目を削除",
    cancel: "キャンセル",
    secretTypeLocked:
      "保存済みの Secret は Variable に変換できません。新しい Variable を作成してください。",
    bindingRemovalDescription: "バインドを解除しても Space の Vault の元の項目は保持されます。",

    manageRequired:
      "このウェブサイトは Space の Vault 項目を使用しています。プレビュー、公開、ロールバックはワークスペースの所有者または管理者が行う必要があります。API キーにも管理権限が必要です。",
    forbidden:
      "このウェブサイトを管理する権限がありません。ワークスペースの所有者または管理者にお問い合わせください。",
    unauthorized: "このウェブサイトを管理するには、再度ログインしてください。",

    addVariable: "Secret または Variable を追加",
    removeVariable: "項目を削除",
    value: "値",
    kind: "種類",
    clearValue: "値を空にする",
    valuePlaceholder: "保存済み・空欄のままで保持",
    newValuePlaceholder: "値を入力",
    valueSaved: "保存済み・空欄のままで保持",
    valueSavedEmpty: "空の値で保存済み",
    valueCleared: "空の値で保存します",
    directInvalid:
      "大文字、数字、アンダースコアで一意の名前を指定してください。数字で始まる名前やプラットフォームの予約名は使用できません。",
    directMissing: "この値は削除されました。新しい値を入力するか、項目を削除してください。",
    directRuntimeDisabled:
      "この値は実行時に使用できません。Vault で有効にするか、項目を削除してください。",
    openVault: "Vault を開く",
    openApiKeyVault: "API キーの Vault を開く",

    title: "Secrets & Variables",
    description:
      "サイトの項目の名前・種類・値はサイトの Vault と同期します。バインド元は Space の Vault のみです。保存すると選択した項目が次のデプロイに含まれます。",
    loading: "Secrets & Variables を読み込み中…",
    loadFailed: "Secrets & Variables を読み込めませんでした。",
    retry: "再試行",
    empty: "保管庫の紐付けはまだありません。",
    noSources: "この Space の Vault に実行時に使用できる項目がありません。",
    add: "紐付けを追加",
    remove: "紐付けを削除",
    name: "名前",
    source: "保管庫の参照元",
    chooseSource: "保管庫の項目を選択",
    secret: "Secret",
    variable: "Variable",
    save: "保存",
    saving: "保存中…",
    saved: "Secrets & Variables を保存しました。ウェブサイトをデプロイすると反映されます。",
    saveFailed: "保存できませんでした。変更は保持されています。再試行してください。",
    unsaved: "未保存の変更",
    pendingPreview:
      "プレビューは以前の保管庫設定を使用しています。サイトプレビューを作成し直して最新の設定を反映してください。",
    pendingLive:
      "公開サイトは以前の保管庫設定を使用しています。更新を公開して最新の設定を反映してください。",
    latestOnPublish: "公開時には、プレビュー後に変更されていても最新の保管庫の値を使用します。",
    missing: "この保管庫の項目は削除されました。別の項目を選ぶか、紐付けを削除してください。",
    runtimeDisabled:
      "この項目は実行時の使用が許可されていません。別の項目を選ぶか、紐付けを削除してください。",
    invalid:
      "名前は重複不可で、英数字とアンダースコアのみ使用できます。数字で始まる名前やプラットフォームの予約名は使用できません。",
    limit: "最大 100 個の項目を設定できます。",
  },
  de: {
    unboundTitle: "Gespeichert, aber auf dieser Website ungenutzt",
    unboundDescription:
      "Diese Einträge sind im Vault dieser Website gespeichert, werden aber nicht bereitgestellt. Füge einen vorhandenen Eintrag hinzu, ohne seinen Wert erneut einzugeben.",
    adoptExisting: "Zur Website-Konfiguration hinzufügen",
    directSource: "Website-Vault",
    spaceSource: "Space-Vault",
    deploymentList: "Konfiguration der nächsten Bereitstellung",
    deploymentEmpty: "Die nächste Bereitstellung enthält keine benutzerdefinierte Konfiguration.",
    deploymentDraft:
      "Speichere die Änderungen vor dem Erstellen einer Vorschau oder der Veröffentlichung.",
    directRemovalTitle: "Diesen gespeicherten Eintrag löschen?",
    directRemovalDescription:
      "Beim Speichern werden nur die ausgewählten Einträge aus dem Website-Vault und der nächsten Bereitstellung entfernt. Andere gespeicherte Einträge bleiben erhalten. Bestehende Bereitstellungen ändern sich erst nach Veröffentlichung eines Updates.",
    confirmRemove: "Eintrag löschen",
    cancel: "Abbrechen",
    secretTypeLocked:
      "Ein gespeichertes Secret kann nicht in eine Variable umgewandelt werden. Erstelle eine neue Variable.",
    bindingRemovalDescription:
      "Beim Entfernen einer Bindung bleibt der ursprüngliche Eintrag im Space-Vault erhalten.",

    manageRequired:
      "Diese Website verwendet Einträge aus dem Space-Vault. Vorschauen, Veröffentlichung und Wiederherstellung erfordern einen Workspace-Inhaber oder Administrator. API-Schlüssel benötigen zusätzlich Verwaltungszugriff.",
    forbidden:
      "Du darfst diese Website nicht verwalten. Bitte einen Workspace-Inhaber oder Administrator um Zugriff.",
    unauthorized: "Melde dich erneut an, um diese Website zu verwalten.",

    addVariable: "Secret oder Variable hinzufügen",
    removeVariable: "Eintrag entfernen",
    value: "Wert",
    kind: "Typ",
    clearValue: "Wert leeren",
    valuePlaceholder: "Gespeichert; leer lassen zum Beibehalten",
    newValuePlaceholder: "Wert eingeben",
    valueSaved: "Gespeichert; leer lassen zum Beibehalten",
    valueSavedEmpty: "Leer gespeichert",
    valueCleared: "Wird leer gespeichert",
    directInvalid:
      "Verwende einen eindeutigen Namen aus Großbuchstaben, Ziffern und Unterstrichen. Er darf nicht mit einer Ziffer beginnen oder von der Plattform reserviert sein.",
    directMissing: "Dieser Wert wurde entfernt. Gib einen Ersatz ein oder entferne den Eintrag.",
    directRuntimeDisabled:
      "Der Laufzeitzugriff ist deaktiviert. Aktiviere ihn im Vault oder entferne den Eintrag.",
    openVault: "Vault öffnen",
    openApiKeyVault: "API-Schlüssel-Vault öffnen",

    title: "Secrets & Variablen",
    description:
      "Namen, Typen und Werte der Website-Einträge bleiben mit dem Website-Vault synchron. Bindungen wählen Einträge aus dem Space-Vault. Speichere die Auswahl für die nächste Bereitstellung.",
    loading: "Secrets & Variablen werden geladen…",
    loadFailed: "Secrets & Variablen konnten nicht geladen werden.",
    retry: "Erneut versuchen",
    empty: "Noch keine Vault-Verknüpfungen.",
    noSources: "Es sind keine zur Laufzeit nutzbaren Einträge im Space-Vault verfügbar.",
    add: "Verknüpfung hinzufügen",
    remove: "Verknüpfung entfernen",
    name: "Name",
    source: "Vault-Quelle",
    chooseSource: "Vault-Eintrag auswählen",
    secret: "Secret",
    variable: "Variable",
    save: "Speichern",
    saving: "Wird gespeichert…",
    saved: "Secrets & Variablen gespeichert. Stelle die Website bereit, um sie anzuwenden.",
    saveFailed:
      "Speichern fehlgeschlagen. Ihre Änderungen bleiben erhalten. Versuchen Sie es erneut.",
    unsaved: "Ungespeicherte Änderungen",
    pendingPreview:
      "Die Vorschau verwendet frühere Vault-Einstellungen. Erstellen Sie eine neue Website-Vorschau, um die neuesten Einstellungen anzuwenden.",
    pendingLive:
      "Die öffentliche Website verwendet frühere Vault-Einstellungen. Veröffentlichen Sie ein Update, um die neuesten Einstellungen anzuwenden.",
    latestOnPublish:
      "Beim Veröffentlichen werden die neuesten Vault-Werte verwendet, auch wenn sie sich nach der Vorschau geändert haben.",
    missing:
      "Dieser Vault-Eintrag wurde entfernt. Wählen Sie einen anderen oder entfernen Sie die Verknüpfung.",
    runtimeDisabled:
      "Der Laufzeitzugriff ist für diesen Eintrag deaktiviert. Wählen Sie einen anderen oder entfernen Sie die Verknüpfung.",
    invalid:
      "Verwenden Sie einen eindeutigen Namen aus Buchstaben, Ziffern und Unterstrichen. Er darf nicht mit einer Ziffer beginnen oder einen reservierten Plattformnamen verwenden.",
    limit: "Du kannst bis zu 100 Einträge konfigurieren.",
  },
  es: {
    unboundTitle: "Guardado, sin usar en este sitio",
    unboundDescription:
      "Estos elementos están guardados en el Vault de este sitio, pero no se desplegarán. Añade un elemento existente sin volver a introducir su valor.",
    adoptExisting: "Añadir a la configuración del sitio",
    directSource: "Vault del sitio",
    spaceSource: "Vault del Space",
    deploymentList: "Configuración del próximo despliegue",
    deploymentEmpty: "El próximo despliegue no incluirá configuración personalizada.",
    deploymentDraft: "Guarda los cambios antes de preparar una vista previa o publicar.",
    directRemovalTitle: "¿Eliminar este elemento guardado?",
    directRemovalDescription:
      "Al guardar, solo se eliminarán los elementos seleccionados del Vault del sitio y de su próximo despliegue. Los demás elementos guardados se conservarán. Los despliegues actuales cambiarán al publicar una actualización.",
    confirmRemove: "Eliminar elemento",
    cancel: "Cancelar",
    secretTypeLocked:
      "Un Secret guardado no puede convertirse en Variable. Crea una Variable nueva.",
    bindingRemovalDescription:
      "Eliminar un vínculo conserva el elemento original del Vault del Space.",

    manageRequired:
      "Este sitio usa elementos del Vault del Space. Solo un propietario o administrador puede preparar vistas previas, publicar o restaurar. Las claves API también necesitan acceso de gestión.",
    forbidden:
      "No tienes permiso para gestionar este sitio. Solicita acceso al propietario o administrador del espacio.",
    unauthorized: "Inicia sesión de nuevo para gestionar este sitio.",

    addVariable: "Añadir secreto o variable",
    removeVariable: "Quitar elemento",
    value: "Valor",
    kind: "Tipo",
    clearValue: "Vaciar valor",
    valuePlaceholder: "Guardado; deja vacío para conservar",
    newValuePlaceholder: "Introduce un valor",
    valueSaved: "Guardado; deja vacío para conservar",
    valueSavedEmpty: "Guardado vacío",
    valueCleared: "Se guardará vacío",
    directInvalid:
      "Usa un nombre único con mayúsculas, números y guiones bajos. No puede empezar con un número ni estar reservado por la plataforma.",
    directMissing: "Este valor se eliminó. Introduce otro o quita el elemento.",
    directRuntimeDisabled:
      "El acceso en ejecución está desactivado. Actívalo en Vault o quita el elemento.",
    openVault: "Abrir Vault",
    openApiKeyVault: "Abrir Vault de la clave API",

    title: "Secretos y Variables",
    description:
      "Los nombres, tipos y valores del sitio se sincronizan con su Vault. Los vínculos seleccionan elementos del Vault del Space. Guarda la selección para incluirla en el próximo despliegue.",
    loading: "Cargando Secretos y Variables…",
    loadFailed: "No se pudieron cargar los Secretos y Variables.",
    retry: "Reintentar",
    empty: "Todavía no hay vínculos al Vault.",
    noSources: "No hay elementos de Vault del Space disponibles para la ejecución.",
    add: "Añadir vínculo",
    remove: "Eliminar vínculo",
    name: "Nombre",
    source: "Origen del Vault",
    chooseSource: "Elegir un elemento del Vault",
    secret: "Secreto",
    variable: "Variable",
    save: "Guardar",
    saving: "Guardando…",
    saved: "Secretos y Variables guardados. Despliega el sitio para aplicarlos.",
    saveFailed: "No se pudo guardar. Tus cambios se conservan; inténtalo de nuevo.",
    unsaved: "Cambios sin guardar",
    pendingPreview:
      "La vista previa usa una configuración anterior del Vault. Prepara una nueva vista previa del sitio para aplicar la última configuración.",
    pendingLive:
      "El sitio publicado usa una configuración anterior del Vault. Publica una actualización para aplicar la última configuración.",
    latestOnPublish:
      "Al publicar se usan los últimos valores del Vault, aunque hayan cambiado después de la vista previa.",
    missing: "Este elemento del Vault se eliminó. Elige otro o elimina el vínculo.",
    runtimeDisabled:
      "Este elemento no permite acceso en ejecución. Elige otro o elimina el vínculo.",
    invalid:
      "Usa un nombre único con letras, números y guiones bajos. No puede comenzar con un número ni ser un nombre reservado de la plataforma.",
    limit: "Puedes configurar hasta 100 elementos.",
  },
  fr: {
    unboundTitle: "Enregistré, mais inutilisé par ce site",
    unboundDescription:
      "Ces éléments sont enregistrés dans le Vault de ce site, mais ne seront pas déployés. Ajoutez un élément existant sans ressaisir sa valeur.",
    adoptExisting: "Ajouter à la configuration du site",
    directSource: "Vault du site",
    spaceSource: "Vault du Space",
    deploymentList: "Configuration du prochain déploiement",
    deploymentEmpty: "Le prochain déploiement ne contiendra aucune configuration personnalisée.",
    deploymentDraft: "Enregistrez les modifications avant de préparer un aperçu ou de publier.",
    directRemovalTitle: "Supprimer cet élément enregistré ?",
    directRemovalDescription:
      "Après enregistrement, seuls les éléments sélectionnés seront supprimés du Vault du site et de son prochain déploiement. Les autres éléments enregistrés seront conservés. Les déploiements actuels changent uniquement après publication d’une mise à jour.",
    confirmRemove: "Supprimer l’élément",
    cancel: "Annuler",
    secretTypeLocked:
      "Un Secret enregistré ne peut pas devenir une Variable. Créez une nouvelle Variable.",
    bindingRemovalDescription:
      "Supprimer une liaison conserve l’élément d’origine du Vault du Space.",

    manageRequired:
      "Ce site utilise des éléments du Vault de l’espace. Un propriétaire ou administrateur doit préparer les aperçus, publier ou restaurer le site. Les clés API doivent aussi disposer d’un accès de gestion.",
    forbidden:
      "Vous n’avez pas la permission de gérer ce site. Demandez l’accès à un propriétaire ou administrateur de l’espace.",
    unauthorized: "Reconnectez-vous pour gérer ce site.",

    addVariable: "Ajouter un secret ou une variable",
    removeVariable: "Supprimer l’élément",
    value: "Valeur",
    kind: "Type",
    clearValue: "Vider la valeur",
    valuePlaceholder: "Enregistrée ; laisser vide pour conserver",
    newValuePlaceholder: "Saisissez une valeur",
    valueSaved: "Enregistrée ; laisser vide pour conserver",
    valueSavedEmpty: "Enregistrée vide",
    valueCleared: "Sera enregistrée vide",
    directInvalid:
      "Utilisez un nom unique en majuscules, chiffres et traits de soulignement. Il ne peut pas commencer par un chiffre ni être réservé par la plateforme.",
    directMissing:
      "Cette valeur a été supprimée. Saisissez une nouvelle valeur ou supprimez l’élément.",
    directRuntimeDisabled:
      "L’accès à l’exécution est désactivé. Activez-le dans Vault ou supprimez l’élément.",
    openVault: "Ouvrir Vault",
    openApiKeyVault: "Ouvrir le Vault de la clé API",

    title: "Secrets et Variables",
    description:
      "Les noms, types et valeurs du site sont synchronisés avec son Vault. Les liaisons choisissent les éléments du Vault du Space. Enregistrez la sélection pour le prochain déploiement.",
    loading: "Chargement des Secrets et Variables…",
    loadFailed: "Impossible de charger les Secrets et Variables.",
    retry: "Réessayer",
    empty: "Aucune association au coffre pour le moment.",
    noSources: "Aucun élément du Vault de cet espace n’est disponible à l’exécution.",
    add: "Ajouter une association",
    remove: "Supprimer l’association",
    name: "Nom",
    source: "Source du coffre",
    chooseSource: "Choisir un élément du coffre",
    secret: "Secret",
    variable: "Variable",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Secrets et Variables enregistrés. Déployez le site pour les appliquer.",
    saveFailed: "Échec de l’enregistrement. Vos modifications sont conservées ; réessayez.",
    unsaved: "Modifications non enregistrées",
    pendingPreview:
      "L’aperçu utilise une ancienne configuration du coffre. Préparez un nouvel aperçu du site pour appliquer la dernière configuration.",
    pendingLive:
      "Le site publié utilise une ancienne configuration du coffre. Publiez une mise à jour pour appliquer la dernière configuration.",
    latestOnPublish:
      "La publication utilise les dernières valeurs du coffre, même si elles ont changé après l’aperçu.",
    missing:
      "Cet élément du coffre a été supprimé. Choisissez-en un autre ou supprimez l’association.",
    runtimeDisabled:
      "L’accès à l’exécution est désactivé pour cet élément. Choisissez-en un autre ou supprimez l’association.",
    invalid:
      "Utilisez un nom unique composé de lettres, de chiffres et de traits de soulignement. Il ne peut pas commencer par un chiffre ni être réservé à la plateforme.",
    limit: "Vous pouvez configurer jusqu’à 100 éléments.",
  },
  ko: {
    unboundTitle: "저장되었지만 이 웹사이트에서 사용하지 않음",
    unboundDescription:
      "이 웹사이트의 Vault에 저장되었지만 배포에는 포함되지 않습니다. 값을 다시 입력하지 않고 기존 항목을 추가하세요.",
    adoptExisting: "웹사이트 설정에 추가",
    directSource: "웹사이트 Vault",
    spaceSource: "Space Vault",
    deploymentList: "다음 배포에 포함될 설정",
    deploymentEmpty: "다음 배포에는 사용자 지정 설정이 포함되지 않습니다.",
    deploymentDraft: "미리보기를 만들거나 게시하기 전에 변경 사항을 저장하세요.",
    directRemovalTitle: "저장된 항목을 삭제할까요?",
    directRemovalDescription:
      "저장하면 선택한 항목만 웹사이트 Vault와 다음 배포에서 삭제됩니다. 다른 저장된 항목은 유지됩니다. 기존 배포는 업데이트를 게시한 후에만 변경됩니다.",
    confirmRemove: "항목 삭제",
    cancel: "취소",
    secretTypeLocked: "저장된 Secret은 Variable로 변환할 수 없습니다. 새 Variable을 만드세요.",
    bindingRemovalDescription: "바인딩을 제거해도 Space Vault의 원본 항목은 유지됩니다.",

    manageRequired:
      "이 웹사이트는 스페이스 Vault 항목을 사용합니다. 미리보기 준비, 게시 또는 롤백은 워크스페이스 소유자나 관리자가 실행해야 합니다. API 키에도 관리 권한이 필요합니다.",
    forbidden:
      "이 웹사이트를 관리할 권한이 없습니다. 워크스페이스 소유자나 관리자에게 접근 권한을 요청하세요.",
    unauthorized: "이 웹사이트를 관리하려면 다시 로그인하세요.",

    addVariable: "시크릿 또는 변수 추가",
    removeVariable: "항목 삭제",
    value: "값",
    kind: "유형",
    clearValue: "값 비우기",
    valuePlaceholder: "저장됨; 비워 두면 유지",
    newValuePlaceholder: "값을 입력하세요",
    valueSaved: "저장됨; 비워 두면 유지",
    valueSavedEmpty: "빈 값으로 저장됨",
    valueCleared: "빈 값으로 저장됩니다",
    directInvalid:
      "대문자, 숫자, 밑줄로 고유한 이름을 만드세요. 숫자로 시작하거나 플랫폼 예약 이름을 사용할 수 없습니다.",
    directMissing: "이 값이 삭제되었습니다. 새 값을 입력하거나 항목을 삭제하세요.",
    directRuntimeDisabled:
      "런타임 접근이 비활성화되어 있습니다. Vault에서 활성화하거나 항목을 삭제하세요.",
    openVault: "Vault 열기",
    openApiKeyVault: "API 키 Vault 열기",

    title: "시크릿 및 변수",
    description:
      "웹사이트 항목의 이름, 유형, 값은 웹사이트 Vault와 동기화됩니다. 바인딩은 Space Vault 항목만 선택합니다. 저장하면 선택한 항목이 다음 배포에 포함됩니다.",
    loading: "시크릿 및 변수를 불러오는 중…",
    loadFailed: "시크릿 및 변수를 불러오지 못했습니다.",
    retry: "다시 시도",
    empty: "아직 Vault 연결이 없습니다.",
    noSources: "이 스페이스 Vault에 런타임에서 사용할 수 있는 항목이 없습니다.",
    add: "연결 추가",
    remove: "연결 삭제",
    name: "이름",
    source: "Vault 원본",
    chooseSource: "Vault 항목 선택",
    secret: "시크릿",
    variable: "변수",
    save: "저장",
    saving: "저장 중…",
    saved: "시크릿 및 변수를 저장했습니다. 웹사이트를 배포하면 적용됩니다.",
    saveFailed: "저장하지 못했습니다. 변경 내용은 유지됩니다. 다시 시도하세요.",
    unsaved: "저장하지 않은 변경 사항",
    pendingPreview:
      "미리보기에서 이전 Vault 설정을 사용하고 있습니다. 새로운 웹사이트 미리보기를 준비하여 최신 설정을 적용하세요.",
    pendingLive:
      "게시된 웹사이트에서 이전 Vault 설정을 사용하고 있습니다. 업데이트를 게시하여 최신 설정을 적용하세요.",
    latestOnPublish: "게시할 때는 미리보기 이후에 변경되었더라도 최신 Vault 값을 사용합니다.",
    missing: "이 Vault 항목이 삭제되었습니다. 다른 항목을 선택하거나 연결을 삭제하세요.",
    runtimeDisabled:
      "이 항목의 런타임 사용이 허용되지 않습니다. 다른 항목을 선택하거나 연결을 삭제하세요.",
    invalid:
      "영문, 숫자, 밑줄로 된 고유한 이름을 사용하세요. 숫자로 시작하거나 플랫폼 예약 이름을 사용할 수 없습니다.",
    limit: "최대 100개의 항목을 설정할 수 있습니다.",
  },
  pt: {
    unboundTitle: "Guardado, mas não utilizado neste site",
    unboundDescription:
      "Estes itens estão guardados no Vault deste site, mas não serão incluídos na implantação. Adicione um item existente sem introduzir novamente o valor.",
    adoptExisting: "Adicionar à configuração do site",
    directSource: "Vault do site",
    spaceSource: "Vault do Space",
    deploymentList: "Configuração da próxima implantação",
    deploymentEmpty: "A próxima implantação não incluirá configuração personalizada.",
    deploymentDraft: "Guarde as alterações antes de preparar uma prévia ou publicar.",
    directRemovalTitle: "Eliminar este item guardado?",
    directRemovalDescription:
      "Ao guardar, apenas os itens selecionados serão eliminados do Vault do site e da próxima implantação. Os restantes itens guardados serão mantidos. As implantações atuais só mudam após publicar uma atualização.",
    confirmRemove: "Eliminar item",
    cancel: "Cancelar",
    secretTypeLocked:
      "Um Secret guardado não pode ser convertido em Variable. Crie uma nova Variable.",
    bindingRemovalDescription: "Remover uma associação mantém o item original no Vault do Space.",

    manageRequired:
      "Este site usa itens do Vault do espaço. As pré-visualizações, a publicação e a restauração exigem um proprietário ou administrador. As chaves API também precisam de acesso de gestão.",
    forbidden:
      "Não tem permissão para gerir este site. Peça acesso ao proprietário ou administrador do espaço.",
    unauthorized: "Inicie sessão novamente para gerir este site.",

    addVariable: "Adicionar segredo ou variável",
    removeVariable: "Remover item",
    value: "Valor",
    kind: "Tipo",
    clearValue: "Esvaziar valor",
    valuePlaceholder: "Guardado; deixe vazio para manter",
    newValuePlaceholder: "Introduza um valor",
    valueSaved: "Guardado; deixe vazio para manter",
    valueSavedEmpty: "Guardado vazio",
    valueCleared: "Será guardado vazio",
    directInvalid:
      "Use um nome único com maiúsculas, números e sublinhados. Não pode começar por um número nem ser reservado pela plataforma.",
    directMissing: "Este valor foi removido. Digite outro ou remova o item.",
    directRuntimeDisabled:
      "O acesso em execução está desativado. Ative-o no Vault ou remova o item.",
    openVault: "Abrir Vault",
    openApiKeyVault: "Abrir Vault da chave API",

    title: "Segredos e Variáveis",
    description:
      "Os nomes, tipos e valores do site são sincronizados com o seu Vault. As associações selecionam itens do Vault do Space. Guarde a seleção para a próxima implantação.",
    loading: "Carregando Segredos e Variáveis…",
    loadFailed: "Não foi possível carregar Segredos e Variáveis.",
    retry: "Tentar novamente",
    empty: "Ainda não há vínculos ao Vault.",
    noSources: "Não há itens do Vault deste espaço disponíveis em execução.",
    add: "Adicionar vínculo",
    remove: "Remover vínculo",
    name: "Nome",
    source: "Origem do Vault",
    chooseSource: "Escolher um item do Vault",
    secret: "Segredo",
    variable: "Variável",
    save: "Salvar",
    saving: "Salvando…",
    saved: "Segredos e Variáveis salvos. Implante o site para aplicá-los.",
    saveFailed: "Não foi possível salvar. Suas alterações foram mantidas; tente novamente.",
    unsaved: "Alterações não salvas",
    pendingPreview:
      "A prévia usa configurações anteriores do Vault. Prepare uma nova prévia do site para aplicar as configurações mais recentes.",
    pendingLive:
      "O site publicado usa configurações anteriores do Vault. Publique uma atualização para aplicar as configurações mais recentes.",
    latestOnPublish:
      "A publicação usa os valores mais recentes do Vault, mesmo que tenham mudado após a prévia.",
    missing: "Este item do Vault foi removido. Escolha outro ou remova o vínculo.",
    runtimeDisabled:
      "O acesso em execução está desativado para este item. Escolha outro ou remova o vínculo.",
    invalid:
      "Use um nome único com letras, números e sublinhados. Não pode começar com um número nem usar um nome reservado da plataforma.",
    limit: "Você pode configurar até 100 itens.",
  },
  vi: {
    unboundTitle: "Đã lưu nhưng chưa dùng cho website này",
    unboundDescription:
      "Các mục này đã được lưu trong Vault của website nhưng chưa được triển khai. Thêm mục có sẵn mà không cần nhập lại giá trị.",
    adoptExisting: "Thêm vào cấu hình website",
    directSource: "Vault của website",
    spaceSource: "Vault của Space",
    deploymentList: "Cấu hình cho lần triển khai tiếp theo",
    deploymentEmpty: "Lần triển khai tiếp theo không có cấu hình tùy chỉnh.",
    deploymentDraft: "Lưu thay đổi trước khi tạo bản xem trước hoặc xuất bản.",
    directRemovalTitle: "Xóa mục đã lưu này?",
    directRemovalDescription:
      "Khi lưu, chỉ các mục đã chọn bị xóa khỏi Vault của website và lần triển khai tiếp theo. Các mục đã lưu khác được giữ lại. Bản triển khai hiện tại chỉ thay đổi sau khi xuất bản bản cập nhật.",
    confirmRemove: "Xóa mục",
    cancel: "Hủy",
    secretTypeLocked: "Không thể chuyển Secret đã lưu thành Variable. Hãy tạo Variable mới.",
    bindingRemovalDescription: "Gỡ liên kết vẫn giữ mục gốc trong Vault của Space.",

    manageRequired:
      "Trang web này dùng mục Vault của Space. Chủ sở hữu hoặc quản trị viên không gian làm việc phải chuẩn bị bản xem trước, xuất bản hoặc khôi phục. Khóa API cũng cần quyền quản lý.",
    forbidden:
      "Bạn không có quyền quản lý trang web này. Hãy liên hệ chủ sở hữu hoặc quản trị viên không gian làm việc.",
    unauthorized: "Đăng nhập lại để quản lý trang web này.",

    addVariable: "Thêm bí mật hoặc biến",
    removeVariable: "Xóa mục",
    value: "Giá trị",
    kind: "Loại",
    clearValue: "Xóa giá trị",
    valuePlaceholder: "Đã lưu; để trống để giữ nguyên",
    newValuePlaceholder: "Nhập giá trị",
    valueSaved: "Đã lưu; để trống để giữ nguyên",
    valueSavedEmpty: "Đã lưu giá trị rỗng",
    valueCleared: "Sẽ lưu giá trị rỗng",
    directInvalid:
      "Dùng tên duy nhất gồm chữ hoa, chữ số và dấu gạch dưới. Không bắt đầu bằng chữ số hoặc dùng tên dành riêng của nền tảng.",
    directMissing: "Giá trị này đã bị xóa. Nhập giá trị thay thế hoặc xóa mục.",
    directRuntimeDisabled: "Quyền truy cập khi chạy đã tắt. Bật trong Vault hoặc xóa mục.",
    openVault: "Mở Vault",
    openApiKeyVault: "Mở Vault của khóa API",

    title: "Bí mật và Biến",
    description:
      "Tên, loại và giá trị của website được đồng bộ với Vault của website. Liên kết chỉ chọn mục trong Vault của Space. Lưu lựa chọn để áp dụng cho lần triển khai tiếp theo.",
    loading: "Đang tải Bí mật và Biến…",
    loadFailed: "Không thể tải Bí mật và Biến.",
    retry: "Thử lại",
    empty: "Chưa có liên kết Vault.",
    noSources: "Không có mục Vault nào của Space có thể dùng khi chạy.",
    add: "Thêm liên kết",
    remove: "Xóa liên kết",
    name: "Tên",
    source: "Nguồn Vault",
    chooseSource: "Chọn mục Vault",
    secret: "Bí mật",
    variable: "Biến",
    save: "Lưu",
    saving: "Đang lưu…",
    saved: "Đã lưu Bí mật và Biến. Triển khai trang web để áp dụng.",
    saveFailed: "Không thể lưu. Thay đổi của bạn vẫn được giữ lại; hãy thử lại.",
    unsaved: "Thay đổi chưa lưu",
    pendingPreview:
      "Bản xem trước đang dùng cài đặt Vault cũ. Chuẩn bị bản xem trước trang web mới để áp dụng cài đặt mới nhất.",
    pendingLive:
      "Trang web đã xuất bản đang dùng cài đặt Vault cũ. Xuất bản bản cập nhật để áp dụng cài đặt mới nhất.",
    latestOnPublish:
      "Khi xuất bản sẽ dùng giá trị Vault mới nhất, kể cả khi chúng đã thay đổi sau lần xem trước.",
    missing: "Mục Vault này đã bị xóa. Chọn mục khác hoặc xóa liên kết.",
    runtimeDisabled: "Mục này không cho phép sử dụng khi chạy. Chọn mục khác hoặc xóa liên kết.",
    invalid:
      "Dùng tên duy nhất gồm chữ cái, chữ số và dấu gạch dưới. Không bắt đầu bằng chữ số hoặc dùng tên dành riêng cho nền tảng.",
    limit: "Bạn có thể cấu hình tối đa 100 mục.",
  },
};
