import type { CoreLocale } from "./locales";

/**
 * Record revert (History panel → "Revert to before this change" → preview
 * dialog). `reason*` keys localize the 409s `records.revertPreview` /
 * `records.changeRequest` return, keyed by the error's `data.reason`.
 *
 * Wording follows the code-review convention: a revert is a NEW change that
 * undoes earlier ones (zh 还原). "Restore" / 恢复 stays reserved for the Trash.
 */
const en = {
  undoCreation: "Restore initial record",
  creationDescription: "Restore the record to its initial state, undoing later changes.",
  creationHint: "Later changes will be undone; the creation is kept.",
  valuesHint: "The values below show the current contents and what will be written back.",
  moveToTrash: "Move to Trash",
  action: "Revert to before this change",
  actionShort: "Revert",
  badge: "Revert",
  title: "Revert to before this change",
  description:
    "Returns this record to how it was just before “{change}”. The revert is saved as a new change, so it can be reviewed, audited and reverted too.",
  loading: "Working out what would change…",
  undoneTitle: "Changes that will be undone ({count})",
  undoneHint:
    "Reverting to before a change also undoes every later change to this record, newest first.",
  selectedChange: "Selected change",
  resultTitle: "After the revert",
  deleteAfterRestoreResult:
    "The record goes back to the Trash, where it was before it was restored.",
  restoreResult: "This change deleted the record, so reverting it restores it from the Trash.",
  pendingTitle: "Pending changes are not affected ({count})",
  pendingHint:
    "They are not part of the record's current state. The revert leaves them as they are.",
  landsNow: "It takes effect immediately.",
  needsReview: "It will be submitted for review and takes effect once approved.",
  noPermission: "You need edit access to this record to revert it.",
  failedTitle: "This change can't be reverted",
  cancel: "Cancel",
  confirm: "Revert",
  confirmReview: "Submit for review",
  submitting: "Reverting…",
  done: "Reverted — the record is back to its earlier state.",
  submitted: "Revert submitted for review. It takes effect once approved.",
  failed: "Could not revert. Try again.",
  reasonFieldDeleted:
    "The field “{field}” was deleted after these changes, so its earlier value can't be restored. Nothing was changed.",
  reasonFieldTypeChanged:
    "The field “{field}” was converted to another type after these changes, so its earlier value no longer fits. Nothing was changed.",
  reasonRecordInTrash:
    "This record is in the Trash. Restore it first, or revert to before the change that deleted it.",
  reasonRestoreThenEdit:
    "The record was edited after it was restored. Revert to before those edits first, then to before the restore.",
  reasonNothing:
    "The record already matches its state before this change — there is nothing to revert.",
  reasonNotMerged: "Only changes that have landed can be reverted.",
  reasonPlanChanged:
    "The record changed after this preview was made, so nothing was submitted. The preview has been refreshed — check it and confirm again.",
};

type Messages = { [K in keyof typeof en]: string };

export const recordRevertMessages: Record<CoreLocale, Messages> = {
  en,
  "zh-CN": {
    undoCreation: "还原到创建后的内容",
    creationDescription: "将记录还原到创建后的内容，撤销之后的修改。",
    creationHint: "将撤销创建之后的变更，保留创建时的记录。",
    valuesHint: "下方展示当前内容及还原后写入单元格的内容。",
    moveToTrash: "移入回收站",
    action: "还原到此变更之前",
    actionShort: "还原",
    badge: "还原",
    title: "还原到此变更之前",
    description:
      "把这条记录还原到「{change}」之前的样子。这次还原会保存为一个新的变更，同样可以审核、追溯，也可以再还原。",
    loading: "正在计算还原后的变化…",
    undoneTitle: "将被撤销的变更（{count}）",
    undoneHint: "还原到某个变更之前，会连同它之后对这条记录的所有变更一起撤销，从最新的开始。",
    selectedChange: "所选变更",
    resultTitle: "还原之后",
    deleteAfterRestoreResult: "记录会回到回收站，也就是它被恢复之前的位置。",
    restoreResult: "这个变更删除了这条记录，还原后会把它从回收站恢复。",
    pendingTitle: "待处理的变更不受影响（{count}）",
    pendingHint: "它们还不是这条记录的当前状态，还原不会改动它们。",
    landsNow: "确认后立即生效。",
    needsReview: "将提交审核，批准后生效。",
    noPermission: "你需要这条记录的编辑权限才能还原。",
    failedTitle: "这个变更无法还原",
    cancel: "取消",
    confirm: "还原",
    confirmReview: "提交审核",
    submitting: "正在还原…",
    done: "已还原，记录回到了之前的状态。",
    submitted: "还原已提交审核，批准后生效。",
    failed: "还原失败，请重试。",
    reasonFieldDeleted:
      "字段「{field}」在这些变更之后被删除了，无法恢复它之前的值。没有做任何改动。",
    reasonFieldTypeChanged:
      "字段「{field}」在这些变更之后被转换成了其他类型，之前的值已不再适用。没有做任何改动。",
    reasonRecordInTrash: "这条记录在回收站里。请先恢复它，或者还原到删除它的那个变更之前。",
    reasonRestoreThenEdit: "记录在恢复之后又被编辑过。请先还原到这些编辑之前，再还原到恢复之前。",
    reasonNothing: "记录已经和这个变更之前的状态一致，没有需要还原的内容。",
    reasonNotMerged: "只有已经生效的变更才能还原。",
    reasonPlanChanged: "预览之后这条记录又有了变化，所以没有提交。预览已刷新，请确认后再提交。",
  },
  "zh-TW": {
    undoCreation: "還原到建立後的內容",
    creationDescription: "將記錄還原到建立後的內容，撤銷之後的修改。",
    creationHint: "將撤銷建立之後的變更，保留建立時的記錄。",
    valuesHint: "下方展示目前內容及還原後寫入儲存格的內容。",
    moveToTrash: "移至垃圾桶",
    action: "還原到此變更之前",
    actionShort: "還原",
    badge: "還原",
    title: "還原到此變更之前",
    description:
      "把這筆記錄還原到「{change}」之前的樣子。這次還原會儲存為一個新的變更，同樣可以審核、追溯，也可以再還原。",
    loading: "正在計算還原後的變化…",
    undoneTitle: "將被撤銷的變更（{count}）",
    undoneHint: "還原到某個變更之前，會連同它之後對這筆記錄的所有變更一起撤銷，從最新的開始。",
    selectedChange: "所選變更",
    resultTitle: "還原之後",
    deleteAfterRestoreResult: "記錄會回到垃圾桶，也就是它被復原之前的位置。",
    restoreResult: "這個變更刪除了這筆記錄，還原後會把它從垃圾桶復原。",
    pendingTitle: "待處理的變更不受影響（{count}）",
    pendingHint: "它們還不是這筆記錄的目前狀態，還原不會改動它們。",
    landsNow: "確認後立即生效。",
    needsReview: "將提交審核，核准後生效。",
    noPermission: "你需要這筆記錄的編輯權限才能還原。",
    failedTitle: "這個變更無法還原",
    cancel: "取消",
    confirm: "還原",
    confirmReview: "提交審核",
    submitting: "正在還原…",
    done: "已還原，記錄回到了之前的狀態。",
    submitted: "還原已提交審核，核准後生效。",
    failed: "還原失敗，請重試。",
    reasonFieldDeleted:
      "欄位「{field}」在這些變更之後被刪除了，無法恢復它之前的值。沒有做任何改動。",
    reasonFieldTypeChanged:
      "欄位「{field}」在這些變更之後被轉換成其他類型，之前的值已不再適用。沒有做任何改動。",
    reasonRecordInTrash: "這筆記錄在垃圾桶裡。請先復原它，或者還原到刪除它的那個變更之前。",
    reasonRestoreThenEdit: "記錄在復原之後又被編輯過。請先還原到這些編輯之前，再還原到復原之前。",
    reasonNothing: "記錄已經和這個變更之前的狀態一致，沒有需要還原的內容。",
    reasonNotMerged: "只有已經生效的變更才能還原。",
    reasonPlanChanged: "預覽之後這筆記錄又有了變化，所以沒有提交。預覽已重新整理，請確認後再提交。",
  },
  ja: {
    undoCreation: "作成時の内容に復元",
    creationDescription: "作成後の変更を取り消し、作成時の内容に復元します。",
    creationHint: "作成後の変更を取り消し、作成は維持します。",
    valuesHint: "現在の内容と復元後にセルに書き込まれる内容を表示します。",
    moveToTrash: "ゴミ箱に移動",
    action: "この変更の前に戻す",
    actionShort: "元に戻す",
    badge: "元に戻す",
    title: "この変更の前に戻す",
    description:
      "このレコードを「{change}」の直前の状態に戻します。元に戻す操作は新しい変更として保存されるため、レビュー・監査でき、さらに元に戻すこともできます。",
    loading: "変更内容を計算しています…",
    undoneTitle: "取り消される変更（{count}）",
    undoneHint:
      "ある変更の前に戻すと、それ以降のこのレコードへの変更もすべて新しい順に取り消されます。",
    selectedChange: "選択した変更",
    resultTitle: "元に戻した後",
    deleteAfterRestoreResult: "レコードは復元される前にあったゴミ箱に戻ります。",
    restoreResult: "この変更でレコードが削除されたため、元に戻すとゴミ箱から復元されます。",
    pendingTitle: "保留中の変更は影響を受けません（{count}）",
    pendingHint: "これらはまだレコードの現在の状態ではなく、元に戻しても変更されません。",
    landsNow: "すぐに反映されます。",
    needsReview: "レビューに提出され、承認後に反映されます。",
    noPermission: "元に戻すにはこのレコードの編集権限が必要です。",
    failedTitle: "この変更は元に戻せません",
    cancel: "キャンセル",
    confirm: "元に戻す",
    confirmReview: "レビューに提出",
    submitting: "元に戻しています…",
    done: "元に戻しました。レコードは以前の状態です。",
    submitted: "元に戻す変更をレビューに提出しました。承認後に反映されます。",
    failed: "元に戻せませんでした。もう一度お試しください。",
    reasonFieldDeleted:
      "フィールド「{field}」はこれらの変更の後に削除されたため、以前の値を復元できません。何も変更していません。",
    reasonFieldTypeChanged:
      "フィールド「{field}」はこれらの変更の後に別の型へ変換されたため、以前の値は合いません。何も変更していません。",
    reasonRecordInTrash:
      "このレコードはゴミ箱にあります。先に復元するか、削除した変更の前に戻してください。",
    reasonRestoreThenEdit:
      "レコードは復元後に編集されています。まずそれらの編集の前に戻し、その後で復元の前に戻してください。",
    reasonNothing: "レコードはすでにこの変更前の状態と同じです。元に戻す内容はありません。",
    reasonNotMerged: "元に戻せるのは反映済みの変更だけです。",
    reasonPlanChanged:
      "プレビューの後にレコードが変更されたため、送信していません。プレビューを更新しました。確認してからもう一度実行してください。",
  },
  ko: {
    undoCreation: "생성 당시 내용으로 복원",
    creationDescription: "이후 변경을 취소하고 생성 당시 내용으로 복원합니다.",
    creationHint: "생성 후 변경을 취소하고 생성은 유지합니다.",
    valuesHint: "현재 내용과 복원 후 셀에 입력될 내용을 표시합니다.",
    moveToTrash: "휴지통으로 이동",
    action: "이 변경 이전으로 되돌리기",
    actionShort: "되돌리기",
    badge: "되돌리기",
    title: "이 변경 이전으로 되돌리기",
    description:
      "이 레코드를 「{change}」 직전 상태로 되돌립니다. 되돌리기는 새 변경으로 저장되므로 검토·감사할 수 있고 다시 되돌릴 수도 있습니다.",
    loading: "변경될 내용을 계산하는 중…",
    undoneTitle: "취소될 변경 ({count})",
    undoneHint:
      "어떤 변경 이전으로 되돌리면 그 이후 이 레코드에 적용된 모든 변경도 최신순으로 함께 취소됩니다.",
    selectedChange: "선택한 변경",
    resultTitle: "되돌린 후",
    deleteAfterRestoreResult: "레코드는 복원되기 전에 있던 휴지통으로 돌아갑니다.",
    restoreResult: "이 변경으로 레코드가 삭제되었으므로 되돌리면 휴지통에서 복원됩니다.",
    pendingTitle: "대기 중인 변경은 영향을 받지 않습니다 ({count})",
    pendingHint: "아직 레코드의 현재 상태가 아니며, 되돌려도 그대로 유지됩니다.",
    landsNow: "즉시 적용됩니다.",
    needsReview: "검토를 위해 제출되며 승인 후 적용됩니다.",
    noPermission: "되돌리려면 이 레코드의 편집 권한이 필요합니다.",
    failedTitle: "이 변경은 되돌릴 수 없습니다",
    cancel: "취소",
    confirm: "되돌리기",
    confirmReview: "검토 요청",
    submitting: "되돌리는 중…",
    done: "되돌렸습니다. 레코드가 이전 상태로 돌아갔습니다.",
    submitted: "되돌리기를 검토 요청했습니다. 승인 후 적용됩니다.",
    failed: "되돌리지 못했습니다. 다시 시도하세요.",
    reasonFieldDeleted:
      "필드 「{field}」가 이 변경들 이후에 삭제되어 이전 값을 복원할 수 없습니다. 아무것도 변경하지 않았습니다.",
    reasonFieldTypeChanged:
      "필드 「{field}」가 이 변경들 이후에 다른 유형으로 변환되어 이전 값이 맞지 않습니다. 아무것도 변경하지 않았습니다.",
    reasonRecordInTrash:
      "이 레코드는 휴지통에 있습니다. 먼저 복원하거나, 삭제한 변경 이전으로 되돌리세요.",
    reasonRestoreThenEdit:
      "레코드가 복원된 후 편집되었습니다. 먼저 그 편집 이전으로 되돌린 다음 복원 이전으로 되돌리세요.",
    reasonNothing: "레코드가 이미 이 변경 이전 상태와 같습니다. 되돌릴 내용이 없습니다.",
    reasonNotMerged: "적용된 변경만 되돌릴 수 있습니다.",
    reasonPlanChanged:
      "미리보기 이후 레코드가 변경되어 제출하지 않았습니다. 미리보기를 새로 고쳤으니 확인한 뒤 다시 실행하세요.",
  },
  es: {
    undoCreation: "Restaurar registro inicial",
    creationDescription: "Restaura el registro inicial y deshace los cambios posteriores.",
    creationHint: "Se deshacen los cambios posteriores y se conserva la creación.",
    valuesHint: "Se muestran los valores actuales y los que se escribirán al revertir.",
    moveToTrash: "Mover a la papelera",
    action: "Revertir a antes de este cambio",
    actionShort: "Revertir",
    badge: "Reversión",
    title: "Revertir a antes de este cambio",
    description:
      "Devuelve este registro a como estaba justo antes de «{change}». La reversión se guarda como un cambio nuevo, así que también se puede revisar, auditar y revertir.",
    loading: "Calculando qué cambiaría…",
    undoneTitle: "Cambios que se desharán ({count})",
    undoneHint:
      "Revertir a antes de un cambio también deshace todos los cambios posteriores de este registro, del más reciente al más antiguo.",
    selectedChange: "Cambio seleccionado",
    resultTitle: "Después de revertir",
    deleteAfterRestoreResult:
      "El registro vuelve a la papelera, donde estaba antes de restaurarse.",
    restoreResult:
      "Este cambio eliminó el registro, así que revertirlo lo restaura desde la papelera.",
    pendingTitle: "Los cambios pendientes no se ven afectados ({count})",
    pendingHint:
      "Todavía no forman parte del estado actual del registro. La reversión no los toca.",
    landsNow: "Se aplica de inmediato.",
    needsReview: "Se enviará a revisión y se aplicará cuando se apruebe.",
    noPermission: "Necesitas permiso de edición en este registro para revertirlo.",
    failedTitle: "Este cambio no se puede revertir",
    cancel: "Cancelar",
    confirm: "Revertir",
    confirmReview: "Enviar a revisión",
    submitting: "Revirtiendo…",
    done: "Revertido: el registro ha vuelto a su estado anterior.",
    submitted: "Reversión enviada a revisión. Se aplicará cuando se apruebe.",
    failed: "No se pudo revertir. Inténtalo de nuevo.",
    reasonFieldDeleted:
      "El campo «{field}» se eliminó después de estos cambios, así que no se puede restaurar su valor anterior. No se ha cambiado nada.",
    reasonFieldTypeChanged:
      "El campo «{field}» se convirtió a otro tipo después de estos cambios, así que su valor anterior ya no encaja. No se ha cambiado nada.",
    reasonRecordInTrash:
      "Este registro está en la papelera. Restáuralo primero o revierte a antes del cambio que lo eliminó.",
    reasonRestoreThenEdit:
      "El registro se editó después de restaurarse. Revierte primero a antes de esas ediciones y luego a antes de la restauración.",
    reasonNothing:
      "El registro ya coincide con su estado anterior a este cambio: no hay nada que revertir.",
    reasonNotMerged: "Solo se pueden revertir los cambios que ya se aplicaron.",
    reasonPlanChanged:
      "El registro cambió después de esta vista previa, así que no se envió nada. La vista previa se ha actualizado: revísala y confirma de nuevo.",
  },
  pt: {
    undoCreation: "Restaurar registro inicial",
    creationDescription: "Restaura o registro inicial e desfaz as alterações posteriores.",
    creationHint: "As alterações posteriores serão desfeitas e a criação será mantida.",
    valuesHint: "Veja os valores atuais e os que serão gravados ao reverter.",
    moveToTrash: "Mover para a lixeira",
    action: "Reverter para antes desta alteração",
    actionShort: "Reverter",
    badge: "Reversão",
    title: "Reverter para antes desta alteração",
    description:
      "Devolve este registro ao estado em que estava logo antes de “{change}”. A reversão é salva como uma nova alteração, que também pode ser revisada, auditada e revertida.",
    loading: "Calculando o que mudaria…",
    undoneTitle: "Alterações que serão desfeitas ({count})",
    undoneHint:
      "Reverter para antes de uma alteração também desfaz todas as alterações posteriores deste registro, da mais recente para a mais antiga.",
    selectedChange: "Alteração selecionada",
    resultTitle: "Depois da reversão",
    deleteAfterRestoreResult:
      "O registro volta para a lixeira, onde estava antes de ser restaurado.",
    restoreResult: "Esta alteração excluiu o registro, então revertê-la o restaura da lixeira.",
    pendingTitle: "Alterações pendentes não são afetadas ({count})",
    pendingHint:
      "Elas ainda não fazem parte do estado atual do registro. A reversão não mexe nelas.",
    landsNow: "Entra em vigor imediatamente.",
    needsReview: "Será enviada para revisão e entra em vigor após a aprovação.",
    noPermission: "Você precisa de permissão de edição neste registro para revertê-lo.",
    failedTitle: "Esta alteração não pode ser revertida",
    cancel: "Cancelar",
    confirm: "Reverter",
    confirmReview: "Enviar para revisão",
    submitting: "Revertendo…",
    done: "Revertido — o registro voltou ao estado anterior.",
    submitted: "Reversão enviada para revisão. Entra em vigor após a aprovação.",
    failed: "Não foi possível reverter. Tente novamente.",
    reasonFieldDeleted:
      "O campo “{field}” foi excluído depois destas alterações, então o valor anterior não pode ser restaurado. Nada foi alterado.",
    reasonFieldTypeChanged:
      "O campo “{field}” foi convertido para outro tipo depois destas alterações, então o valor anterior não se encaixa mais. Nada foi alterado.",
    reasonRecordInTrash:
      "Este registro está na lixeira. Restaure-o primeiro ou reverta para antes da alteração que o excluiu.",
    reasonRestoreThenEdit:
      "O registro foi editado depois de restaurado. Reverta primeiro para antes dessas edições e depois para antes da restauração.",
    reasonNothing:
      "O registro já corresponde ao estado anterior a esta alteração — não há nada para reverter.",
    reasonNotMerged: "Só é possível reverter alterações que já entraram em vigor.",
    reasonPlanChanged:
      "O registro mudou depois desta pré-visualização, então nada foi enviado. A pré-visualização foi atualizada — confira e confirme novamente.",
  },
  vi: {
    undoCreation: "Khôi phục bản ghi ban đầu",
    creationDescription: "Khôi phục nội dung ban đầu và hoàn tác các thay đổi sau đó.",
    creationHint: "Các thay đổi sau đó sẽ được hoàn tác; bản ghi được giữ lại.",
    valuesHint: "Các giá trị hiện tại và giá trị sẽ ghi lại được hiển thị bên dưới.",
    moveToTrash: "Chuyển vào thùng rác",
    action: "Hoàn nguyên về trước thay đổi này",
    actionShort: "Hoàn nguyên",
    badge: "Hoàn nguyên",
    title: "Hoàn nguyên về trước thay đổi này",
    description:
      "Đưa bản ghi này về trạng thái ngay trước “{change}”. Lần hoàn nguyên được lưu thành một thay đổi mới, nên cũng có thể duyệt, kiểm tra và hoàn nguyên lại.",
    loading: "Đang tính toán những gì sẽ thay đổi…",
    undoneTitle: "Các thay đổi sẽ bị hủy ({count})",
    undoneHint:
      "Hoàn nguyên về trước một thay đổi cũng hủy mọi thay đổi sau đó của bản ghi này, từ mới nhất trở về trước.",
    selectedChange: "Thay đổi đã chọn",
    resultTitle: "Sau khi hoàn nguyên",
    deleteAfterRestoreResult: "Bản ghi quay lại Thùng rác, nơi nó ở trước khi được khôi phục.",
    restoreResult: "Thay đổi này đã xóa bản ghi, nên hoàn nguyên sẽ khôi phục nó từ Thùng rác.",
    pendingTitle: "Các thay đổi đang chờ không bị ảnh hưởng ({count})",
    pendingHint:
      "Chúng chưa thuộc trạng thái hiện tại của bản ghi. Lần hoàn nguyên giữ nguyên chúng.",
    landsNow: "Có hiệu lực ngay.",
    needsReview: "Sẽ được gửi duyệt và có hiệu lực sau khi được chấp thuận.",
    noPermission: "Bạn cần quyền chỉnh sửa bản ghi này để hoàn nguyên.",
    failedTitle: "Không thể hoàn nguyên thay đổi này",
    cancel: "Hủy",
    confirm: "Hoàn nguyên",
    confirmReview: "Gửi duyệt",
    submitting: "Đang hoàn nguyên…",
    done: "Đã hoàn nguyên — bản ghi đã về trạng thái trước đó.",
    submitted: "Đã gửi duyệt lần hoàn nguyên. Có hiệu lực sau khi được chấp thuận.",
    failed: "Không thể hoàn nguyên. Hãy thử lại.",
    reasonFieldDeleted:
      "Trường “{field}” đã bị xóa sau các thay đổi này nên không thể khôi phục giá trị cũ. Không có gì bị thay đổi.",
    reasonFieldTypeChanged:
      "Trường “{field}” đã được chuyển sang kiểu khác sau các thay đổi này nên giá trị cũ không còn phù hợp. Không có gì bị thay đổi.",
    reasonRecordInTrash:
      "Bản ghi này đang ở Thùng rác. Hãy khôi phục trước, hoặc hoàn nguyên về trước thay đổi đã xóa nó.",
    reasonRestoreThenEdit:
      "Bản ghi đã được chỉnh sửa sau khi khôi phục. Hãy hoàn nguyên về trước các chỉnh sửa đó trước, rồi mới về trước lần khôi phục.",
    reasonNothing:
      "Bản ghi đã khớp với trạng thái trước thay đổi này — không có gì để hoàn nguyên.",
    reasonNotMerged: "Chỉ có thể hoàn nguyên các thay đổi đã có hiệu lực.",
    reasonPlanChanged:
      "Bản ghi đã thay đổi sau lần xem trước này nên chưa có gì được gửi. Bản xem trước đã được làm mới — hãy kiểm tra rồi xác nhận lại.",
  },
  fr: {
    undoCreation: "Restaurer le contenu initial",
    creationDescription: "Restaure le contenu initial et annule les modifications ultérieures.",
    creationHint: "Les modifications ultérieures seront annulées et la création conservée.",
    valuesHint: "Les valeurs actuelles et celles qui seront restaurées sont affichées ci-dessous.",
    moveToTrash: "Déplacer dans la corbeille",
    action: "Rétablir l'état d'avant cette modification",
    actionShort: "Rétablir",
    badge: "Rétablissement",
    title: "Rétablir l'état d'avant cette modification",
    description:
      "Remet cet enregistrement dans l'état où il était juste avant « {change} ». Le rétablissement est enregistré comme une nouvelle modification : il peut lui aussi être relu, audité et rétabli.",
    loading: "Calcul de ce qui changerait…",
    undoneTitle: "Modifications qui seront annulées ({count})",
    undoneHint:
      "Rétablir l'état d'avant une modification annule aussi toutes les modifications ultérieures de cet enregistrement, de la plus récente à la plus ancienne.",
    selectedChange: "Modification sélectionnée",
    resultTitle: "Après le rétablissement",
    deleteAfterRestoreResult:
      "L'enregistrement retourne dans la corbeille, où il était avant sa restauration.",
    restoreResult:
      "Cette modification a supprimé l'enregistrement : la rétablir le restaure depuis la corbeille.",
    pendingTitle: "Les modifications en attente ne sont pas concernées ({count})",
    pendingHint:
      "Elles ne font pas encore partie de l'état actuel de l'enregistrement. Le rétablissement ne les touche pas.",
    landsNow: "Prend effet immédiatement.",
    needsReview: "Sera soumis à relecture et prendra effet une fois approuvé.",
    noPermission: "Vous devez pouvoir modifier cet enregistrement pour le rétablir.",
    failedTitle: "Impossible de rétablir l'état d'avant cette modification",
    cancel: "Annuler",
    confirm: "Rétablir",
    confirmReview: "Soumettre à relecture",
    submitting: "Rétablissement…",
    done: "Rétabli : l'enregistrement a retrouvé son état antérieur.",
    submitted: "Rétablissement soumis à relecture. Il prendra effet une fois approuvé.",
    failed: "Le rétablissement a échoué. Réessayez.",
    reasonFieldDeleted:
      "Le champ « {field} » a été supprimé après ces modifications : sa valeur antérieure ne peut pas être restaurée. Rien n'a été modifié.",
    reasonFieldTypeChanged:
      "Le champ « {field} » a été converti dans un autre type après ces modifications : sa valeur antérieure ne convient plus. Rien n'a été modifié.",
    reasonRecordInTrash:
      "Cet enregistrement est dans la corbeille. Restaurez-le d'abord, ou rétablissez l'état d'avant la modification qui l'a supprimé.",
    reasonRestoreThenEdit:
      "L'enregistrement a été modifié après sa restauration. Rétablissez d'abord l'état d'avant ces modifications, puis celui d'avant la restauration.",
    reasonNothing:
      "L'enregistrement correspond déjà à son état d'avant cette modification : il n'y a rien à rétablir.",
    reasonNotMerged: "Seules les modifications appliquées peuvent être rétablies.",
    reasonPlanChanged:
      "L'enregistrement a changé après cet aperçu, rien n'a donc été soumis. L'aperçu a été actualisé : vérifiez-le puis confirmez à nouveau.",
  },
  de: {
    undoCreation: "Ursprünglichen Inhalt wiederherstellen",
    creationDescription:
      "Stellt den ursprünglichen Inhalt wieder her und macht spätere Änderungen rückgängig.",
    creationHint: "Spätere Änderungen werden rückgängig gemacht; die Erstellung bleibt erhalten.",
    valuesHint: "Unten stehen die aktuellen und die wiederherzustellenden Werte.",
    moveToTrash: "In den Papierkorb verschieben",
    action: "Auf den Stand vor dieser Änderung zurücksetzen",
    actionShort: "Zurücksetzen",
    badge: "Zurückgesetzt",
    title: "Auf den Stand vor dieser Änderung zurücksetzen",
    description:
      "Setzt diesen Datensatz auf den Stand direkt vor „{change}“ zurück. Das Zurücksetzen wird als neue Änderung gespeichert und kann ebenfalls geprüft, nachvollzogen und zurückgesetzt werden.",
    loading: "Berechne, was sich ändern würde…",
    undoneTitle: "Änderungen, die rückgängig gemacht werden ({count})",
    undoneHint:
      "Das Zurücksetzen vor eine Änderung macht auch alle späteren Änderungen an diesem Datensatz rückgängig, die neueste zuerst.",
    selectedChange: "Ausgewählte Änderung",
    resultTitle: "Nach dem Zurücksetzen",
    deleteAfterRestoreResult:
      "Der Datensatz kommt zurück in den Papierkorb, wo er vor der Wiederherstellung lag.",
    restoreResult:
      "Diese Änderung hat den Datensatz gelöscht. Beim Zurücksetzen wird er aus dem Papierkorb wiederhergestellt.",
    pendingTitle: "Ausstehende Änderungen sind nicht betroffen ({count})",
    pendingHint:
      "Sie gehören noch nicht zum aktuellen Stand des Datensatzes. Das Zurücksetzen lässt sie unverändert.",
    landsNow: "Wird sofort wirksam.",
    needsReview: "Wird zur Prüfung eingereicht und nach der Freigabe wirksam.",
    noPermission: "Zum Zurücksetzen brauchst du Bearbeitungsrechte für diesen Datensatz.",
    failedTitle: "Diese Änderung kann nicht zurückgesetzt werden",
    cancel: "Abbrechen",
    confirm: "Zurücksetzen",
    confirmReview: "Zur Prüfung einreichen",
    submitting: "Wird zurückgesetzt…",
    done: "Zurückgesetzt — der Datensatz hat wieder seinen früheren Stand.",
    submitted: "Zurücksetzung zur Prüfung eingereicht. Sie wird nach der Freigabe wirksam.",
    failed: "Zurücksetzen fehlgeschlagen. Bitte erneut versuchen.",
    reasonFieldDeleted:
      "Das Feld „{field}“ wurde nach diesen Änderungen gelöscht, daher kann sein früherer Wert nicht wiederhergestellt werden. Es wurde nichts geändert.",
    reasonFieldTypeChanged:
      "Das Feld „{field}“ wurde nach diesen Änderungen in einen anderen Typ umgewandelt, daher passt sein früherer Wert nicht mehr. Es wurde nichts geändert.",
    reasonRecordInTrash:
      "Dieser Datensatz liegt im Papierkorb. Stelle ihn zuerst wieder her oder setze auf den Stand vor der Löschung zurück.",
    reasonRestoreThenEdit:
      "Der Datensatz wurde nach der Wiederherstellung bearbeitet. Setze zuerst vor diese Bearbeitungen zurück, dann vor die Wiederherstellung.",
    reasonNothing:
      "Der Datensatz entspricht bereits seinem Stand vor dieser Änderung — es gibt nichts zurückzusetzen.",
    reasonNotMerged: "Nur wirksame Änderungen können zurückgesetzt werden.",
    reasonPlanChanged:
      "Der Datensatz hat sich nach dieser Vorschau geändert, daher wurde nichts eingereicht. Die Vorschau wurde aktualisiert — prüfe sie und bestätige erneut.",
  },
};
