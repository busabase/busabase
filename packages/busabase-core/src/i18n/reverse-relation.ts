// Strings for two-way relations (the reverse column on the other Base) and the
// record page's "Linked from" section. Kept in one module per feature, like `lookup.ts`.
export const reverseRelationEn = {
  readOnly: "Reverse link · read-only",
  editIn: "Edit it in {base}",
  editOnLinked: "Edit it on the linked records",
  linkedFrom: "References to this record",
  linkedFromGroup: "{base} · {field}",
  referencesHint: "These references are read-only here. Open a source record to edit its link.",
  openSource: "Go to source record: {record}",
  retry: "Retry",
  loadFailed: "Could not load the records that link here",
  showInBase: "Create a corresponding two-way relation field in {base}",
  columnNameInBase: "Column name in {base}",
  syncHint: "Both sides can be edited and always stay in sync.",
  oneWayHint:
    "Manage this link in {base} only. No corresponding field will be created in {target}; record details may still show source references.",
  shownInBaseAs: "Shown in {base} as “{field}”. Both sides can be edited and stay in sync.",
  otherSideOf: "The other side of {base} · {field}. Both sides can be edited and stay in sync.",
  forwardPending:
    "The link field is waiting for review. Once it is added, open its settings to show it in {base}.",
  createFailed: "The link field was added, but the column in {base} could not be created: {error}",
};

export const reverseRelationZhCN: typeof reverseRelationEn = {
  readOnly: "反向关联 · 只读",
  editIn: "在「{base}」中修改",
  editOnLinked: "请在关联的记录上修改",
  linkedFrom: "引用此记录",
  linkedFromGroup: "{base} · {field}",
  referencesHint: "这里只读展示来源引用。如需修改关联，请前往来源记录。",
  openSource: "前往来源记录：{record}",
  retry: "重试",
  loadFailed: "无法加载关联到此记录的记录",
  showInBase: "在「{base}」中创建对应的双向关联字段",
  columnNameInBase: "「{base}」里这一列的名称",
  syncHint: "两边都能编辑，改一边另一边自动同步。",
  oneWayHint:
    "仅在「{base}」中维护此关联，不会在「{target}」中创建对应字段；记录详情仍可显示来源引用。",
  shownInBaseAs: "已在「{base}」中显示为「{field}」。两边都能编辑，改一边另一边自动同步。",
  otherSideOf: "这是「{base} · {field}」的另一侧。两边都能编辑，改一边另一边自动同步。",
  forwardPending: "关联字段正在等待审核。添加成功后，打开它的字段设置即可在「{base}」中显示。",
  createFailed: "关联字段已添加，但没能在「{base}」中创建对应的列：{error}",
};

export const reverseRelationZhTW: typeof reverseRelationEn = {
  readOnly: "反向關聯 · 唯讀",
  editIn: "在「{base}」中修改",
  editOnLinked: "請在關聯的記錄上修改",
  linkedFrom: "引用此記錄",
  linkedFromGroup: "{base} · {field}",
  referencesHint: "這裡唯讀顯示來源引用。如需修改關聯，請前往來源記錄。",
  openSource: "前往來源記錄：{record}",
  retry: "重試",
  loadFailed: "無法載入關聯到此記錄的記錄",
  showInBase: "在「{base}」中建立對應的雙向關聯欄位",
  columnNameInBase: "「{base}」裡這一欄的名稱",
  syncHint: "兩邊都能編輯，改一邊另一邊自動同步。",
  oneWayHint:
    "僅在「{base}」中維護此關聯，不會在「{target}」中建立對應欄位；記錄詳情仍可顯示來源引用。",
  shownInBaseAs: "已在「{base}」中顯示為「{field}」。兩邊都能編輯，改一邊另一邊自動同步。",
  otherSideOf: "這是「{base} · {field}」的另一側。兩邊都能編輯，改一邊另一邊自動同步。",
  forwardPending: "關聯欄位正在等待審核。新增成功後，打開它的欄位設定即可在「{base}」中顯示。",
  createFailed: "關聯欄位已新增，但沒能在「{base}」中建立對應的欄：{error}",
};

export const reverseRelationDe: typeof reverseRelationEn = {
  readOnly: "Rückverknüpfung · schreibgeschützt",
  editIn: "In {base} bearbeiten",
  editOnLinked: "In den verknüpften Datensätzen bearbeiten",
  linkedFrom: "Verweise auf diesen Datensatz",
  linkedFromGroup: "{base} · {field}",
  referencesHint:
    "Diese Verweise sind hier schreibgeschützt. Öffnen Sie einen Quelldatensatz, um seine Verknüpfung zu bearbeiten.",
  openSource: "Zum Quelldatensatz: {record}",
  retry: "Erneut versuchen",
  loadFailed: "Verknüpfende Datensätze konnten nicht geladen werden",
  showInBase: "Entsprechendes bidirektionales Verknüpfungsfeld in {base} erstellen",
  columnNameInBase: "Spaltenname in {base}",
  syncHint: "Beide Seiten sind bearbeitbar und bleiben immer synchron.",
  oneWayHint:
    "Diese Verknüpfung nur in {base} verwalten. In {target} wird kein entsprechendes Feld erstellt; Datensatzdetails können weiterhin Quellverweise anzeigen.",
  shownInBaseAs:
    "Wird in {base} als „{field}“ angezeigt. Beide Seiten sind bearbeitbar und bleiben synchron.",
  otherSideOf:
    "Die andere Seite von {base} · {field}. Beide Seiten sind bearbeitbar und bleiben synchron.",
  forwardPending:
    "Das Verknüpfungsfeld wartet auf Prüfung. Sobald es hinzugefügt ist, öffnen Sie seine Einstellungen, um es in {base} anzuzeigen.",
  createFailed:
    "Das Verknüpfungsfeld wurde hinzugefügt, aber die Spalte in {base} konnte nicht erstellt werden: {error}",
};

export const reverseRelationEs: typeof reverseRelationEn = {
  readOnly: "Vínculo inverso · solo lectura",
  editIn: "Edítalo en {base}",
  editOnLinked: "Edítalo en los registros vinculados",
  linkedFrom: "Referencias a este registro",
  linkedFromGroup: "{base} · {field}",
  referencesHint:
    "Estas referencias son de solo lectura aquí. Abre un registro de origen para editar su vínculo.",
  openSource: "Ir al registro de origen: {record}",
  retry: "Reintentar",
  loadFailed: "No se pudieron cargar los registros que enlazan aquí",
  showInBase: "Crear un campo de relación bidireccional correspondiente en {base}",
  columnNameInBase: "Nombre de la columna en {base}",
  syncHint: "Ambos lados se pueden editar y siempre están sincronizados.",
  oneWayHint:
    "Gestiona este vínculo solo en {base}. No se creará un campo correspondiente en {target}; los detalles del registro aún pueden mostrar referencias de origen.",
  shownInBaseAs:
    "Se muestra en {base} como «{field}». Ambos lados se pueden editar y se mantienen sincronizados.",
  otherSideOf:
    "El otro lado de {base} · {field}. Ambos lados se pueden editar y se mantienen sincronizados.",
  forwardPending:
    "El campo de vínculo está pendiente de revisión. Cuando se agregue, abre su configuración para mostrarlo en {base}.",
  createFailed:
    "Se agregó el campo de vínculo, pero no se pudo crear la columna en {base}: {error}",
};

export const reverseRelationFr: typeof reverseRelationEn = {
  readOnly: "Lien inverse · lecture seule",
  editIn: "Modifiez-le dans {base}",
  editOnLinked: "Modifiez-le dans les enregistrements liés",
  linkedFrom: "Références à cet enregistrement",
  linkedFromGroup: "{base} · {field}",
  referencesHint:
    "Ces références sont en lecture seule ici. Ouvrez un enregistrement source pour modifier son lien.",
  openSource: "Accéder à l’enregistrement source : {record}",
  retry: "Réessayer",
  loadFailed: "Impossible de charger les enregistrements qui pointent ici",
  showInBase: "Créer un champ de relation bidirectionnelle correspondant dans {base}",
  columnNameInBase: "Nom de la colonne dans {base}",
  syncHint: "Les deux côtés sont modifiables et restent toujours synchronisés.",
  oneWayHint:
    "Gérez ce lien uniquement dans {base}. Aucun champ correspondant ne sera créé dans {target} ; les détails peuvent toujours afficher les références sources.",
  shownInBaseAs:
    "Affiché dans {base} sous « {field} ». Les deux côtés sont modifiables et restent synchronisés.",
  otherSideOf:
    "L’autre côté de {base} · {field}. Les deux côtés sont modifiables et restent synchronisés.",
  forwardPending:
    "Le champ de lien attend une revue. Une fois ajouté, ouvrez ses paramètres pour l’afficher dans {base}.",
  createFailed:
    "Le champ de lien a été ajouté, mais la colonne dans {base} n’a pas pu être créée : {error}",
};

export const reverseRelationJa: typeof reverseRelationEn = {
  readOnly: "逆方向リンク · 読み取り専用",
  editIn: "「{base}」で編集してください",
  editOnLinked: "リンク元のレコードで編集してください",
  linkedFrom: "このレコードへの参照",
  linkedFromGroup: "{base} · {field}",
  referencesHint:
    "ここでの参照は読み取り専用です。リンクを編集するには参照元のレコードを開いてください。",
  openSource: "参照元のレコードを開く：{record}",
  retry: "再試行",
  loadFailed: "このレコードにリンクしているレコードを読み込めませんでした",
  showInBase: "「{base}」に対応する双方向リレーションフィールドを作成",
  columnNameInBase: "「{base}」での列名",
  syncHint: "どちら側からでも編集でき、常に同期されます。",
  oneWayHint:
    "このリンクは「{base}」のみで管理します。「{target}」に対応するフィールドは作成されませんが、レコードの詳細には参照元が表示される場合があります。",
  shownInBaseAs:
    "「{base}」に「{field}」として表示されています。どちら側からでも編集でき、同期されます。",
  otherSideOf: "「{base} · {field}」の反対側です。どちら側からでも編集でき、同期されます。",
  forwardPending:
    "リンクフィールドはレビュー待ちです。追加された後、フィールド設定を開くと「{base}」に表示できます。",
  createFailed: "リンクフィールドは追加されましたが、「{base}」に列を作成できませんでした：{error}",
};

export const reverseRelationKo: typeof reverseRelationEn = {
  readOnly: "역방향 연결 · 읽기 전용",
  editIn: "{base}에서 수정하세요",
  editOnLinked: "연결된 레코드에서 수정하세요",
  linkedFrom: "이 레코드에 대한 참조",
  linkedFromGroup: "{base} · {field}",
  referencesHint: "여기의 참조는 읽기 전용입니다. 연결을 편집하려면 원본 레코드를 여세요.",
  openSource: "원본 레코드로 이동: {record}",
  retry: "다시 시도",
  loadFailed: "이 레코드를 연결한 레코드를 불러오지 못했습니다",
  showInBase: "{base}에 대응하는 양방향 관계 필드 만들기",
  columnNameInBase: "{base}의 열 이름",
  syncHint: "양쪽 모두 편집할 수 있고 항상 동기화됩니다.",
  oneWayHint:
    "이 연결은 {base}에서만 관리합니다. {target}에 대응하는 필드는 생성되지 않지만 레코드 세부 정보에는 원본 참조가 표시될 수 있습니다.",
  shownInBaseAs: "{base}에 “{field}”(으)로 표시됩니다. 양쪽 모두 편집할 수 있고 동기화됩니다.",
  otherSideOf: "{base} · {field}의 반대쪽입니다. 양쪽 모두 편집할 수 있고 동기화됩니다.",
  forwardPending:
    "연결 필드가 검토를 기다리고 있습니다. 추가된 후 필드 설정을 열어 {base}에 표시하세요.",
  createFailed: "연결 필드는 추가되었지만 {base}에 열을 만들지 못했습니다: {error}",
};

export const reverseRelationPt: typeof reverseRelationEn = {
  readOnly: "Vínculo inverso · somente leitura",
  editIn: "Edite em {base}",
  editOnLinked: "Edite nos registros vinculados",
  linkedFrom: "Referências a este registro",
  linkedFromGroup: "{base} · {field}",
  referencesHint:
    "Estas referências são somente leitura aqui. Abra um registro de origem para editar seu vínculo.",
  openSource: "Ir para o registro de origem: {record}",
  retry: "Tentar novamente",
  loadFailed: "Não foi possível carregar os registros que apontam para cá",
  showInBase: "Criar um campo de relação bidirecional correspondente em {base}",
  columnNameInBase: "Nome da coluna em {base}",
  syncHint: "Os dois lados podem ser editados e ficam sempre sincronizados.",
  oneWayHint:
    "Gerencie este vínculo somente em {base}. Nenhum campo correspondente será criado em {target}; os detalhes do registro ainda podem mostrar referências de origem.",
  shownInBaseAs:
    "Exibido em {base} como “{field}”. Os dois lados podem ser editados e ficam sincronizados.",
  otherSideOf:
    "O outro lado de {base} · {field}. Os dois lados podem ser editados e ficam sincronizados.",
  forwardPending:
    "O campo de vínculo está aguardando revisão. Depois de adicionado, abra as configurações dele para exibi-lo em {base}.",
  createFailed:
    "O campo de vínculo foi adicionado, mas não foi possível criar a coluna em {base}: {error}",
};

export const reverseRelationVi: typeof reverseRelationEn = {
  readOnly: "Liên kết ngược · chỉ đọc",
  editIn: "Chỉnh sửa trong {base}",
  editOnLinked: "Chỉnh sửa trên các bản ghi được liên kết",
  linkedFrom: "Tham chiếu đến bản ghi này",
  linkedFromGroup: "{base} · {field}",
  referencesHint: "Các tham chiếu ở đây chỉ để đọc. Mở bản ghi nguồn để chỉnh sửa liên kết.",
  openSource: "Đi đến bản ghi nguồn: {record}",
  retry: "Thử lại",
  loadFailed: "Không thể tải các bản ghi liên kết tới đây",
  showInBase: "Tạo trường quan hệ hai chiều tương ứng trong {base}",
  columnNameInBase: "Tên cột trong {base}",
  syncHint: "Cả hai bên đều chỉnh sửa được và luôn đồng bộ.",
  oneWayHint:
    "Chỉ quản lý liên kết này trong {base}. Không tạo trường tương ứng trong {target}; chi tiết bản ghi vẫn có thể hiển thị tham chiếu nguồn.",
  shownInBaseAs:
    "Đang hiển thị trong {base} với tên “{field}”. Cả hai bên đều chỉnh sửa được và luôn đồng bộ.",
  otherSideOf: "Phía bên kia của {base} · {field}. Cả hai bên đều chỉnh sửa được và luôn đồng bộ.",
  forwardPending:
    "Trường liên kết đang chờ duyệt. Sau khi được thêm, mở cài đặt của trường để hiển thị nó trong {base}.",
  createFailed: "Đã thêm trường liên kết nhưng không tạo được cột trong {base}: {error}",
};
