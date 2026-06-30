import type { BaseFieldVO, BaseVO, FieldType, RecordVO, ViewVO } from "busabase-contract/types";
import { RotateCcw } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useState } from "react";
import { isDerivedFieldSlug } from "../helpers/change-request";
import { createDefaultFieldOptions, fieldTypeOptions } from "../helpers/field";
import type {
  CreateBaseFieldPayload,
  ViewFormPayload,
  ViewSubmitOptions,
} from "../helpers/view-types";
import { applyViewConfigToRecords, BusaBaseTable } from "./base-table";
import { EmptyState, PropertyRow, SidebarPanel } from "./primitives";
import { SplitSubmitButton } from "./split-submit-button";

export function BaseDetailView({
  activeView,
  archivedViews = [],
  archivedRecords = [],
  records,
  base,
  onCreateView,
  onDeleteView,
  onRestoreView,
  onRestoreRecord,
  onUpdateView,
  views,
}: {
  activeView: ViewVO | null;
  archivedViews?: ViewVO[];
  archivedRecords?: RecordVO[];
  records: RecordVO[];
  base: BaseVO | null;
  onCreateView: (
    base: BaseVO,
    payload: ViewFormPayload,
    options?: ViewSubmitOptions,
  ) => Promise<void>;
  onDeleteView: (view: ViewVO) => Promise<void>;
  onRestoreView?: (view: ViewVO) => Promise<void>;
  onRestoreRecord?: (record: RecordVO) => Promise<void>;
  onUpdateView: (
    view: ViewVO,
    payload: ViewFormPayload,
    options?: ViewSubmitOptions,
  ) => Promise<void>;
  views: ViewVO[];
}) {
  const baseViews = views.filter((view) => view.baseId === base?.id);
  const baseArchivedViews = archivedViews.filter((view) => view.baseId === base?.id);
  const baseArchivedRecords = archivedRecords.filter((record) => record.baseId === base?.id);
  const filteredRecords = applyViewConfigToRecords(
    records.filter((record) => record.baseId === base?.id),
    activeView?.config,
  );
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <section>
        <BaseDetailHeader base={base} />
        <div className="px-6 py-5">
          <BusaBaseTable
            activeView={activeView}
            archivedViews={baseArchivedViews}
            archivedRecords={baseArchivedRecords}
            base={base}
            onCreateView={onCreateView}
            onDeleteView={onDeleteView}
            onRestoreView={onRestoreView}
            onRestoreRecord={onRestoreRecord}
            onUpdateView={onUpdateView}
            records={filteredRecords}
            relationRecords={records}
            views={baseViews}
          />
        </div>
      </section>
    </div>
  );
}

export function BaseSetupView({
  base,
  bases,
  deletedFields = [],
  onCreateField,
  onRenameBase,
  onRestoreField,
}: {
  base: BaseVO | null;
  bases: BaseVO[];
  deletedFields?: BaseFieldVO[];
  onCreateField: (
    base: BaseVO,
    payload: CreateBaseFieldPayload,
    options?: { mergeImmediately?: boolean },
  ) => Promise<void>;
  onRenameBase: (
    base: BaseVO,
    payload: { name: string; description: string },
    options?: { mergeImmediately?: boolean },
  ) => Promise<void>;
  onRestoreField?: (base: BaseVO, fieldId: string) => Promise<void>;
}) {
  const [baseName, setBaseName] = useState(base?.name ?? "");
  const [baseDescription, setBaseDescription] = useState(base?.description ?? "");
  const [isRenameSaving, setIsRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [fieldName, setFieldName] = useState("");
  const [fieldSlug, setFieldSlug] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [targetBaseId, setTargetBaseId] = useState("");
  const [codeLanguage, setCodeLanguage] = useState("text");
  const [numberFormat, setNumberFormat] = useState<"plain" | "currency">("plain");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [isRequired, setIsRequired] = useState(false);
  const [isMultiple, setIsMultiple] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorDetail, setFormErrorDetail] = useState<{
    recordIds?: string[];
    removedChoiceIds?: string[];
    affectedRecordIds?: string[];
  } | null>(null);
  const [restoringFieldId, setRestoringFieldId] = useState<string | null>(null);

  if (!base) {
    return (
      <div className="flex-1 p-4">
        <section>
          <EmptyState title="Base not found" body="The requested Base does not exist." />
        </section>
      </div>
    );
  }

  const submitRename = async (options?: { mergeImmediately?: boolean }) => {
    const name = baseName.trim();
    if (!name) {
      setRenameError("Base name is required.");
      return;
    }
    setIsRenameSaving(true);
    setRenameError(null);
    try {
      await onRenameBase(base, { name, description: baseDescription.trim() }, options);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Failed to rename base");
    } finally {
      setIsRenameSaving(false);
    }
  };

  const submit = async (options?: { mergeImmediately?: boolean }) => {
    const name = fieldName.trim();
    const slug = fieldSlug.trim();
    if (!name || !slug) {
      setFormError("Field name and slug are required.");
      return;
    }
    if (fieldType === "relation" && !targetBaseId) {
      setFormError("Relation fields need a target Base.");
      return;
    }

    setIsSaving(true);
    setFormError(null);
    setFormErrorDetail(null);
    try {
      await onCreateField(
        base,
        {
          name,
          options:
            fieldType === "code"
              ? { code: { language: codeLanguage || "text" } }
              : fieldType === "number" && numberFormat === "currency"
                ? { number: { format: "currency", currency: currencyCode.trim() || "USD" } }
                : createDefaultFieldOptions(fieldType, targetBaseId, isMultiple),
          required: isRequired,
          slug,
          type: fieldType,
        },
        options,
      );
      setFieldName("");
      setFieldSlug("");
      setFieldType("text");
      setTargetBaseId("");
      setCodeLanguage("text");
      setNumberFormat("plain");
      setCurrencyCode("USD");
      setIsRequired(false);
      setIsMultiple(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to add field";
      setFormError(msg);
      // Surface structured error detail if the server returned record/choice ids.
      if (error && typeof error === "object" && "data" in error) {
        const data = (error as { data?: unknown }).data;
        if (data && typeof data === "object") {
          setFormErrorDetail(data as typeof formErrorDetail);
        }
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestoreField = async (fieldId: string) => {
    if (!base || !onRestoreField) return;
    setRestoringFieldId(fieldId);
    try {
      await onRestoreField(base, fieldId);
    } finally {
      setRestoringFieldId(null);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <section>
        <BaseDetailHeader base={base} />
        <div className="grid gap-6 px-6 py-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-6">
            <div>
              <div className="font-semibold text-sm">Base Info</div>
              <div className="mt-3 grid gap-3">
                <label className="block">
                  <span className="text-muted-foreground text-xs">Name</span>
                  <input
                    className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
                    onChange={(event) => setBaseName(event.target.value)}
                    value={baseName}
                  />
                </label>
                <label className="block">
                  <span className="text-muted-foreground text-xs">Description</span>
                  <textarea
                    className="mt-1 w-full rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary resize-none"
                    onChange={(event) => setBaseDescription(event.target.value)}
                    rows={2}
                    value={baseDescription}
                  />
                </label>
              </div>
              <div className="mt-3 flex justify-end border-border/50 border-t pt-3">
                <SplitSubmitButton
                  disabled={isRenameSaving}
                  isPrimaryLoading={isRenameSaving}
                  primaryLabel="Request Rename"
                  primaryLoadingLabel="Submitting..."
                  secondaryLabel="Rename Now"
                  secondaryLoadingLabel="Renaming..."
                  onPrimary={() => submitRename()}
                  onSecondary={() => submitRename({ mergeImmediately: true })}
                  hint="Request goes to your inbox for review. Now writes directly."
                />
              </div>
              {renameError ? <div className="mt-2 text-red-700 text-sm">{renameError}</div> : null}
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                <div className="font-semibold text-sm">Fields</div>
                <span className="rounded-full bg-muted/55 px-2.5 py-1 text-muted-foreground text-xs">
                  {base.fields.length} fields
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_120px_84px_64px] gap-3 border-border/50 border-b px-2 py-2 text-muted-foreground text-xs">
                <div>Name</div>
                <div>Type</div>
                <div>Required</div>
                <div>Order</div>
              </div>
              {base.fields.map((field) => (
                <div
                  className="grid min-h-12 grid-cols-[minmax(0,1fr)_120px_84px_64px] items-center gap-3 rounded-md border-border/40 border-b px-2 py-2 text-sm transition-colors hover:bg-muted/35"
                  key={field.id}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{field.name}</div>
                    {isDerivedFieldSlug(field.name, field.slug) ? null : (
                      <div className="mt-0.5 truncate font-mono text-muted-foreground text-xs">
                        {field.slug}
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="inline-flex max-w-full truncate rounded-full bg-muted/65 px-2 py-0.5 text-muted-foreground text-xs">
                      {field.type}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {field.required ? "Required" : "-"}
                  </div>
                  <div className="font-mono text-muted-foreground text-xs">{field.position}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="font-semibold text-sm">Add Field</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-muted-foreground text-xs">Name</span>
                  <input
                    className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
                    onChange={(event) => {
                      setFieldName(event.target.value);
                      if (!fieldSlug) {
                        setFieldSlug(
                          event.target.value
                            .trim()
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/^-|-$/g, ""),
                        );
                      }
                    }}
                    value={fieldName}
                  />
                </label>
                <label className="block">
                  <span className="text-muted-foreground text-xs">Slug</span>
                  <input
                    className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 font-mono text-sm outline-none transition-colors focus:border-primary"
                    onChange={(event) => setFieldSlug(event.target.value)}
                    value={fieldSlug}
                  />
                </label>
                <label className="block">
                  <span className="text-muted-foreground text-xs">Type</span>
                  <select
                    className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
                    onChange={(event) => setFieldType(event.target.value as FieldType)}
                    value={fieldType}
                  >
                    {fieldTypeOptions.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                {fieldType === "code" ? (
                  <label className="block">
                    <span className="text-muted-foreground text-xs">Language</span>
                    <select
                      className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 font-mono text-sm outline-none transition-colors focus:border-primary"
                      onChange={(event) => setCodeLanguage(event.target.value)}
                      value={codeLanguage}
                    >
                      {[
                        "text",
                        "json",
                        "yaml",
                        "typescript",
                        "javascript",
                        "python",
                        "sql",
                        "bash",
                        "markdown",
                        "html",
                        "css",
                        "toml",
                        "xml",
                        "dockerfile",
                        "nginx",
                      ].map((lang) => (
                        <option key={lang} value={lang}>
                          {lang}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {fieldType === "relation" ? (
                  <label className="block">
                    <span className="text-muted-foreground text-xs">Target Base</span>
                    <select
                      className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
                      onChange={(event) => setTargetBaseId(event.target.value)}
                      value={targetBaseId}
                    >
                      <option value="">Select Base</option>
                      {bases.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {fieldType === "number" ? (
                  <label className="block">
                    <span className="text-muted-foreground text-xs">Format</span>
                    <select
                      className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
                      onChange={(event) =>
                        setNumberFormat(event.target.value as "plain" | "currency")
                      }
                      value={numberFormat}
                    >
                      <option value="plain">Plain number</option>
                      <option value="currency">Currency</option>
                    </select>
                  </label>
                ) : null}
                {fieldType === "number" && numberFormat === "currency" ? (
                  <label className="block">
                    <span className="text-muted-foreground text-xs">Currency</span>
                    <select
                      className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
                      onChange={(event) => setCurrencyCode(event.target.value)}
                      value={currencyCode}
                    >
                      {["USD", "EUR", "GBP", "JPY", "CNY", "HKD", "AUD", "CAD", "SGD", "INR"].map(
                        (code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-border/50 border-t pt-3">
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="inline-flex items-center gap-2 text-muted-foreground">
                    <input
                      checked={isRequired}
                      onChange={(event) => setIsRequired(event.target.checked)}
                      type="checkbox"
                    />
                    Required
                  </label>
                  {fieldType === "relation" ? (
                    <label className="inline-flex items-center gap-2 text-muted-foreground">
                      <input
                        checked={isMultiple}
                        onChange={(event) => setIsMultiple(event.target.checked)}
                        type="checkbox"
                      />
                      Multiple
                    </label>
                  ) : null}
                </div>
                <SplitSubmitButton
                  disabled={isSaving}
                  isPrimaryLoading={isSaving}
                  primaryLabel="Add Field Request"
                  primaryLoadingLabel="Submitting..."
                  secondaryLabel="Add Field Now"
                  secondaryLoadingLabel="Adding..."
                  onPrimary={() => submit()}
                  onSecondary={() => submit({ mergeImmediately: true })}
                  hint="Request goes to your inbox for review. Now writes directly."
                />
              </div>
              {formError ? (
                <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3">
                  <div className="text-red-700 text-sm">{formError}</div>
                  {formErrorDetail?.recordIds && formErrorDetail.recordIds.length > 0 ? (
                    <div className="mt-2">
                      <div className="mb-1 text-red-600 text-xs font-medium">
                        Records missing a value ({formErrorDetail.recordIds.length}):
                      </div>
                      <div className="space-y-0.5">
                        {formErrorDetail.recordIds.slice(0, 8).map((rid) => (
                          <div key={rid} className="font-mono text-red-600 text-xs">
                            {rid}
                          </div>
                        ))}
                        {formErrorDetail.recordIds.length > 8 ? (
                          <div className="text-red-500 text-xs">
                            …and {formErrorDetail.recordIds.length - 8} more
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {formErrorDetail?.affectedRecordIds &&
                  formErrorDetail.affectedRecordIds.length > 0 ? (
                    <div className="mt-2">
                      <div className="mb-1 text-red-600 text-xs font-medium">
                        Records referencing removed choices (
                        {formErrorDetail.affectedRecordIds.length}):
                      </div>
                      <div className="space-y-0.5">
                        {formErrorDetail.affectedRecordIds.slice(0, 8).map((rid) => (
                          <div key={rid} className="font-mono text-red-600 text-xs">
                            {rid}
                          </div>
                        ))}
                        {formErrorDetail.affectedRecordIds.length > 8 ? (
                          <div className="text-red-500 text-xs">
                            …and {formErrorDetail.affectedRecordIds.length - 8} more
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {deletedFields.length > 0 ? (
              <div>
                <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                  <div className="font-semibold text-sm">Deleted Fields</div>
                  <span className="rounded-full bg-muted/55 px-2.5 py-1 text-muted-foreground text-xs">
                    {deletedFields.length} deleted
                  </span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_120px_80px] gap-3 border-border/50 border-b px-2 py-2 text-muted-foreground text-xs">
                  <div>Name</div>
                  <div>Type</div>
                  <div />
                </div>
                {deletedFields.map((field) => (
                  <div
                    className="grid min-h-12 grid-cols-[minmax(0,1fr)_120px_80px] items-center gap-3 rounded-md border-border/40 border-b px-2 py-2 text-sm"
                    key={field.id}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-muted-foreground">{field.name}</div>
                      <div className="mt-0.5 truncate font-mono text-muted-foreground text-xs">
                        {field.slug}
                      </div>
                    </div>
                    <div>
                      <span className="inline-flex max-w-full truncate rounded-full bg-muted/65 px-2 py-0.5 text-muted-foreground text-xs">
                        {field.type}
                      </span>
                    </div>
                    <div className="flex justify-end">
                      <button
                        className="inline-flex items-center gap-1 rounded border border-border/60 bg-background px-2 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-50"
                        disabled={restoringFieldId === field.id || !onRestoreField}
                        onClick={() => handleRestoreField(field.id)}
                        type="button"
                      >
                        <RotateCcw className="size-3" />
                        {restoringFieldId === field.id ? "…" : "Restore"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <aside className="space-y-3">
            <SidebarPanel title="Schema">
              <PropertyRow label="Slug" value={base.slug} />
              <PropertyRow label="Fields" value={`${base.fields.length}`} />
              <PropertyRow
                label="Review"
                value={`${base.reviewPolicy.requiredApprovals} approval required`}
              />
              <PropertyRow label="Created" value={new Date(base.createdAt).toLocaleString()} />
            </SidebarPanel>
          </aside>
        </div>
      </section>
    </div>
  );
}

function BaseDetailHeader({ base }: { base: BaseVO | null }) {
  return (
    <div className="px-6 pt-5 pb-2">
      <div className="min-w-0">
        <h1 className="truncate font-semibold text-base">{base?.name ?? "Base"}</h1>
        {base?.description ? (
          <p className="mt-1 truncate text-muted-foreground text-xs">{base.description}</p>
        ) : null}
      </div>
    </div>
  );
}

// Top bar holds only the page-level mode switch (Records / Design). The primary
// "New record" action lives in the records toolbar, right above the table.
export function BaseTopbarActions({
  activeTab,
  base,
}: {
  activeTab: "records" | "design";
  base: BaseVO;
}) {
  return (
    <nav className="flex rounded-md bg-muted/60 p-0.5 text-xs">
      <Link
        className={`rounded px-2.5 py-1.5 font-medium transition-colors ${
          activeTab === "records"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
        href={`/base/${base.slug}`}
      >
        Records
      </Link>
      <Link
        className={`rounded px-2.5 py-1.5 font-medium transition-colors ${
          activeTab === "design"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
        href={`/base/${base.slug}/design`}
      >
        Design
      </Link>
    </nav>
  );
}
