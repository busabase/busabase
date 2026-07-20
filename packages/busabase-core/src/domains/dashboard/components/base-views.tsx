import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseFieldVO, BaseVO, FieldType, RecordVO, ViewVO } from "busabase-contract/types";
import { Pencil, RotateCcw } from "lucide-react";
import { type iString, iStringIsEmpty, iStringParse, iStringTrim } from "openlib/i18n/i-string";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useRef, useState } from "react";
import { useSearch } from "wouter";
import { fmt, useCoreI18n, useIString } from "../../../i18n";
import { isDerivedFieldSlug } from "../helpers/change-request";
import { createDefaultFieldOptions, fieldTypeOptions } from "../helpers/field";
import { mergeSearchIntoHref } from "../helpers/link-search";
import type {
  CreateBaseFieldPayload,
  RecordsPagination,
  ViewFormPayload,
  ViewSubmitOptions,
} from "../helpers/view-types";
import { applyViewConfigToRecords, BusaBaseTable } from "./base-table";
import { IStringNameInput } from "./i-string-input";
import { NodeDeleteButton } from "./node-detail-views";
import { NodePermissionsButton } from "./node-permissions-button";
import { EmptyState, PropertyRow, SidebarPanel } from "./primitives";
import { SplitSubmitButton } from "./split-submit-button";

export function BaseDetailView({
  activeView,
  archivedViews = [],
  archivedRecords = [],
  archivedPagination,
  records,
  orderedRecords,
  orpc,
  pagination,
  base,
  onCreateView,
  onDeleteView,
  onRestoreView,
  onRestoreRecord,
  onMoveRecord,
  onPatchRecord,
  onUpdateView,
  views,
}: {
  activeView: ViewVO | null;
  archivedViews?: ViewVO[];
  archivedRecords?: RecordVO[];
  archivedPagination?: { hasMore: boolean; isLoadingMore: boolean; loadMore: () => void };
  records: RecordVO[];
  /**
   * When the active view's sort was pushed to the server, these are the rows in
   * the authoritative server order — use them directly (no client re-sort) so
   * paging shows correct order without loading the whole base.
   */
  orderedRecords?: RecordVO[];
  /** Wired through to the header's delete-to-Trash button (NodeDeleteButton). */
  orpc: BusabaseQueryUtils;
  pagination?: RecordsPagination;
  base: BaseVO | null;
  onCreateView: (
    base: BaseVO,
    payload: ViewFormPayload,
    options?: ViewSubmitOptions,
  ) => Promise<void>;
  onDeleteView: (view: ViewVO) => Promise<void>;
  onRestoreView?: (view: ViewVO) => Promise<void>;
  onRestoreRecord?: (record: RecordVO) => Promise<void>;
  onMoveRecord?: (record: RecordVO, fieldSlug: string, value: string | null) => Promise<void>;
  onPatchRecord?: (record: RecordVO, patch: Record<string, unknown>) => Promise<void>;
  onUpdateView: (
    view: ViewVO,
    payload: ViewFormPayload,
    options?: ViewSubmitOptions,
  ) => Promise<void>;
  views: ViewVO[];
}) {
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const baseViews = views.filter((view) => view.baseId === base?.id);
  const baseArchivedViews = archivedViews.filter((view) => view.baseId === base?.id);
  const baseArchivedRecords = archivedRecords.filter((record) => record.baseId === base?.id);
  // `orderedRecords` (server-sorted) is authoritative when present — skip the
  // client filter/sort so we don't reorder the server's paginated order.
  const filteredRecords = orderedRecords
    ? orderedRecords.filter((record) => record.baseId === base?.id)
    : applyViewConfigToRecords(
        records.filter((record) => record.baseId === base?.id),
        activeView?.config,
      );
  return (
    <div
      className="h-full min-h-0 w-full min-w-0 flex-1 overflow-auto"
      data-base-detail-scroll
      ref={scrollElementRef}
    >
      <section>
        <BaseDetailHeader base={base} orpc={orpc} />
        <div className="px-6 py-5">
          <BusaBaseTable
            activeView={activeView}
            archivedViews={baseArchivedViews}
            archivedRecords={baseArchivedRecords}
            archivedPagination={archivedPagination}
            base={base}
            onCreateView={onCreateView}
            onDeleteView={onDeleteView}
            onRestoreView={onRestoreView}
            onRestoreRecord={onRestoreRecord}
            onMoveRecord={onMoveRecord}
            onPatchRecord={onPatchRecord}
            onUpdateView={onUpdateView}
            records={filteredRecords}
            relationRecords={records}
            pagination={pagination}
            scrollElementRef={scrollElementRef}
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
  orpc,
  onCreateField,
  onRenameBase,
  onRestoreField,
  onUpdateFieldName,
}: {
  base: BaseVO | null;
  bases: BaseVO[];
  deletedFields?: BaseFieldVO[];
  /** Wired through to the header's delete-to-Trash button (NodeDeleteButton). */
  orpc: BusabaseQueryUtils;
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
  onUpdateFieldName?: (
    base: BaseVO,
    fieldId: string,
    name: iString,
    options?: { mergeImmediately?: boolean },
  ) => Promise<void>;
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const [baseName, setBaseName] = useState(base?.name ?? "");
  const [baseDescription, setBaseDescription] = useState(base?.description ?? "");
  const [isRenameSaving, setIsRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [fieldName, setFieldName] = useState<iString>("");
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
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editingFieldName, setEditingFieldName] = useState<iString>("");
  const [isFieldRenameSaving, setIsFieldRenameSaving] = useState(false);
  const [fieldRenameError, setFieldRenameError] = useState<string | null>(null);

  if (!base) {
    return (
      <div className="flex-1 p-4">
        <section>
          <EmptyState
            title={messages.base.baseNotFoundTitle}
            body={messages.base.baseNotFoundBody}
          />
        </section>
      </div>
    );
  }

  const submitRename = async (options?: { mergeImmediately?: boolean }) => {
    const name = baseName.trim();
    if (!name) {
      setRenameError(messages.base.baseNameRequired);
      return;
    }
    setIsRenameSaving(true);
    setRenameError(null);
    try {
      await onRenameBase(base, { name, description: baseDescription.trim() }, options);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : messages.base.failedRenameBase);
    } finally {
      setIsRenameSaving(false);
    }
  };

  const submit = async (options?: { mergeImmediately?: boolean }) => {
    const name = iStringTrim(fieldName);
    const slug = fieldSlug.trim();
    if (iStringIsEmpty(name) || !slug) {
      setFormError(messages.base.fieldNameSlugRequired);
      return;
    }
    if (fieldType === "relation" && !targetBaseId) {
      setFormError(messages.base.relationTargetRequired);
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
      const msg = error instanceof Error ? error.message : messages.base.failedAddField;
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

  const submitFieldRename = async (fieldId: string, options?: { mergeImmediately?: boolean }) => {
    if (!base || !onUpdateFieldName) return;
    const name = iStringTrim(editingFieldName);
    if (iStringIsEmpty(name)) {
      setFieldRenameError("Field name is required.");
      return;
    }
    setIsFieldRenameSaving(true);
    setFieldRenameError(null);
    try {
      await onUpdateFieldName(base, fieldId, name, options);
      setEditingFieldId(null);
    } catch (error) {
      setFieldRenameError(error instanceof Error ? error.message : "Failed to rename field");
    } finally {
      setIsFieldRenameSaving(false);
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
    <div
      className="h-full min-h-0 w-full min-w-0 flex-1 overflow-auto"
      data-dashboard-scroll="base-design"
    >
      <section>
        <BaseDetailHeader base={base} orpc={orpc} />
        <div className="grid gap-6 px-6 py-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-6">
            <div>
              <div className="font-semibold text-sm">{messages.base.baseInfo}</div>
              <div className="mt-3 grid gap-3">
                <label className="block">
                  <span className="text-muted-foreground text-xs">{messages.common.name}</span>
                  <input
                    className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
                    onChange={(event) => setBaseName(event.target.value)}
                    value={baseName}
                  />
                </label>
                <label className="block">
                  <span className="text-muted-foreground text-xs">
                    {messages.common.description}
                  </span>
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
                  primaryLabel={messages.base.requestRename}
                  primaryLoadingLabel={messages.common.submitting}
                  secondaryLabel={messages.base.renameNow}
                  secondaryLoadingLabel={messages.base.renaming}
                  onPrimary={() => submitRename()}
                  onSecondary={() => submitRename({ mergeImmediately: true })}
                  hint={messages.common.requestReviewHint}
                />
              </div>
              {renameError ? <div className="mt-2 text-red-700 text-sm">{renameError}</div> : null}
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                <div className="font-semibold text-sm">{messages.common.fields}</div>
                <span className="rounded-full bg-muted/55 px-2.5 py-1 text-muted-foreground text-xs">
                  {fmt(messages.base.fieldsCount, { count: base.fields.length })}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_120px_84px_64px] gap-3 border-border/50 border-b px-2 py-2 text-muted-foreground text-xs">
                <div>{messages.common.name}</div>
                <div>{messages.base.type}</div>
                <div>{messages.base.required}</div>
                <div>{messages.base.order}</div>
              </div>
              {base.fields.map((field) => (
                <div className="border-border/40 border-b" key={field.id}>
                  <div className="group grid min-h-12 grid-cols-[minmax(0,1fr)_120px_84px_64px] items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/35">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{resolveIString(field.name)}</div>
                        {isDerivedFieldSlug(resolveIString(field.name), field.slug) ? null : (
                          <div className="mt-0.5 truncate font-mono text-muted-foreground text-xs">
                            {field.slug}
                          </div>
                        )}
                      </div>
                      {onUpdateFieldName ? (
                        <button
                          aria-label={fmt(messages.base.renameFieldAria, {
                            name: resolveIString(field.name),
                          })}
                          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                          onClick={() => {
                            setEditingFieldId(field.id === editingFieldId ? null : field.id);
                            setEditingFieldName(field.name);
                            setFieldRenameError(null);
                          }}
                          title={messages.base.renameField}
                          type="button"
                        >
                          <Pencil size={12} />
                        </button>
                      ) : null}
                    </div>
                    <div>
                      <span className="inline-flex max-w-full truncate rounded-full bg-muted/65 px-2 py-0.5 text-muted-foreground text-xs">
                        {field.type}
                      </span>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {field.required ? messages.base.required : "-"}
                    </div>
                    <div className="font-mono text-muted-foreground text-xs">{field.position}</div>
                  </div>
                  {editingFieldId === field.id ? (
                    <div className="mb-2 rounded-md border border-border/60 bg-muted/20 p-3">
                      <IStringNameInput onChange={setEditingFieldName} value={editingFieldName} />
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <button
                          className="rounded-md border border-border/70 bg-background px-3 py-1.5 font-medium text-xs transition-colors hover:bg-accent"
                          onClick={() => setEditingFieldId(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                        <SplitSubmitButton
                          disabled={isFieldRenameSaving}
                          isPrimaryLoading={isFieldRenameSaving}
                          primaryLabel="Request Rename"
                          primaryLoadingLabel="Submitting..."
                          secondaryLabel="Rename Now"
                          secondaryLoadingLabel="Renaming..."
                          onPrimary={() => submitFieldRename(field.id)}
                          onSecondary={() =>
                            submitFieldRename(field.id, { mergeImmediately: true })
                          }
                          hint="Request goes to your inbox for review. Now writes directly."
                        />
                      </div>
                      {fieldRenameError ? (
                        <div className="mt-2 text-red-700 text-sm">{fieldRenameError}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div>
              <div className="font-semibold text-sm">{messages.base.addField}</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <IStringNameInput
                  onChange={(next) => {
                    setFieldName(next);
                    if (!fieldSlug) {
                      setFieldSlug(
                        iStringParse(next)
                          .trim()
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-|-$/g, ""),
                      );
                    }
                  }}
                  value={fieldName}
                />
                <label className="block">
                  <span className="text-muted-foreground text-xs">{messages.common.slug}</span>
                  <input
                    className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 font-mono text-sm outline-none transition-colors focus:border-primary"
                    onChange={(event) => setFieldSlug(event.target.value)}
                    value={fieldSlug}
                  />
                </label>
                <label className="block">
                  <span className="text-muted-foreground text-xs">{messages.base.type}</span>
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
                    <span className="text-muted-foreground text-xs">{messages.base.language}</span>
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
                    <span className="text-muted-foreground text-xs">
                      {messages.base.targetBase}
                    </span>
                    <select
                      className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
                      onChange={(event) => setTargetBaseId(event.target.value)}
                      value={targetBaseId}
                    >
                      <option value="">{messages.base.selectBase}</option>
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
                    <span className="text-muted-foreground text-xs">{messages.base.format}</span>
                    <select
                      className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
                      onChange={(event) =>
                        setNumberFormat(event.target.value as "plain" | "currency")
                      }
                      value={numberFormat}
                    >
                      <option value="plain">{messages.base.plainNumber}</option>
                      <option value="currency">{messages.base.currency}</option>
                    </select>
                  </label>
                ) : null}
                {fieldType === "number" && numberFormat === "currency" ? (
                  <label className="block">
                    <span className="text-muted-foreground text-xs">{messages.base.currency}</span>
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
                    {messages.base.required}
                  </label>
                  {fieldType === "relation" ? (
                    <label className="inline-flex items-center gap-2 text-muted-foreground">
                      <input
                        checked={isMultiple}
                        onChange={(event) => setIsMultiple(event.target.checked)}
                        type="checkbox"
                      />
                      {messages.base.multiple}
                    </label>
                  ) : null}
                </div>
                <SplitSubmitButton
                  disabled={isSaving}
                  isPrimaryLoading={isSaving}
                  primaryLabel={messages.base.addFieldRequest}
                  primaryLoadingLabel={messages.common.submitting}
                  secondaryLabel={messages.base.addFieldNow}
                  secondaryLoadingLabel={messages.base.adding}
                  onPrimary={() => submit()}
                  onSecondary={() => submit({ mergeImmediately: true })}
                  hint={messages.common.requestReviewHint}
                />
              </div>
              {formError ? (
                <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3">
                  <div className="text-red-700 text-sm">{formError}</div>
                  {formErrorDetail?.recordIds && formErrorDetail.recordIds.length > 0 ? (
                    <div className="mt-2">
                      <div className="mb-1 text-red-600 text-xs font-medium">
                        {fmt(messages.base.recordsMissingValue, {
                          count: formErrorDetail.recordIds.length,
                        })}
                      </div>
                      <div className="space-y-0.5">
                        {formErrorDetail.recordIds.slice(0, 8).map((rid) => (
                          <div key={rid} className="font-mono text-red-600 text-xs">
                            {rid}
                          </div>
                        ))}
                        {formErrorDetail.recordIds.length > 8 ? (
                          <div className="text-red-500 text-xs">
                            {fmt(messages.base.andMore, {
                              count: formErrorDetail.recordIds.length - 8,
                            })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {formErrorDetail?.affectedRecordIds &&
                  formErrorDetail.affectedRecordIds.length > 0 ? (
                    <div className="mt-2">
                      <div className="mb-1 text-red-600 text-xs font-medium">
                        {fmt(messages.base.recordsReferencingRemovedChoices, {
                          count: formErrorDetail.affectedRecordIds.length,
                        })}
                      </div>
                      <div className="space-y-0.5">
                        {formErrorDetail.affectedRecordIds.slice(0, 8).map((rid) => (
                          <div key={rid} className="font-mono text-red-600 text-xs">
                            {rid}
                          </div>
                        ))}
                        {formErrorDetail.affectedRecordIds.length > 8 ? (
                          <div className="text-red-500 text-xs">
                            {fmt(messages.base.andMore, {
                              count: formErrorDetail.affectedRecordIds.length - 8,
                            })}
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
                  <div className="font-semibold text-sm">{messages.base.deletedFields}</div>
                  <span className="rounded-full bg-muted/55 px-2.5 py-1 text-muted-foreground text-xs">
                    {fmt(messages.base.deletedCount, { count: deletedFields.length })}
                  </span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_120px_80px] gap-3 border-border/50 border-b px-2 py-2 text-muted-foreground text-xs">
                  <div>{messages.common.name}</div>
                  <div>{messages.base.type}</div>
                  <div />
                </div>
                {deletedFields.map((field) => (
                  <div
                    className="grid min-h-12 grid-cols-[minmax(0,1fr)_120px_80px] items-center gap-3 rounded-md border-border/40 border-b px-2 py-2 text-sm"
                    key={field.id}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-muted-foreground">
                        {resolveIString(field.name)}
                      </div>
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
                        {restoringFieldId === field.id ? "…" : messages.common.restore}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <aside className="space-y-3">
            <SidebarPanel title={messages.base.schema}>
              <PropertyRow label={messages.common.slug} value={base.slug} />
              <PropertyRow label={messages.common.fields} value={`${base.fields.length}`} />
              <PropertyRow
                label={messages.base.review}
                value={fmt(messages.base.approvalRequired, {
                  count: base.reviewPolicy.requiredApprovals,
                })}
              />
              <PropertyRow
                label={messages.common.created}
                value={new Date(base.createdAt).toLocaleString()}
              />
            </SidebarPanel>
          </aside>
        </div>
      </section>
    </div>
  );
}

function BaseDetailHeader({ base, orpc }: { base: BaseVO | null; orpc: BusabaseQueryUtils }) {
  const messages = useCoreI18n();
  return (
    <div className="px-6 pt-5 pb-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-base">{base?.name ?? messages.nav.base}</h1>
          {base?.description ? (
            <p className="mt-1 truncate text-muted-foreground text-xs">{base.description}</p>
          ) : null}
        </div>
        {/* Archive-to-Trash entry point for the Base itself — previously the
            detail page had no delete/archive action at all (only field/view/
            record actions existed). `mergeNodeDelete` already special-cases
            `node.type === "base"`, so the shared NodeDeleteButton works as-is. */}
        {base ? (
          <div className="flex shrink-0 items-center gap-2">
            <NodePermissionsButton nodeId={base.nodeId} nodeName={base.name} orpc={orpc} />
            <NodeDeleteButton
              nodeId={base.nodeId}
              nodeName={base.name}
              nodeType="base"
              orpc={orpc}
            />
          </div>
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
  const messages = useCoreI18n();
  const currentSearch = useSearch();

  return (
    <nav className="flex rounded-md bg-muted/60 p-0.5 text-xs">
      <Link
        className={`rounded px-2.5 py-1.5 font-medium transition-colors ${
          activeTab === "records"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
        href={mergeSearchIntoHref(`/base/${base.slug}`, currentSearch)}
      >
        {messages.base.recordsTab}
      </Link>
      <Link
        className={`rounded px-2.5 py-1.5 font-medium transition-colors ${
          activeTab === "design"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
        href={mergeSearchIntoHref(`/base/${base.slug}/design`, currentSearch)}
      >
        {messages.base.designTab}
      </Link>
    </nav>
  );
}
