import type { CoreLocale } from "./locales";

const en = {
  gridHelp:
    "Arrow keys and Tab move between cells. Press Enter or start typing to edit, Esc to cancel, Space to open the record.",
  saving: "Saving…",
  pending: "Waiting for review",
  pendingTitle:
    "Proposed: {value}. Waiting for review — the cell keeps its current value until it is approved.",
  submittedForReview:
    "Your access to this Base is Change request, so your edit to {field} was submitted for review and will take effect once approved.",
  savedAsChangeRequest:
    "Your edit to {field} was saved as a change request. It takes effect once the request is merged.",
  saveFailed: "Couldn't save {field}: {error} The cell was put back.",
  readOnlyCell: "{field} can't be edited in the table. Press Enter to open the record.",
  errorRequired: "{field} is required.",
  errorNumber: "Enter a number, like 129 or 129.50.",
  errorEmail: "Enter an email address, like name@example.com.",
  errorUrl: "Enter a full link starting with https://.",
  errorPhone: "Enter a phone number.",
  errorDate: "Enter a valid date.",
  errorChoice: "Pick one of the options.",
  errorInvalid: "This value can't be saved.",
  empty: "Empty",
};

export type InlineCellEditMessages = { [K in keyof typeof en]: string };

/** Kept together so in-cell editing copy is complete in every shared-dashboard locale. */
export const inlineCellEditMessages: Record<CoreLocale, InlineCellEditMessages> = {
  en,
  "zh-CN": {
    gridHelp:
      "方向键和 Tab 在单元格之间移动。按 Enter 或直接输入开始编辑，Esc 取消，空格打开记录。",
    saving: "正在保存…",
    pending: "等待审批",
    pendingTitle: "提议的值：{value}。等待审批，通过前单元格仍显示当前值。",
    submittedForReview:
      "你在此 Base 的权限为 Change request，你对「{field}」的修改已提交审批，通过后生效。",
    savedAsChangeRequest: "你对「{field}」的修改已保存为变更请求，合并后生效。",
    saveFailed: "「{field}」没有保存成功：{error} 单元格已恢复原值。",
    readOnlyCell: "「{field}」不能在表格里直接编辑，按 Enter 打开记录。",
    errorRequired: "「{field}」为必填。",
    errorNumber: "请输入数字，例如 129 或 129.50。",
    errorEmail: "请输入邮箱地址，例如 name@example.com。",
    errorUrl: "请输入以 https:// 开头的完整链接。",
    errorPhone: "请输入电话号码。",
    errorDate: "请输入有效日期。",
    errorChoice: "请从选项中选择一个。",
    errorInvalid: "这个值无法保存。",
    empty: "空",
  },
  "zh-TW": {
    gridHelp:
      "方向鍵和 Tab 在儲存格之間移動。按 Enter 或直接輸入開始編輯，Esc 取消，空白鍵開啟記錄。",
    saving: "正在儲存…",
    pending: "等待審核",
    pendingTitle: "提議的值：{value}。等待審核，通過前儲存格仍顯示目前的值。",
    submittedForReview:
      "你在此 Base 的權限為 Change request，你對「{field}」的修改已送出審核，通過後生效。",
    savedAsChangeRequest: "你對「{field}」的修改已儲存為變更請求，合併後生效。",
    saveFailed: "「{field}」沒有儲存成功：{error} 儲存格已恢復原值。",
    readOnlyCell: "「{field}」無法在表格中直接編輯，按 Enter 開啟記錄。",
    errorRequired: "「{field}」為必填。",
    errorNumber: "請輸入數字，例如 129 或 129.50。",
    errorEmail: "請輸入電子郵件地址，例如 name@example.com。",
    errorUrl: "請輸入以 https:// 開頭的完整連結。",
    errorPhone: "請輸入電話號碼。",
    errorDate: "請輸入有效日期。",
    errorChoice: "請從選項中選擇一個。",
    errorInvalid: "這個值無法儲存。",
    empty: "空",
  },
  ja: {
    gridHelp:
      "矢印キーと Tab でセル間を移動します。Enter または文字入力で編集、Esc でキャンセル、スペースでレコードを開きます。",
    saving: "保存中…",
    pending: "レビュー待ち",
    pendingTitle:
      "提案した値：{value}。レビュー待ちです。承認されるまでセルには現在の値が表示されます。",
    submittedForReview:
      "この Base でのあなたの権限は Change request のため、「{field}」の変更はレビューに送信され、承認後に反映されます。",
    savedAsChangeRequest:
      "「{field}」の変更を変更リクエストとして保存しました。マージされると反映されます。",
    saveFailed: "「{field}」を保存できませんでした：{error} セルは元の値に戻りました。",
    readOnlyCell: "「{field}」は表の中では編集できません。Enter でレコードを開きます。",
    errorRequired: "「{field}」は必須です。",
    errorNumber: "129 や 129.50 のように数値を入力してください。",
    errorEmail: "name@example.com のようにメールアドレスを入力してください。",
    errorUrl: "https:// で始まる完全なリンクを入力してください。",
    errorPhone: "電話番号を入力してください。",
    errorDate: "有効な日付を入力してください。",
    errorChoice: "選択肢から 1 つ選んでください。",
    errorInvalid: "この値は保存できません。",
    empty: "空",
  },
  ko: {
    gridHelp:
      "화살표 키와 Tab으로 셀 사이를 이동합니다. Enter를 누르거나 바로 입력하면 편집, Esc는 취소, 스페이스는 레코드 열기입니다.",
    saving: "저장 중…",
    pending: "검토 대기 중",
    pendingTitle:
      "제안한 값: {value}. 검토 대기 중이며, 승인될 때까지 셀에는 현재 값이 표시됩니다.",
    submittedForReview:
      "이 Base에 대한 권한이 Change request이므로 '{field}' 수정 사항은 검토 요청으로 제출되었으며 승인 후 반영됩니다.",
    savedAsChangeRequest:
      "'{field}' 수정 사항을 변경 요청으로 저장했습니다. 요청이 병합되면 반영됩니다.",
    saveFailed: "'{field}'을(를) 저장하지 못했습니다: {error} 셀을 원래 값으로 되돌렸습니다.",
    readOnlyCell: "'{field}'은(는) 표에서 바로 편집할 수 없습니다. Enter를 눌러 레코드를 여세요.",
    errorRequired: "'{field}'은(는) 필수입니다.",
    errorNumber: "129 또는 129.50처럼 숫자를 입력하세요.",
    errorEmail: "name@example.com처럼 이메일 주소를 입력하세요.",
    errorUrl: "https://로 시작하는 전체 링크를 입력하세요.",
    errorPhone: "전화번호를 입력하세요.",
    errorDate: "올바른 날짜를 입력하세요.",
    errorChoice: "옵션 중 하나를 선택하세요.",
    errorInvalid: "이 값은 저장할 수 없습니다.",
    empty: "비어 있음",
  },
  es: {
    gridHelp:
      "Las flechas y Tab mueven entre celdas. Pulsa Intro o empieza a escribir para editar, Esc para cancelar y Espacio para abrir el registro.",
    saving: "Guardando…",
    pending: "Pendiente de revisión",
    pendingTitle:
      "Propuesto: {value}. Pendiente de revisión: la celda mantiene su valor actual hasta que se apruebe.",
    submittedForReview:
      "Tu acceso a esta Base es Change request, así que tu cambio en {field} se envió a revisión y se aplicará cuando se apruebe.",
    savedAsChangeRequest:
      "Tu cambio en {field} se guardó como solicitud de cambio. Se aplicará cuando se fusione la solicitud.",
    saveFailed: "No se pudo guardar {field}: {error} La celda volvió a su valor anterior.",
    readOnlyCell: "{field} no se puede editar en la tabla. Pulsa Intro para abrir el registro.",
    errorRequired: "{field} es obligatorio.",
    errorNumber: "Introduce un número, como 129 o 129.50.",
    errorEmail: "Introduce un correo electrónico, como nombre@example.com.",
    errorUrl: "Introduce un enlace completo que empiece por https://.",
    errorPhone: "Introduce un número de teléfono.",
    errorDate: "Introduce una fecha válida.",
    errorChoice: "Elige una de las opciones.",
    errorInvalid: "Este valor no se puede guardar.",
    empty: "Vacío",
  },
  pt: {
    gridHelp:
      "As setas e Tab movem entre células. Pressione Enter ou comece a digitar para editar, Esc para cancelar e Espaço para abrir o registro.",
    saving: "Salvando…",
    pending: "Aguardando revisão",
    pendingTitle:
      "Proposto: {value}. Aguardando revisão — a célula mantém o valor atual até ser aprovada.",
    submittedForReview:
      "Seu acesso a esta Base é Change request, então sua alteração em {field} foi enviada para revisão e entrará em vigor após a aprovação.",
    savedAsChangeRequest:
      "Sua alteração em {field} foi salva como Change Request. Ela entra em vigor quando a solicitação for mesclada.",
    saveFailed: "Não foi possível salvar {field}: {error} A célula voltou ao valor anterior.",
    readOnlyCell: "{field} não pode ser editado na tabela. Pressione Enter para abrir o registro.",
    errorRequired: "{field} é obrigatório.",
    errorNumber: "Digite um número, como 129 ou 129.50.",
    errorEmail: "Digite um e-mail, como nome@example.com.",
    errorUrl: "Digite um link completo começando com https://.",
    errorPhone: "Digite um número de telefone.",
    errorDate: "Digite uma data válida.",
    errorChoice: "Escolha uma das opções.",
    errorInvalid: "Este valor não pode ser salvo.",
    empty: "Vazio",
  },
  vi: {
    gridHelp:
      "Phím mũi tên và Tab để di chuyển giữa các ô. Nhấn Enter hoặc gõ để sửa, Esc để hủy, phím cách để mở bản ghi.",
    saving: "Đang lưu…",
    pending: "Đang chờ duyệt",
    pendingTitle:
      "Giá trị đề xuất: {value}. Đang chờ duyệt — ô vẫn giữ giá trị hiện tại cho đến khi được duyệt.",
    submittedForReview:
      "Quyền của bạn trên Base này là Change request, nên thay đổi ở {field} đã được gửi duyệt và sẽ có hiệu lực sau khi được chấp thuận.",
    savedAsChangeRequest:
      "Thay đổi ở {field} đã được lưu dưới dạng yêu cầu thay đổi và sẽ có hiệu lực khi yêu cầu được hợp nhất.",
    saveFailed: "Không lưu được {field}: {error} Ô đã được trả về giá trị cũ.",
    readOnlyCell: "{field} không thể sửa ngay trong bảng. Nhấn Enter để mở bản ghi.",
    errorRequired: "{field} là bắt buộc.",
    errorNumber: "Nhập một số, ví dụ 129 hoặc 129.50.",
    errorEmail: "Nhập địa chỉ email, ví dụ name@example.com.",
    errorUrl: "Nhập liên kết đầy đủ bắt đầu bằng https://.",
    errorPhone: "Nhập số điện thoại.",
    errorDate: "Nhập ngày hợp lệ.",
    errorChoice: "Chọn một trong các tùy chọn.",
    errorInvalid: "Không thể lưu giá trị này.",
    empty: "Trống",
  },
  fr: {
    gridHelp:
      "Les flèches et Tab déplacent entre les cellules. Appuyez sur Entrée ou commencez à taper pour modifier, Échap pour annuler, Espace pour ouvrir l’enregistrement.",
    saving: "Enregistrement…",
    pending: "En attente de revue",
    pendingTitle:
      "Proposé : {value}. En attente de revue — la cellule garde sa valeur actuelle jusqu’à l’approbation.",
    submittedForReview:
      "Votre accès à cette Base est Change request : votre modification de {field} a été envoyée en revue et prendra effet après approbation.",
    savedAsChangeRequest:
      "Votre modification de {field} a été enregistrée comme Demande de modification. Elle prendra effet une fois la demande fusionnée.",
    saveFailed: "Impossible d’enregistrer {field} : {error} La cellule a été rétablie.",
    readOnlyCell:
      "{field} ne peut pas être modifié dans le tableau. Appuyez sur Entrée pour ouvrir l’enregistrement.",
    errorRequired: "{field} est obligatoire.",
    errorNumber: "Saisissez un nombre, par exemple 129 ou 129.50.",
    errorEmail: "Saisissez une adresse e-mail, par exemple nom@example.com.",
    errorUrl: "Saisissez un lien complet commençant par https://.",
    errorPhone: "Saisissez un numéro de téléphone.",
    errorDate: "Saisissez une date valide.",
    errorChoice: "Choisissez l’une des options.",
    errorInvalid: "Cette valeur ne peut pas être enregistrée.",
    empty: "Vide",
  },
  de: {
    gridHelp:
      "Pfeiltasten und Tab wechseln zwischen Zellen. Enter oder einfach lostippen zum Bearbeiten, Esc zum Abbrechen, Leertaste öffnet den Datensatz.",
    saving: "Wird gespeichert…",
    pending: "Wartet auf Review",
    pendingTitle:
      "Vorgeschlagen: {value}. Wartet auf Review – die Zelle zeigt bis zur Freigabe den aktuellen Wert.",
    submittedForReview:
      "Ihr Zugriff auf diese Base ist „Change request“, daher wurde Ihre Änderung an {field} zur Review eingereicht und wird nach der Freigabe wirksam.",
    savedAsChangeRequest:
      "Ihre Änderung an {field} wurde als Change Request gespeichert. Sie wird wirksam, sobald der Request gemergt ist.",
    saveFailed: "{field} konnte nicht gespeichert werden: {error} Die Zelle wurde zurückgesetzt.",
    readOnlyCell:
      "{field} kann nicht in der Tabelle bearbeitet werden. Drücken Sie Enter, um den Datensatz zu öffnen.",
    errorRequired: "{field} ist ein Pflichtfeld.",
    errorNumber: "Geben Sie eine Zahl ein, z. B. 129 oder 129.50.",
    errorEmail: "Geben Sie eine E-Mail-Adresse ein, z. B. name@example.com.",
    errorUrl: "Geben Sie einen vollständigen Link ein, der mit https:// beginnt.",
    errorPhone: "Geben Sie eine Telefonnummer ein.",
    errorDate: "Geben Sie ein gültiges Datum ein.",
    errorChoice: "Wählen Sie eine der Optionen.",
    errorInvalid: "Dieser Wert kann nicht gespeichert werden.",
    empty: "Leer",
  },
};
