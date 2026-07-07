import type { FieldType } from "busabase-contract/types";

const labelByFieldType: Record<FieldType, string> = {
  ai_summary: "AI summary",
  ai_tags: "AI tags",
  attachment: "Attachment",
  auto_number: "Auto number",
  checkbox: "Checkbox",
  code: "Code",
  created_by: "Created by",
  created_time: "Created time",
  date: "Date",
  email: "Email",
  html: "HTML",
  json: "JSON",
  longtext: "Long text",
  markdown: "Markdown",
  multiselect: "Multi-select",
  number: "Number",
  phone: "Phone",
  relation: "Relation",
  select: "Select",
  text: "Text",
  updated_by: "Updated by",
  updated_time: "Updated time",
  url: "URL",
  yaml: "YAML",
};

export const getFieldTypeLabel = (type: FieldType | string) =>
  labelByFieldType[type as FieldType] ?? type;
