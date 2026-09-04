import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  CreateFormInputSchema,
  FormSubmitResultSchema,
  FormVOSchema,
  ListFormsInputSchema,
  ListFormsVOSchema,
  SubmitFormInputSchema,
  UpdateFormInputSchema,
} from "./types";

export const formContract = {
  list: oc
    .route({
      method: "GET",
      path: "/forms",
      tags: ["Forms"],
      summary: "List forms bound to a Base",
      successDescription:
        "A newest-first page of forms with a stable opaque cursor (null at the end).",
    })
    .input(ListFormsInputSchema)
    .output(ListFormsVOSchema),
  getByNode: oc
    .route({
      method: "GET",
      path: "/forms/{nodeId}",
      tags: ["Forms"],
      summary: "Get a form by its node id",
      successDescription: "The form bound to this node, or 404.",
    })
    .input(z.object({ nodeId: z.string() }))
    .output(FormVOSchema),
  create: oc
    .route({
      method: "POST",
      path: "/forms",
      tags: ["Forms"],
      summary: "Create a form bound to a Base",
      successDescription: "The created form.",
    })
    .input(CreateFormInputSchema)
    .output(FormVOSchema),
  update: oc
    .route({
      method: "PUT",
      path: "/forms/{nodeId}",
      tags: ["Forms"],
      summary: "Update a form's config (owner-managed, not a change request)",
      successDescription: "The updated form.",
    })
    .input(UpdateFormInputSchema.extend({ nodeId: z.string() }))
    .output(FormVOSchema),
  submit: oc
    .route({
      method: "POST",
      path: "/forms/{nodeId}/submit",
      tags: ["Forms"],
      summary: "Submit a filled-in form",
      successDescription:
        "Creates a review-first record-create ChangeRequest on the target Base — a form submission always waits for a human, whoever submitted it.",
    })
    .input(SubmitFormInputSchema.extend({ nodeId: z.string() }))
    .output(FormSubmitResultSchema),
};
