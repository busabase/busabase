// Form-as-Node DTO/VO schemas. Pure zod leaf — no db, no server imports.
// See apps/busabase/content/spec/form-as-node.md.
import { z } from "zod";
import { fieldNameSchema, fieldTypeSchema } from "../base/contract/base-schemas";

/**
 * One input-to-field mapping. `inputName` is the name the agent-authored page
 * uses for a control; `fieldSlug` is the target Base field it writes to.
 * `required`/`label`/`help` are per-form overrides that DON'T mutate the Base
 * field definition (fixing APITable's "form not self-contained" limitation).
 */
export const FormFieldBindingSchema = z.object({
  inputName: z.string().min(1),
  fieldSlug: z.string().min(1),
  required: z.boolean().optional(),
  label: z.string().optional(),
  help: z.string().optional(),
});
export type FormFieldBindingVO = z.infer<typeof FormFieldBindingSchema>;

/**
 * Client-safe control metadata for one bound Base field. Public Forms expose
 * only these curated fields, never the target Base or its records.
 */
export const FormBoundFieldSchema = z.object({
  slug: z.string(),
  name: fieldNameSchema,
  type: fieldTypeSchema,
  choices: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
      }),
    )
    .default([]),
});
export type FormBoundFieldVO = z.infer<typeof FormBoundFieldSchema>;

/** Optional theme tokens layered over the agent-authored page. */
export const FormThemeSchema = z.object({
  logoUrl: z.string().optional(),
  coverUrl: z.string().optional(),
  brandColor: z.string().optional(),
  hideBranding: z.boolean().optional(),
});
export type FormThemeVO = z.infer<typeof FormThemeSchema>;

/**
 * Page source: ONE HTML document the agent authors — `<style>`/`<script>` live
 * inside it, exactly as a real web page does. (This was briefly split into
 * html/css/js, but the renderer only ever concatenated the parts back into a
 * single document and no step needed them apart — the split was ceremony.)
 * Block-drag authoring is intentionally NOT built; the agent writes code.
 */
export const FormPageSourceSchema = z.object({
  code: z.string().optional(),
  theme: FormThemeSchema.optional(),
});
export type FormPageSourceVO = z.infer<typeof FormPageSourceSchema>;

/**
 * Public/anonymous settings. No shareToken — the submit endpoint gates on these
 * flags. Three states: private / public+anonymous / public+require-login.
 */
export const FormShareSchema = z.object({
  isPublic: z.boolean().default(false),
  anonymousSubmit: z.boolean().default(false),
  submitLimit: z.number().int().positive().optional(),
  requireCaptcha: z.boolean().optional(),
});
export type FormShareVO = z.infer<typeof FormShareSchema>;

export const FormVOSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  spaceId: z.string(),
  targetBaseId: z.string(),
  name: z.string(),
  description: z.string(),
  bindings: z.array(FormFieldBindingSchema),
  boundFields: z.array(FormBoundFieldSchema).default([]),
  page: FormPageSourceSchema,
  share: FormShareSchema,
  /** Accepted submissions so far — backs server-side `share.submitLimit`. */
  submissionCount: z.number().int().nonnegative().default(0),
  status: z.enum(["active", "archived"]),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FormVO = z.infer<typeof FormVOSchema>;

// ── DTO inputs ────────────────────────────────────────────────────────────

export const CreateFormInputSchema = z.object({
  nodeId: z.string().min(1),
  targetBaseId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  bindings: z.array(FormFieldBindingSchema).optional().default([]),
  page: FormPageSourceSchema.optional().default({}),
  share: FormShareSchema.optional().default({ isPublic: false, anonymousSubmit: false }),
});
export type CreateFormDTO = z.input<typeof CreateFormInputSchema>;

export const UpdateFormInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  bindings: z.array(FormFieldBindingSchema).optional(),
  page: FormPageSourceSchema.optional(),
  share: FormShareSchema.optional(),
});
export type UpdateFormDTO = z.input<typeof UpdateFormInputSchema>;

/** A filled-in submission: input names → values, plus optional anti-abuse token. */
export const SubmitFormInputSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  captchaToken: z.string().optional(),
});
export type SubmitFormDTO = z.input<typeof SubmitFormInputSchema>;

/** What the submit endpoint returns — the pending ChangeRequest id, never data. */
export const FormSubmitResultSchema = z.object({
  changeRequestId: z.string(),
  status: z.literal("pending_review"),
});
export type FormSubmitResultVO = z.infer<typeof FormSubmitResultSchema>;
