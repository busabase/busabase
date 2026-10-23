// Strings for read-only reverse relation columns and the record page's
// "Linked from" section. Kept in one module per feature, like `lookup.ts`.
export const reverseRelationEn = {
  readOnly: "Reverse link · read-only",
  editIn: "Edit it in {base}",
  editOnLinked: "Edit it on the linked records",
  linkedFrom: "Linked from",
  linkedFromGroup: "{base} · {field}",
  loadFailed: "Could not load the records that link here",
};

export const reverseRelationZhCN: typeof reverseRelationEn = {
  readOnly: "反向关联 · 只读",
  editIn: "在「{base}」中修改",
  editOnLinked: "请在关联的记录上修改",
  linkedFrom: "被以下记录关联",
  linkedFromGroup: "{base} · {field}",
  loadFailed: "无法加载关联到此记录的记录",
};

export const reverseRelationZhTW: typeof reverseRelationEn = {
  readOnly: "反向關聯 · 唯讀",
  editIn: "在「{base}」中修改",
  editOnLinked: "請在關聯的記錄上修改",
  linkedFrom: "被以下記錄關聯",
  linkedFromGroup: "{base} · {field}",
  loadFailed: "無法載入關聯到此記錄的記錄",
};

export const reverseRelationDe: typeof reverseRelationEn = {
  readOnly: "Rückverknüpfung · schreibgeschützt",
  editIn: "In {base} bearbeiten",
  editOnLinked: "In den verknüpften Datensätzen bearbeiten",
  linkedFrom: "Verknüpft von",
  linkedFromGroup: "{base} · {field}",
  loadFailed: "Verknüpfende Datensätze konnten nicht geladen werden",
};

export const reverseRelationEs: typeof reverseRelationEn = {
  readOnly: "Vínculo inverso · solo lectura",
  editIn: "Edítalo en {base}",
  editOnLinked: "Edítalo en los registros vinculados",
  linkedFrom: "Vinculado desde",
  linkedFromGroup: "{base} · {field}",
  loadFailed: "No se pudieron cargar los registros que enlazan aquí",
};

export const reverseRelationFr: typeof reverseRelationEn = {
  readOnly: "Lien inverse · lecture seule",
  editIn: "Modifiez-le dans {base}",
  editOnLinked: "Modifiez-le dans les enregistrements liés",
  linkedFrom: "Lié depuis",
  linkedFromGroup: "{base} · {field}",
  loadFailed: "Impossible de charger les enregistrements qui pointent ici",
};

export const reverseRelationJa: typeof reverseRelationEn = {
  readOnly: "逆方向リンク · 読み取り専用",
  editIn: "「{base}」で編集してください",
  editOnLinked: "リンク元のレコードで編集してください",
  linkedFrom: "リンク元",
  linkedFromGroup: "{base} · {field}",
  loadFailed: "このレコードにリンクしているレコードを読み込めませんでした",
};

export const reverseRelationKo: typeof reverseRelationEn = {
  readOnly: "역방향 연결 · 읽기 전용",
  editIn: "{base}에서 수정하세요",
  editOnLinked: "연결된 레코드에서 수정하세요",
  linkedFrom: "이 레코드를 연결한 레코드",
  linkedFromGroup: "{base} · {field}",
  loadFailed: "이 레코드를 연결한 레코드를 불러오지 못했습니다",
};

export const reverseRelationPt: typeof reverseRelationEn = {
  readOnly: "Vínculo inverso · somente leitura",
  editIn: "Edite em {base}",
  editOnLinked: "Edite nos registros vinculados",
  linkedFrom: "Vinculado a partir de",
  linkedFromGroup: "{base} · {field}",
  loadFailed: "Não foi possível carregar os registros que apontam para cá",
};

export const reverseRelationVi: typeof reverseRelationEn = {
  readOnly: "Liên kết ngược · chỉ đọc",
  editIn: "Chỉnh sửa trong {base}",
  editOnLinked: "Chỉnh sửa trên các bản ghi được liên kết",
  linkedFrom: "Được liên kết từ",
  linkedFromGroup: "{base} · {field}",
  loadFailed: "Không thể tải các bản ghi liên kết tới đây",
};
