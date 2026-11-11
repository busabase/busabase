import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AssetAttachmentRef,
  FormBoundFieldVO,
  FormFieldBindingVO,
  FormOptionsVO,
} from "busabase-contract/types";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { ChevronLeft, ChevronRight, Paperclip, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type FieldInputKind, fieldInputKind } from "../../base/field-types";
import { withDrivePaths } from "../../base/utils/drive-field-value";
import { DateFieldInput } from "../../dashboard/components/date-field";
import { FieldHelp, hasFieldHelp } from "../../dashboard/components/field-help";

interface GeneratedFormFieldProps {
  binding: FormFieldBindingVO;
  field?: FormBoundFieldVO;
  formNodeId?: string;
  label: string;
  onChange: (value: unknown) => void;
  onUploadAttachment?: (file: File) => Promise<AssetAttachmentRef>;
  orpc?: BusabaseQueryUtils;
  value: unknown;
}

const controlClassName =
  "mt-1.5 w-full rounded-md border border-border/70 bg-card px-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15";

const stringValue = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

const stringIds = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string" && value
      ? [value]
      : [];

const attachmentRefs = (value: unknown): AssetAttachmentRef[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is AssetAttachmentRef =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as AssetAttachmentRef).id === "string" &&
          typeof (item as AssetAttachmentRef).fileName === "string",
      )
    : [];

export const generatedFormControlKind = (field?: FormBoundFieldVO): FieldInputKind =>
  field ? fieldInputKind(field.type) : "text";

function FormRelationField({
  field,
  formNodeId,
  inputId,
  label,
  onChange,
  orpc,
  value,
}: {
  field: FormBoundFieldVO;
  formNodeId?: string;
  inputId: string;
  label: string;
  onChange: (value: unknown) => void;
  orpc?: BusabaseQueryUtils;
  value: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = stringIds(value);
  const multiple = field.relation?.multiple !== false;
  useEffect(() => {
    const next = query.trim();
    if (next === search) return;
    const timer = window.setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query, search]);
  const optionsQuery = useQuery({
    ...(orpc && formNodeId
      ? orpc.forms.options.queryOptions({
          input: { fieldSlug: field.slug, nodeId: formNodeId, page, pageSize: 50, query: search },
        })
      : { queryKey: ["form-relation-options", inputId], queryFn: async () => null }),
    enabled: Boolean(open && orpc && formNodeId),
    placeholderData: (previous) => previous,
  });
  const data: Extract<FormOptionsVO, { kind: "relation" }> | null =
    optionsQuery.data?.kind === "relation" ? optionsQuery.data : null;
  const titles = useRef(new Map<string, string>());
  for (const record of data?.records ?? []) titles.current.set(record.id, record.title);
  const update = (id: string) => {
    if (multiple)
      onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
    else {
      onChange(id);
      setOpen(false);
    }
  };

  return (
    <div className="mt-1.5 min-w-0 rounded-md border border-border/70 bg-card p-1.5">
      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
        {selected.map((id) => (
          <span
            className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-2 py-1 text-sm"
            key={id}
          >
            <span className="max-w-48 truncate" title={titles.current.get(id) ?? "Selected record"}>
              {titles.current.get(id) ?? "Selected record"}
            </span>
            <button
              aria-label={`Remove ${id}`}
              className="rounded p-0.5 hover:bg-accent"
              onClick={() => onChange(multiple ? selected.filter((item) => item !== id) : "")}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger asChild>
            <button
              aria-label={label}
              aria-expanded={open}
              className="inline-flex min-h-7 items-center gap-1 rounded px-2 text-muted-foreground text-sm hover:bg-accent focus-visible:outline-primary"
              id={inputId}
              type="button"
            >
              <Plus className="size-4" />
              {selected.length ? "Add record" : "Select record"}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[min(32rem,calc(100vw-2rem))] flex-col overflow-hidden p-0"
            collisionPadding={16}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              searchRef.current?.focus();
            }}
          >
            <div className="flex shrink-0 items-center gap-2 border-b px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                aria-label={`Search ${label}`}
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search linked records"
                ref={searchRef}
                type="search"
                value={query}
              />
            </div>
            <div
              aria-busy={optionsQuery.isFetching || query.trim() !== search}
              className="min-h-0 flex-1 overflow-y-auto p-1.5"
            >
              {optionsQuery.isError ? (
                <p className="p-2 text-muted-foreground text-sm">
                  Linked records are available to workspace members with Base access.
                </p>
              ) : optionsQuery.isPending || query.trim() !== search ? (
                <p className="p-2 text-muted-foreground text-sm">Loading...</p>
              ) : data?.records.length === 0 ? (
                <p className="p-2 text-muted-foreground text-sm">No matches</p>
              ) : (
                data?.records.map((record) => (
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-accent"
                    key={record.id}
                  >
                    <input
                      checked={selected.includes(record.id)}
                      name={inputId}
                      onChange={() => update(record.id)}
                      type={multiple ? "checkbox" : "radio"}
                    />
                    <span className="min-w-0 flex-1 truncate" title={record.title}>
                      {record.title}
                    </span>
                  </label>
                ))
              )}
            </div>
            {(data?.totalPages ?? 0) > 1 ? (
              <nav
                aria-label="Linked record pages"
                className="flex shrink-0 items-center justify-between border-t px-2 py-1.5 text-xs"
              >
                <button
                  aria-label="Go to previous page"
                  className="rounded p-1 hover:bg-accent disabled:opacity-40"
                  disabled={page === 1 || optionsQuery.isFetching}
                  onClick={() => setPage((current) => current - 1)}
                  type="button"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span>
                  {page} / {data?.totalPages}
                </span>
                <button
                  aria-label="Go to next page"
                  className="rounded p-1 hover:bg-accent disabled:opacity-40"
                  disabled={page >= (data?.totalPages ?? 1) || optionsQuery.isFetching}
                  onClick={() => setPage((current) => current + 1)}
                  type="button"
                >
                  <ChevronRight className="size-4" />
                </button>
              </nav>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function FormMemberField({
  field,
  formNodeId,
  inputId,
  label,
  onChange,
  orpc,
  value,
}: {
  field: FormBoundFieldVO;
  formNodeId?: string;
  inputId: string;
  label: string;
  onChange: (value: unknown) => void;
  orpc?: BusabaseQueryUtils;
  value: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = stringIds(value);
  const multiple = field.member?.multiple !== false;
  const optionsQuery = useQuery({
    ...(orpc && formNodeId
      ? orpc.forms.options.queryOptions({
          input: { fieldSlug: field.slug, nodeId: formNodeId, query },
        })
      : { queryKey: ["form-member-options", inputId], queryFn: async () => null }),
    enabled: Boolean(open && orpc && formNodeId),
    staleTime: 60_000,
    retry: false,
  });
  const data: Extract<FormOptionsVO, { kind: "member" }> | null =
    optionsQuery.data?.kind === "member" ? optionsQuery.data : null;
  const memberNames = useRef(new Map<string, string>());
  for (const member of data?.members ?? []) {
    memberNames.current.set(member.id, member.name || member.email || "Selected member");
  }
  const update = (id: string) => {
    if (multiple)
      onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
    else {
      onChange(id);
      setOpen(false);
    }
  };
  return (
    <div className="mt-1.5 min-w-0 rounded-md border border-border/70 bg-card p-1.5">
      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
        {selected.map((id) => (
          <span
            className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2 py-1 text-sm"
            key={id}
          >
            <span className="max-w-48 truncate">
              {memberNames.current.get(id) ?? "Selected member"}
            </span>
            <button
              aria-label={`Remove ${id}`}
              className="rounded-full p-0.5 hover:bg-accent"
              onClick={() => onChange(multiple ? selected.filter((item) => item !== id) : "")}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger asChild>
            <button
              aria-label={label}
              aria-expanded={open}
              className="inline-flex min-h-7 items-center gap-1 rounded px-2 text-muted-foreground text-sm hover:bg-accent focus-visible:outline-primary"
              id={inputId}
              type="button"
            >
              <Plus className="size-4" />
              {selected.length ? "Add member" : "Select member"}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="flex max-h-[min(28rem,var(--radix-popover-content-available-height))] w-[min(28rem,calc(100vw-2rem))] flex-col overflow-hidden p-0"
            collisionPadding={16}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              searchRef.current?.focus();
            }}
          >
            <div className="flex shrink-0 items-center gap-2 border-b px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                aria-label={`Search members - ${label}`}
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search members"
                ref={searchRef}
                type="search"
                value={query}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {optionsQuery.isError ? (
                <p className="p-2 text-muted-foreground text-sm">
                  Members are available to signed-in workspace users.
                </p>
              ) : optionsQuery.isPending ? (
                <p className="p-2 text-muted-foreground text-sm">Loading...</p>
              ) : data?.members.length === 0 ? (
                <p className="p-2 text-muted-foreground text-sm">No members found</p>
              ) : (
                data?.members.map((member) => (
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-accent"
                    key={member.id}
                  >
                    <input
                      checked={selected.includes(member.id)}
                      name={inputId}
                      onChange={() => update(member.id)}
                      type={multiple ? "checkbox" : "radio"}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {member.name || member.email || member.id}
                    </span>
                    {member.email ? (
                      <span className="shrink-0 text-muted-foreground text-xs">{member.email}</span>
                    ) : null}
                  </label>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function FormAttachmentField({
  field,
  inputId,
  label,
  onChange,
  onUploadAttachment,
  value,
}: {
  field: FormBoundFieldVO;
  inputId: string;
  label: string;
  onChange: (value: unknown) => void;
  onUploadAttachment?: (file: File) => Promise<AssetAttachmentRef>;
  value: unknown;
}) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const attachments = attachmentRefs(value);
  const options = field.attachment;
  const multiple = options?.maxFiles !== 1;
  const upload = async (files: FileList | null) => {
    if (!files || !onUploadAttachment) return;
    const fileList = Array.from(files);
    const maxFileSize = options?.maxFileSize;
    if (maxFileSize && fileList.some((file) => file.size > maxFileSize)) {
      setError(`Each file must be smaller than ${Math.ceil(maxFileSize / 1024 / 1024)} MB.`);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const uploaded = await Promise.all(fileList.map((file) => onUploadAttachment(file)));
      const next = multiple ? [...attachments, ...uploaded] : uploaded.slice(-1);
      const limited = options?.maxFiles ? next.slice(-options.maxFiles) : next;
      // A form has no folder tree: files sent to a drive field land at its root,
      // each with an explicit path (`name (2).pdf` when a name repeats).
      onChange(field.type === "drive" ? withDrivePaths(limited) : limited);
    } catch {
      setError("Could not upload file. Please try again.");
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="mt-1.5 grid gap-2">
      <label
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border/70 bg-card px-3 py-1.5 text-sm hover:bg-accent"
        htmlFor={inputId}
      >
        <Paperclip className="size-4" />
        {uploading ? "Uploading..." : "Add file"}
      </label>
      <input
        accept={options?.allowedMimeTypes?.join(",")}
        aria-label={label}
        className="sr-only"
        disabled={!onUploadAttachment || uploading}
        id={inputId}
        multiple={multiple}
        onChange={(event) => {
          void upload(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
        type="file"
      />
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {attachments.length ? (
        <ul className="grid gap-1">
          {attachments.map((attachment) => (
            <li
              className="flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-sm"
              key={attachment.id}
            >
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
              <button
                aria-label={`Remove ${attachment.fileName}`}
                className="rounded p-0.5 hover:bg-accent"
                onClick={() => onChange(attachments.filter((item) => item.id !== attachment.id))}
                type="button"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function GeneratedFormField({
  binding,
  field,
  formNodeId,
  label,
  onChange,
  onUploadAttachment,
  orpc,
  value,
}: GeneratedFormFieldProps) {
  const controlKind = generatedFormControlKind(field);
  const inputId = `form-field-${binding.inputName}`;
  const help = {
    description: binding.help ?? field?.help?.description,
    example: field?.help?.example,
  };
  const helpId = hasFieldHelp(help) ? `${inputId}-help` : undefined;
  const sharedProps = {
    "aria-describedby": helpId,
    "data-input-name": binding.inputName,
    id: inputId,
  };
  const control =
    controlKind === "relation" && field ? (
      <FormRelationField
        field={field}
        formNodeId={formNodeId}
        inputId={inputId}
        label={label}
        onChange={onChange}
        orpc={orpc}
        value={value}
      />
    ) : controlKind === "member" && field ? (
      <FormMemberField
        field={field}
        formNodeId={formNodeId}
        inputId={inputId}
        label={label}
        onChange={onChange}
        orpc={orpc}
        value={value}
      />
    ) : (controlKind === "attachment" || controlKind === "drive") && field ? (
      <FormAttachmentField
        field={field}
        inputId={inputId}
        label={label}
        onChange={onChange}
        onUploadAttachment={onUploadAttachment}
        value={value}
      />
    ) : controlKind === "textarea" ? (
      <textarea
        {...sharedProps}
        aria-label={label}
        className={`${controlClassName} min-h-16 resize-y py-2 leading-5`}
        onChange={(event) => onChange(event.target.value)}
        value={stringValue(value)}
      />
    ) : controlKind === "checkbox" ? (
      <div className="mt-1.5 flex h-9 items-center">
        <input
          {...sharedProps}
          aria-label={label}
          checked={value === true}
          className="size-4 rounded border-border text-primary accent-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
      </div>
    ) : controlKind === "select" ? (
      <select
        {...sharedProps}
        aria-label={label}
        className={`${controlClassName} h-9`}
        onChange={(event) => onChange(event.target.value)}
        value={stringValue(value)}
      >
        <option value="">-</option>
        {(field?.choices ?? []).map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>
    ) : controlKind === "multiselect" ? (
      <select
        {...sharedProps}
        aria-label={label}
        className={`${controlClassName} min-h-20 py-2`}
        multiple
        onChange={(event) =>
          onChange(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))
        }
        value={stringIds(value)}
      >
        {(field?.choices ?? []).map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>
    ) : controlKind === "date" ? (
      <DateFieldInput
        ariaDescribedBy={helpId}
        ariaLabel={label}
        className={`${controlClassName} h-9`}
        dataAttributes={{ "data-input-name": binding.inputName }}
        id={inputId}
        onChange={onChange}
        options={field?.date}
        value={value}
      />
    ) : (
      <input
        {...sharedProps}
        aria-label={label}
        className={`${controlClassName} h-9`}
        onChange={(event) =>
          onChange(
            controlKind === "number" && event.target.value !== ""
              ? event.target.valueAsNumber
              : event.target.value,
          )
        }
        type={
          controlKind === "number" ||
          controlKind === "url" ||
          controlKind === "email" ||
          controlKind === "tel"
            ? controlKind
            : "text"
        }
        value={stringValue(value)}
      />
    );
  return (
    <div className="min-w-0">
      <label className="block font-medium text-foreground text-sm" htmlFor={inputId}>
        {label}
        {binding.required ? <span className="ml-0.5 text-rejected-strong">*</span> : null}
      </label>
      <FieldHelp help={help} id={helpId} />
      {control}
    </div>
  );
}
